#!/usr/bin/env node
// 语言包批量合并工具（i18n 迁移辅助）
//
// 把一个补丁文件合并进 lang/zh-CN.json、lang/zh-TW.json、lang/en-US.json，
// 并按需写入 src/i18n/index.tsx 的 BUILTIN_ZH_CN（首帧兜底字典）。
//
// 补丁文件格式（JSON）：
// {
//   "keys": [
//     { "key": "auth.login", "zh": "登录", "tw": "登入", "en": "Sign in", "builtin": true },
//     ...
//   ]
// }
// - zh 必填（简体中文是基准，写入 zh-CN.json 与 BUILTIN_ZH_CN）
// - tw / en 可选（缺省则对应语言文件不写该 key，运行时回退到 zh-CN）
// - builtin: true 时同时写入 BUILTIN_ZH_CN（仅首帧兜底需要的 key）
//
// 用法：node scripts/merge-lang.mjs <patch.json>

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const patchPath = process.argv[2];
if (!patchPath) {
  console.error('用法：node scripts/merge-lang.mjs <patch.json>');
  process.exit(1);
}

const patch = JSON.parse(readFileSync(patchPath, 'utf8'));
const keys = patch.keys || [];
if (!keys.length) {
  console.error('补丁里没有 keys');
  process.exit(1);
}

const zhPath = join(ROOT, 'lang', 'zh-CN.json');
const twPath = join(ROOT, 'lang', 'zh-TW.json');
const enPath = join(ROOT, 'lang', 'en-US.json');
const builtinPath = join(ROOT, 'src', 'i18n', 'index.tsx');

const zh = JSON.parse(readFileSync(zhPath, 'utf8'));
const tw = JSON.parse(readFileSync(twPath, 'utf8'));
const en = JSON.parse(readFileSync(enPath, 'utf8'));

let added = 0;
const builtinKeys = [];
for (const { key, zh: z, tw: t, en: e, builtin } of keys) {
  if (!key || z === undefined) {
    console.warn(`跳过无效项：${JSON.stringify({ key, zh: z })}`);
    continue;
  }
  if (zh[key] === undefined) added++;
  zh[key] = z;
  if (t !== undefined) tw[key] = t;
  if (e !== undefined) en[key] = e;
  if (builtin) builtinKeys.push({ key, z });
}

writeFileSync(zhPath, JSON.stringify(zh, null, 2) + '\n', 'utf8');
writeFileSync(twPath, JSON.stringify(tw, null, 2) + '\n', 'utf8');
writeFileSync(enPath, JSON.stringify(en, null, 2) + '\n', 'utf8');

// 写入 BUILTIN_ZH_CN：在 `};` 结束前插入
if (builtinKeys.length) {
  let src = readFileSync(builtinPath, 'utf8');
  const lines = builtinKeys.map(({ key, z }) => `  ${JSON.stringify(key)}: ${JSON.stringify(z)},`).join('\n');
  // 匹配 BUILTIN_ZH_CN 对象的结束 `};`（其后是空行 + const FALLBACK）
  const marker = /\n};\n\nconst FALLBACK/;
  if (!marker.test(src)) {
    console.error('未在 index.tsx 中找到 BUILTIN_ZH_CN 结束标记，跳过 BUILTIN 写入');
  } else {
    src = src.replace(marker, `\n  ${lines}\n};\n\nconst FALLBACK`);
    writeFileSync(builtinPath, src, 'utf8');
  }
}

console.log(`已合并 ${keys.length} 个 key（其中 ${added} 个是新增），BUILTIN 写入 ${builtinKeys.length} 个。`);
