// 采集插件运行时：用 DOMParser 解析 HTML（不执行页面任何脚本），
// 按插件 JSON 声明的选择器提取字段。第三方插件也只描述选择规则，无代码执行能力。
import type { CollectorInfo } from './tauri';
import { tOutside } from '../i18n';

export interface CollectorPlugin {
  id: string;
  name: string;
  version?: string;
  description?: string;
  builtin?: boolean;
  urlPattern?: string[];
  fields: Record<string, FieldSpec>;
}

export interface FieldSpec {
  /** 在该容器内查找（默认整个文档） */
  scope?: string;
  selector?: string;
  /** 取属性值；数组表示按顺序回退（懒加载常用：['data-src','src']） */
  attr?: string | string[];
  /** 取文本（折叠空白），默认 true */
  text?: boolean;
  /** 取 innerHTML */
  html?: boolean;
  multiple?: boolean;
  /** multiple=false 时指定第几个（默认 0） */
  nth?: number;
  /** 正则替换（先于输出） */
  regexReplace?: { pattern: string; replace: string; flags?: string };
  /** 只保留正则匹配到的部分 */
  regexMatch?: string;
  /** 按文字选中容器，再在其内部取 target（用于折叠面板等场景） */
  selectByText?: { scope: string; text: string; target: string };
}

export interface CollectResult {
  title: string;
  description: string;
  thumbnail: string;
  images: string[];
  magnets: string[];
}

/** 解析后端返回的插件 raw JSON */
export function parsePlugin(info: CollectorInfo): CollectorPlugin {
  const p = JSON.parse(info.raw) as CollectorPlugin;
  if (!p.id || !p.fields) throw new Error(tOutside('collector.invalidPlugin'));
  return p;
}

/** 简单 glob 匹配：* 表示任意字符，默认忽略大小写；仅用于 urlPattern */
export function urlMatches(patterns: string[] | undefined, url: string): boolean {
  if (!patterns || patterns.length === 0) return false;
  const u = url.toLowerCase();
  return patterns.some((pat) => {
    const rx = pat
      .toLowerCase()
      .replace(/[.+?^${}()|[\]\\]/g, (c) => (c === '*' ? c : '\\' + c))
      .replace(/\*/g, '.*');
    try {
      return new RegExp(`^${rx}$`).test(u);
    } catch {
      return false;
    }
  });
}

function normalizeText(s: string): string {
  return s
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function absolutize(v: string, base: string): string {
  const t = v.trim();
  if (!t || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|mailto:|tel:)/i.test(t)) return t;
  try {
    return new URL(t, base).href;
  } catch {
    return t;
  }
}

function applyRegex(v: string, spec: FieldSpec): string {
  let out = v;
  if (spec.regexReplace) {
    try {
      const re = new RegExp(spec.regexReplace.pattern, spec.regexReplace.flags ?? 'g');
      out = out.replace(re, spec.regexReplace.replace);
    } catch {
      /* 非法正则保持原值 */
    }
  }
  if (spec.regexMatch) {
    try {
      const m = out.match(new RegExp(spec.regexMatch));
      if (m) out = m[1] ?? m[0];
    } catch {
      /* ignore */
    }
  }
  return out;
}

function readValue(el: Element, spec: FieldSpec): string {
  let raw = '';
  if (spec.attr) {
    const attrs = Array.isArray(spec.attr) ? spec.attr : [spec.attr];
    for (const a of attrs) {
      const v = el.getAttribute(a);
      if (v && v.trim()) {
        raw = v;
        break;
      }
    }
  } else if (spec.html) {
    // 转成保留段落换行的纯文本（用于 Markdown 正文），而非 innerHTML 原始标签
    raw = htmlToText(el);
  } else {
    raw = spec.text === false ? (el.textContent ?? '') : (el.textContent ?? '');
    raw = normalizeText(raw);
  }
  return applyRegex(raw.trim(), spec);
}

const BLOCK_TAGS = new Set([
  'p',
  'div',
  'section',
  'article',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'table',
  'tr',
  'thead',
  'tbody',
]);
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'img', 'video', 'audio', 'iframe', 'svg']);

/** 把正文 DOM 序列化为纯文本：块级元素换行、<li> 加 -、链接保留可见文字 */
function htmlToText(root: Node): string {
  const out: string[] = [];
  const walk = (node: Node, listDepth = 0) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        out.push(child.textContent ?? '');
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const tag = (child as Element).tagName.toLowerCase();
      if (SKIP_TAGS.has(tag)) return;
      if (tag === 'br') {
        out.push('\n');
        return;
      }
      if (tag === 'li') {
        out.push(`${'  '.repeat(listDepth)}- `);
        walk(child, listDepth + 1);
        out.push('\n');
        return;
      }
      if (BLOCK_TAGS.has(tag)) {
        if (out.length > 0 && !out[out.length - 1].endsWith('\n')) out.push('\n');
        walk(child, listDepth + (tag === 'ul' || tag === 'ol' ? 1 : 0));
        if (!out[out.length - 1]?.endsWith('\n')) out.push('\n');
        return;
      }
      walk(child, listDepth);
    });
  };
  walk(root);
  return out
    .join('')
    .replace(/ /g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function resolveTarget(doc: Document, spec: FieldSpec): Element[] {
  // 折叠面板类：先按文字选中容器，再取内部 target
  if (spec.selectByText) {
    const { scope, text, target } = spec.selectByText;
    const wanted = text.toLowerCase();
    const hit = Array.from(doc.querySelectorAll(scope)).find((c) =>
      (c.textContent ?? '').toLowerCase().includes(wanted),
    );
    if (!hit) return [];
    return Array.from(hit.querySelectorAll(target));
  }
  const root = spec.scope ? (doc.querySelector(spec.scope) ?? doc) : doc;
  if (!spec.selector) return [];
  return Array.from(root.querySelectorAll(spec.selector));
}

/** 磁力按 info_hash 去重（大小写不敏感），保留首次出现（通常是官方源） */
function dedupeMagnets(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of list) {
    const hm = m.match(/xt=urn:btih:([a-z0-9]{32,40})/i);
    const key = hm ? hm[1].toLowerCase() : m;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(m);
    }
  }
  return out;
}

/** 按插件规则从单页 HTML 提取字段 */
export function extractPage(html: string, finalUrl: string, plugin: CollectorPlugin): CollectResult {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const field = (name: string): string[] => {
    const spec = plugin.fields[name];
    if (!spec) return [];
    let els: Element[];
    try {
      els = resolveTarget(doc, spec);
    } catch {
      return [];
    }
    const picked = spec.multiple ? els : els.slice(spec.nth ?? 0, (spec.nth ?? 0) + 1);
    return picked.map((el) => readValue(el, spec)).filter((v) => v.length > 0);
  };

  const urlField = (name: string): string[] =>
    field(name)
      .map((v) => absolutize(v, finalUrl))
      .filter(Boolean);

  const title = field('title')[0] ?? doc.title ?? '';
  const description = field('description')[0] ?? '';
  const thumbnail = urlField('thumbnail')[0] ?? '';
  const images = Array.from(new Set(urlField('images')));
  const magnets = dedupeMagnets(urlField('magnets'));

  return { title, description, thumbnail, images, magnets };
}

/** 从磁力链接提取可读名称 */
export function magnetName(magnet: string): string {
  try {
    const u = new URL(magnet);
    return decodeURIComponent(u.searchParams.get('dn') ?? '');
  } catch {
    const m = magnet.match(/[?&]dn=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }
}

/** 从磁力链接提取 tracker 数量 */
export function magnetTrackerCount(magnet: string): number {
  try {
    const u = new URL(magnet);
    return u.searchParams.getAll('tr').length;
  } catch {
    return (magnet.match(/[?&]tr=/g) ?? []).length;
  }
}
