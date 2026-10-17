// Markdown 编辑器（基于 Vditor）
import { useEffect, useRef } from 'react';
import Vditor from 'vditor';
import 'vditor/dist/index.css';
import { rewriteAssetDom, rewriteAssetHtml, collectorApi } from '../lib/tauri';
import { tOutside } from '../i18n';

export interface UploadedAsset {
  /** 存储相对路径，如 content/20260912_123.jpg */
  path: string;
  /** 原始文件名（用于 alt/链接文案） */
  name: string;
}

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  height?: number;
  placeholder?: string;
  /** 上传图片/附件：调用方打开文件选择器并调用后端上传命令，返回存储相对路径 */
  upload?: (kind: 'image' | 'file') => Promise<UploadedAsset | null>;
}

// Material 图标（currentColor，跟随 Vditor 工具栏配色）
const ICON_IMAGE =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/></svg>';
const ICON_ATTACH =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg>';

export function MarkdownEditor({ value, onChange, height = 480, placeholder, upload }: MarkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const vditorRef = useRef<Vditor | null>(null);
  const readyRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const uploadRef = useRef(upload);
  const busyRef = useRef(false);
  onChangeRef.current = onChange;
  uploadRef.current = upload;

  // --- 粘贴远程图片本地化 ---
  // Vditor 粘贴富文本时会把 <img src="https://..."> 转成远程链接的 markdown。
  // 粘贴后扫描编辑器内容中的远程图片链接，逐个下载到本地 content/ 目录，
  // 再把 markdown 中的远程 URL 替换为本地相对路径。
  const localizingRef = useRef(false);
  const lastScanRef = useRef('');
  const scanAndLocalize = async (): Promise<boolean> => {
    const vd = vditorRef.current;
    if (!vd || !readyRef.current) return false;
    const current = vd.getValue();
    // 匹配 markdown 图片语法中的远程 http(s) URL（含空 alt、带 title 的形态）
    const re = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/g;
    const urls = [...current.matchAll(re)].map((m) => m[1]);
    if (urls.length === 0) return false;
    if (current === lastScanRef.current) return false; // 上轮已处理过同样内容
    lastScanRef.current = current;
    if (localizingRef.current) return true;
    localizingRef.current = true;
    const failed: string[] = [];
    try {
      let next = current;
      let done = 0;
      for (const url of urls) {
        try {
          const saved = await collectorApi.downloadImage(url, '');
          if (saved) {
            next = next.split(url).join(saved);
            done++;
          }
        } catch (e) {
          // 单张失败跳过，保留原远程链接
          failed.push(`${url.slice(0, 60)}… ${e instanceof Error ? e.message : ''}`);
        }
      }
      if (next !== current) {
        vd.setValue(next);
        onChangeRef.current(next);
      }
      if (done > 0) {
        vd.tip(
          tOutside('markdown.localized', { n: done }) +
            (failed.length > 0 ? tOutside('markdown.localizedFailSuffix', { n: failed.length }) : ''),
        );
      } else if (failed.length > 0) {
        vd.tip(
          tOutside('markdown.localizeFailed', { error: failed[0] }) +
            (failed.length > 1 ? tOutside('markdown.moreFailures', { n: failed.length }) : ''),
        );
      }
    } finally {
      localizingRef.current = false;
    }
    return true;
  };
  const handlePasteLocalize = () => {
    // Vditor 解析大段粘贴内容需要时间：多轮延迟扫描，直到发现并处理远程图片
    for (const delay of [100, 400, 1000, 2000]) {
      setTimeout(() => {
        void scanAndLocalize();
      }, delay);
    }
  };

  // 初始化 Vditor 实例（仅一次）
  useEffect(() => {
    // 固化成本地变量：cleanup 运行时 React 可能已经把 ref 置空，
    // 那时再读 containerRef.current 就解绑不掉 paste 监听了
    const el = containerRef.current;
    if (!el) return;

    // IR 即时渲染的图片节点由 Lute 直接插入 DOM（不走 preview 钩子），
    // 用 MutationObserver 监听并把本地相对路径转成 asset URL；
    // 同时顺带触发远程图片本地化扫描（不依赖 paste 事件——
    // Vditor 可能在内部拦截/停止冒泡，导致容器上的 paste 监听不可靠）
    const observer = new MutationObserver(() => {
      rewriteAssetDom(el);
      void scanAndLocalize();
    });
    observer.observe(el, { childList: true, subtree: true });

    // 兜底：仍监听 paste 事件（若 Vditor 未拦截则更快响应）
    const onPaste = () => void handlePasteLocalize();
    el.addEventListener('paste', onPaste);

    const doUpload = async (vditor: Vditor, kind: 'image' | 'file') => {
      const uploader = uploadRef.current;
      if (!uploader || busyRef.current) return;
      busyRef.current = true;
      try {
        const asset = await uploader(kind);
        if (!asset) return;
        const snippet = kind === 'image' ? `\n![${asset.name}](${asset.path})\n` : `[${asset.name}](${asset.path})`;
        vditor.insertValue(snippet);
      } catch (e) {
        vditor.tip(e instanceof Error ? e.message : tOutside('markdown.uploadFailed'));
      } finally {
        busyRef.current = false;
      }
    };

    const vditor = new Vditor(el, {
      height,
      mode: 'ir',
      placeholder,
      lang: 'zh_CN',
      cdn: '/vditor',
      cache: { enable: false },
      toolbar: [
        'emoji',
        'headings',
        'bold',
        'italic',
        'strike',
        'link',
        '|',
        'list',
        'ordered-list',
        'check',
        'outdent',
        'indent',
        '|',
        'quote',
        'line',
        'code',
        'inline-code',
        'insert-before',
        'insert-after',
        '|',
        {
          name: 'upload-image',
          tip: tOutside('general.uploadImage'),
          icon: ICON_IMAGE,
          click: () => void doUpload(vditor, 'image'),
        },
        {
          name: 'upload-file',
          tip: tOutside('markdown.uploadFile'),
          icon: ICON_ATTACH,
          click: () => void doUpload(vditor, 'file'),
        },
        'table',
        '|',
        'undo',
        'redo',
        '|',
        'fullscreen',
        'edit-mode',
        'both',
        'preview',
        'info',
        'help',
      ],
      preview: {
        hljs: { style: 'github' },
        // 分屏/全屏预览：把本地相对路径转成 asset URL
        transform: (html: string) => rewriteAssetHtml(html, 'editor'),
        // IR 模式行内渲染的图片走 DOM 钩子
        parse: (el: HTMLElement) => rewriteAssetDom(el),
      },
      input: (val: string) => {
        onChangeRef.current(val);
      },
      after: () => {
        readyRef.current = true;
        vditor.setValue(value || '');
      },
    });
    vditorRef.current = vditor;

    return () => {
      observer.disconnect();
      el.removeEventListener('paste', onPaste);
      // StrictMode 开发模式下会立即卸载再挂载，此时 after 还没回调
      // Vditor.destroy 访问未初始化的 element 会崩溃，用 try-catch + ready 标志保护
      if (readyRef.current) {
        try {
          vditor.destroy();
        } catch {
          /* noop */
        }
        readyRef.current = false;
      }
      vditorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外部 value 变化时同步（避免用户输入时的循环）
  useEffect(() => {
    const vd = vditorRef.current;
    if (vd && readyRef.current && vd.getValue() !== value) {
      vd.setValue(value || '');
    }
  }, [value]);

  return <div ref={containerRef} />;
}
