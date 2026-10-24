#!/usr/bin/env node
// 由 data/people.json 生成 README 的收录清单（重写 BEGIN/END 标记之间的内容）。
// 用法：node scripts/build-readme.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PEOPLE = join(ROOT, 'data', 'people.json');
const README = join(ROOT, 'README.md');
const BEGIN = '<!-- BEGIN GENERATED -->';
const END = '<!-- END GENERATED -->';

const visible = (p) => p.revoke !== true && p.consent !== false;

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
  const whoCell = home ? `[${who}](${home})` : who;
  const opens = (p.opens || []).join(' / ') || '—';
  return `| ${whoCell} | ${p.tagline || '—'} | ${p.open_since || '—'} | ${opens} | ${channelLinks(p.channels)} |`;
}

function buildTable(people) {
  const head = [
    `收录 **${people.length}** 人。`,
    '',
    '| 人 | 一句话 | 开源自 | 开源内容 | 链接 |',
    '|---|---|---|---|---|',
  ];
  const body = people.length ? people.map(row) : ['| — | 尚无收录 | — | — | — |'];
  return [...head, ...body].join('\n');
}

function main() {
  const people = JSON.parse(readFileSync(PEOPLE, 'utf8'))
    .filter(visible)
    .sort((a, b) => String(a.open_since).localeCompare(String(b.open_since)));

  const md = readFileSync(README, 'utf8');
  const start = md.indexOf(BEGIN);
  const end = md.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    console.error('README 缺少成对的 BEGIN/END 生成标记，已中止。');
    process.exit(1);
  }

  const next = md.slice(0, start + BEGIN.length) + '\n\n' + buildTable(people) + '\n\n' + md.slice(end);
  writeFileSync(README, next);
  console.log(`已生成收录清单：${people.length} 人`);
}

main();
