#!/usr/bin/env node
// 批量把源码中的硬编码中文字面量替换为 t('key') 调用（i18n 迁移辅助）。
//
// 与 scripts/merge-lang.mjs 配套使用：
//   1) 先用本脚本把源码里的字面量改成 t('namespace.key') 调用（仅替换代码，不改语言包）；
//   2) 再把对应 key → 翻译 写进补丁，用 merge-lang.mjs 合并进 lang/* 与 BUILTIN。
//
// 配置 JSON 格式：
// {
//   "files": [
//     {
//       "file": "src/routes/Foo.tsx",
//       "importAfter": "import { useSharedStyles } from '../styles/shared';",
//       "hookAfter": "const s = useSharedStyles();",
//       "repl": [
//         { "from": "硬编码中文子串", "to": "{t('ns.key')}" },
//         { "from": "含 ${x} 的模板片段", "to": "t('ns.key', { x })" }
//       ]
//     }
//   ]
// }
//
// 规则：
//   - from 是文件中的【精确子串】，用 split/join 做全局替换（不依赖正则，避免转义问题）。
//   - importAfter：若存在，在该行之后插入 `import { useLanguage } from '../i18n';`
//   - hookAfter：   若存在，在该行之后插入 `  const { t } = useLanguage();`
//     （组件函数里调用 useLanguage 需要这两行；多个组件时 hookAfter 可写数组）
//   - 未命中 from 会 WARN 并跳过该项（不写文件，便于发现笔误）。

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const cfgPath = process.argv[2];
if (!cfgPath) {
  console.error('用法：node scripts/i18n-replace.mjs <config.json>');
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));

let hit = 0;
let miss = 0;
for (const entry of cfg.files) {
  const full = join(ROOT, entry.file);
  let src = readFileSync(full, 'utf8');
  let changed = false;

  if (entry.importAfter) {
    const importLine = `import { useLanguage } from '${entry.importPath || '../i18n'}';`;
    if (src.includes(entry.importAfter)) {
      if (!src.includes(importLine)) {
        src = src.replace(entry.importAfter, `${entry.importAfter}\n${importLine}`);
        changed = true;
      }
    } else {
      console.error(`[WARN] importAfter 未命中：${entry.file} :: ${entry.importAfter}`);
    }
  }

  const hooks = Array.isArray(entry.hookAfter) ? entry.hookAfter : entry.hookAfter ? [entry.hookAfter] : [];
  for (const h of hooks) {
    if (src.includes(h) && !src.includes(`${h}\n  const { t } = useLanguage();`)) {
      src = src.replace(h, `${h}\n  const { t } = useLanguage();`);
      changed = true;
    } else if (!src.includes(h)) {
      console.error(`[WARN] hookAfter 未命中：${entry.file} :: ${h}`);
    }
  }

  for (const { from, to } of entry.repl || []) {
    const count = src.split(from).length - 1;
    if (count === 0) {
      console.error(`[MISS] 未命中 from：${entry.file} :: ${from}`);
      miss++;
      continue;
    }
    src = src.split(from).join(to);
    hit += count;
    changed = true;
  }

  if (changed) writeFileSync(full, src, 'utf8');
}

console.log(`替换完成：命中 ${hit} 处，未命中 ${miss} 处。`);
