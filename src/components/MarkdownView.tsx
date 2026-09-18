// Markdown 渲染器（基于 Vditor.md2html）
// 正文图片可点击放大（ImageLightbox 遮罩预览，支持多图左右切换）
import { useEffect, useRef, useState } from 'react';
import Vditor from 'vditor';
import 'vditor/dist/index.css';
import { rewriteAssetHtml, torrentApi } from '../lib/tauri';
import { ImageLightbox } from './ImageLightbox';

interface MarkdownViewProps {
  content: string;
  className?: string;
}

export function MarkdownView({ content, className }: MarkdownViewProps) {
  const [html, setHtml] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  // 正文图片全屏预览：-1 关闭，>=0 为当前索引
  const [preview, setPreview] = useState(-1);
  // 打开预览时快照的图片列表
  const [previewImages, setPreviewImages] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    const md = content || '';
    if (!md.trim()) {
      setHtml('');
      return;
    }
    Vditor.md2html(md, {
      mode: 'light',
      hljs: { style: 'github', lineNumber: false },
      math: { engine: 'KaTeX' },
      cdn: '/vditor',
    }).then((result) => {
      if (!cancelled) setHtml(rewriteAssetHtml(result, 'view'));
    });
    return () => { cancelled = true; };
  }, [content]);

  // 内容变化后重置预览状态
  useEffect(() => {
    setPreview(-1);
  }, [content]);

  // 收集正文内全部图片的 src（用于放大预览与切换）
  const collectImages = (): string[] => {
    if (!containerRef.current) return [];
    return Array.from(containerRef.current.querySelectorAll('img'))
      .map((img) => img.getAttribute('src') || '')
      .filter(Boolean);
  };

  // 点击处理：附件链接用系统默认软件打开；图片打开全屏预览
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // 附件链接
    const anchor = target.closest<HTMLAnchorElement>('a[data-asset]');
    if (anchor) {
      e.preventDefault();
      const rel = anchor.dataset.asset;
      if (rel) {
        torrentApi.openFile(rel).catch((err) => {
          console.error('打开附件失败:', err);
        });
      }
      return;
    }
    // 正文图片：点击放大
    const img = target.closest<HTMLImageElement>('img');
    if (img) {
      const src = img.getAttribute('src');
      if (src) {
        const all = collectImages();
        setPreviewImages(all);
        const idx = all.indexOf(src);
        setPreview(idx >= 0 ? idx : 0);
      }
    }
  };

  if (!html) return null;

  return (
    <>
      <div
        ref={containerRef}
        className={className}
        onClick={handleClick}
        dangerouslySetInnerHTML={{ __html: html }}
        style={{ cursor: 'default' }}
      />
      <ImageLightbox
        images={previewImages}
        index={preview}
        onIndexChange={setPreview}
        onClose={() => setPreview(-1)}
      />
    </>
  );
}
