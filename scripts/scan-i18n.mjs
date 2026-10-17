#!/usr/bin/env node
// 残留中文字符串扫描器（P3）
//
// 用途：找出 src/ 与 src-tauri/src/ 中仍硬编码的中文字符串，作为多语言（i18n）迁移的待办清单。
// 设计上「宁可多报、不可漏报」：被 t() 包裹的 key 本身是 ASCII，不会出现中文，
// 所以凡是在源码里出现的汉字（除注释、语言文件、i18n 引擎自身之外）都是需要处理的字面量。
//
// 跳过规则：
//   - 注释（// 行注释、/* */ 块注释、Rust 的 /// doc 注释）
//   - lang/ 目录（语言包真源，里面的中文是翻译内容不是待处理项）
//   - src/i18n/ 与 src-tauri/src/i18n/（i18n 引擎自身，含内置兜底字典）
//   - 依赖与产物：node_modules / dist / target / .workbuddy / .temp / release / .git
//   - 同一行里已经调用 t( / tr( / i18n::tr( 的（基本已接入翻译，仅作软跳过）
//
// 用法：node scripts/scan-i18n.mjs [--json] [--report=路径]

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const reportArg = args.find((a) => a.startsWith('--report='));
const reportPath = reportArg ? reportArg.split('=')[1] : null;

// 需要扫描的根目录（相对仓库根）
const ROOTS = ['src', 'src-tauri/src'];

// 整体跳过的目录片段
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'target',
  '.workbuddy',
  '.temp',
  'release',
  '.git',
  'lang', // 语言包真源
  // i18n 引擎自身（含内置兜底字典，中文是翻译内容）
  join('src', 'i18n'),
  join('src-tauri', 'src', 'i18n'),
]);

// 需要扩展名
const EXT = new Set(['.ts', '.tsx', '.rs', '.vue', '.svelte']);

// 汉字（含扩展 A 区）
const HAN = /[㐀-䶿一-鿿豈-﫿]/g;
// 行注释：// ... 或 /* ... */（逐行近似处理，块注释按 /* 起 */ 止跨行）
const LINE_COMMENT = /\/\/.*$/;
const BLOCK_START = /\/\*/;
const BLOCK_END = /\*\//;

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || SKIP_DIRS.has(relative(ROOT, full))) continue;
      walk(full, out);
    } else if (e.isFile()) {
      if (!EXT.has(e.name.slice(e.name.lastIndexOf('.')))) continue;
      out.push(full);
    }
  }
}

const files = [];
for (const r of ROOTS) walk(join(ROOT, r), files);

const results = []; // { file, line, text }

for (const file of files) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const lines = content.split('\n');
  let inBlock = false;
  lines.forEach((raw, i) => {
    let line = raw;
    // 块注释状态机
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end === -1) return; // 整行都在块注释里
      line = line.slice(end + 2);
      inBlock = false;
    }
    if (BLOCK_START.test(line)) {
      const start = line.indexOf('/*');
      const end = line.indexOf('*/', start + 2);
      if (end === -1) {
        // 块注释开始且本行没结束 → 去掉 /* 之后的内容，剩余前半段仍可能含代码
        line = line.slice(0, start);
        inBlock = true;
      } else {
        line = line.slice(0, start) + line.slice(end + 2);
      }
    }
    // 行注释
    line = line.replace(LINE_COMMENT, '');
    // 软跳过：同一行已调用翻译函数
    if (/t\(\s*['"`]/.test(line) || /tr\(\s*['"`]/.test(line) || /i18n::tr\(/.test(line)) {
      // 仍可能混有其它字面量，这里保留，由人工判断；但减少噪音先跳过纯 t(...) 行
      if (!HAN.test(line.replace(/t\(\s*['"`][^'"`]*['"`]\s*\)/, ''))) return;
    }
    const matches = line.match(HAN);
    if (matches) {
      const hanText = line.match(/[㐀-䶿一-鿿豈-﫿]+/g).join('');
      results.push({ file: relative(ROOT, file), line: i + 1, text: hanText });
    }
  });
}

// 汇总
const byFile = {};
for (const r of results) byFile[r.file] = (byFile[r.file] || 0) + 1;
const topFiles = Object.entries(byFile).sort((a, b) => b[1] - a[1]);

if (asJson) {
  console.log(JSON.stringify({ total: results.length, byFile: topFiles, items: results }, null, 2));
} else {
  console.log(`\n扫描到 ${results.length} 处硬编码中文，分布在 ${topFiles.length} 个文件。\n`);
  console.log('Top 文件（按出现次数）：');
  for (const [f, n] of topFiles.slice(0, 30)) {
    console.log(`  ${String(n).padStart(4)}  ${f}`);
  }
  if (topFiles.length > 30) console.log(`  ... 还有 ${topFiles.length - 30} 个文件`);
  console.log('\n示例（前 20 条）：');
  for (const r of results.slice(0, 20)) {
    console.log(`  ${r.file}:${r.line}  ${r.text}`);
  }
}

if (reportPath) {
  const lines = results.map((r) => `${r.file}:${r.line}\t${r.text}`);
  writeFileSync(reportPath, `i18n 残留中文扫描报告\n共 ${results.length} 处\n\n` + lines.join('\n') + '\n', 'utf8');
  console.log(`\n报告已写入 ${reportPath}`);
}
