#!/usr/bin/env node
// 由 data/people.json 生成 README 的收录清单（重写 BEGIN/END 标记之间的内容）。
//
// 用法：
//   node scripts/build-readme.mjs                      # 用当天日期做种子（同一天结果稳定）
//   node scripts/build-readme.mjs --seed=2026-10-25    # 指定种子，排列可复现
//   node scripts/build-readme.mjs --seed=none          # 每次都真随机
//   node scripts/build-readme.mjs --shuffle-categories # 类目顺序也一起打乱
//
// 排列规则（类目内）：先按 level 分档（L1 → L3），同档内中文组 / 英文组各自随机，
// 两组前后顺序也随机；档位本身不变，所以「谁在前」会变、「谁更强」不会变。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PEOPLE = join(ROOT, 'data', 'people.json');
const README = join(ROOT, 'README.md');
const BEGIN = '<!-- BEGIN GENERATED -->';
const END = '<!-- END GENERATED -->';

// 类目：显示顺序按此数组；想加新类目（比如 design），往这里加一行即可，
// 未列出的 category 会按 slug 拼到最后，不会丢条目。
const CATEGORIES = [
  { slug: 'ai', label: 'AI 与 Agent 技能' },
  { slug: 'build', label: '独立产品与一人公司' },
  { slug: 'writing', label: '长文与人生叙事' },
  { slug: 'data', label: '个人数据与量化自我' },
  { slug: 'knowledge', label: '知识与决策系统' },
];
const UNCATEGORIZED = { slug: '_uncat', label: '未分类' };

const LEVEL_LABEL = { 1: 'L1', 2: 'L2', 3: 'L3' }; // 仅用于控制台日志
const LEVEL_ORDER = [1, 2, 3];
const TOP_LEVEL = 1; // 顶级：昵称前打 ⭐️，永远在类目最顶部，且不参与随机
const TOP_STAR = '⭐️';

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const readArg = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const hasFlag = (name) => argv.includes(`--${name}`);

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const seedArg = readArg('seed');
const shuffleCategories = hasFlag('shuffle-categories');

// ---------- 随机数：同一种子 → 同一种排列 ----------
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed) {
  if (!seed || seed === 'none') return mulberry32(Math.floor(Math.random() * 2 ** 32));
  return mulberry32(xmur3(seed)());
}

function shuffle(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- 条目取值 ----------
const CJK = /[\u3400-\u9fff\u3040-\u30ff]/;
const visible = (p) => p.revoke !== true && p.consent !== false;

function langOf(p) {
  if (p.lang === 'zh' || p.lang === 'en') return p.lang;
  // 没填 lang 时的兜底：展示名含中日韩字符算中文区
  return CJK.test(p.name || p.id) ? 'zh' : 'en';
}

function levelOf(p) {
  const lv = Number(p.level);
  return LEVEL_LABEL[lv] ? lv : 3;
}

function categoryOf(p) {
  return p.category || UNCATEGORIZED.slug;
}

function channelLinks(channels) {
  const pairs = Object.entries(channels || {}).filter(([, url]) => url);
  return pairs.length ? pairs.map(([k, url]) => `[${k}](${url})`).join(' · ') : '—';
}

function homeUrl(p) {
  const channels = p.channels || {};
  return channels.github || Object.values(channels).find(Boolean) || '';
}

function row(p) {
  const home = homeUrl(p);
  const who = p.name || p.id;
  const star = levelOf(p) === TOP_LEVEL ? `${TOP_STAR} ` : '';
  const whoCell = home ? `${star}[${who}](${home})` : `${star}${who}`;
  const opens = (p.opens || []).join(' / ') || '—';
  const since = p.open_since || '—';
  return `| ${whoCell} | ${p.tagline || '—'} | ${since} | ${opens} | ${channelLinks(p.channels)} |`;
}

// ---------- 排序：分档 → 分语组 → 组内随机（顶级除外） ----------
// 顶级（L1）永远在类目最顶部，内部保持中文组 → 英文组、组内按数据顺序，且不消耗随机数；
// 其余各档组内随机、两组前后也随机。
function orderWithinCategory(list, rng) {
  const out = [];
  for (const lv of LEVEL_ORDER) {
    const inLevel = list.filter((p) => levelOf(p) === lv);
    if (!inLevel.length) continue;
    const zh = inLevel.filter((p) => langOf(p) === 'zh');
    const en = inLevel.filter((p) => langOf(p) === 'en');
    if (lv === TOP_LEVEL) {
      out.push(...zh, ...en);
      continue;
    }
    const blocks = [];
    if (zh.length) blocks.push(shuffle(zh, rng));
    if (en.length) blocks.push(shuffle(en, rng));
    const ordered = rng() < 0.5 ? blocks : blocks.slice().reverse();
    for (const block of ordered) out.push(...block);
  }
  return out;
}

// ---------- 输出 ----------
const HEAD = ['| id | 一句话 | 开源自 | 开源内容 | 链接 |', '|---|---|---|---|---|'];

function titleText(cat, count) {
  return `${cat.label} · ${count} 人`;
}

function heading(cat, count) {
  return `### ${titleText(cat, count)}`;
}

// GitHub 标题锚点：小写、去标点、空格转连字符（中文保留）
function anchor(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');
}

function collectCategories(people) {
  const used = new Set(people.map(categoryOf));
  const listed = CATEGORIES.map((c) => ({ slug: c.slug, label: c.label }));
  const missing = [...used].filter((slug) => !CATEGORIES.some((c) => c.slug === slug));
  for (const slug of missing) {
    listed.push(slug === UNCATEGORIZED.slug ? UNCATEGORIZED : { slug, label: slug });
  }
  return listed.filter((c) => used.has(c.slug));
}

function buildAll(people, rng) {
  const cats = collectCategories(people);
  const groups = cats
    .map((cat) => {
      const list = people.filter((p) => categoryOf(p) === cat.slug);
      return { cat, list, ordered: orderWithinCategory(list, rng) };
    })
    .filter((g) => g.list.length);

  if (shuffleCategories) {
    for (let i = groups.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [groups[i], groups[j]] = [groups[j], groups[i]];
    }
  }

  const lines = [
    `收录 **${people.length}** 人 · 分 **${groups.length}** 类。`,
    '',
    `**类目**：${groups.map((g) => `[${g.cat.label}](#${anchor(titleText(g.cat, g.list.length))})（${g.list.length}）`).join(' · ')}`,
  ];

  for (const g of groups) {
    lines.push('', heading(g.cat, g.list.length), '', ...HEAD, ...g.ordered.map(row));
  }

  return { text: lines.join('\n'), groups };
}

function main() {
  const seed = seedArg ?? today();
  const seedText = seed === 'none' ? 'none' : seed;
  const rng = makeRng(seed);

  const people = JSON.parse(readFileSync(PEOPLE, 'utf8')).filter(visible);

  const md = readFileSync(README, 'utf8');
  const start = md.indexOf(BEGIN);
  const end = md.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    console.error('README 缺少成对的 BEGIN/END 生成标记，已中止。');
    process.exit(1);
  }

  const { text, groups } = people.length
    ? buildAll(people, rng)
    : { text: '尚无收录。', groups: [] };

  const next = md.slice(0, start + BEGIN.length) + '\n\n' + text + '\n\n' + md.slice(end);
  writeFileSync(README, next);

  console.log(`已生成收录清单：${people.length} 人 / ${groups.length} 类 · 种子 ${seedText}`);
  for (const g of groups) {
    const order = g.ordered.map((p) => `${LEVEL_LABEL[levelOf(p)]}:${p.id}`).join(' ');
    console.log(`  ${g.cat.label}（${g.list.length}） → ${order}`);
  }
}

main();
