// 图片全屏预览遮罩（通用组件）：文章图集与正文图片共用
// 支持左右切换、Esc 关闭、键盘方向键、计数器
import { useEffect, useCallback } from 'react';
import { Button, makeStyles } from '@fluentui/react-components';
import { ChevronLeftRegular, ChevronRightRegular, DismissRegular } from '@fluentui/react-icons';
import { useLanguage } from '../i18n';

const useStyles = makeStyles({
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.88)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  overlayImg: {
    maxWidth: '90vw',
    maxHeight: '85vh',
    objectFit: 'contain',
    userSelect: 'none',
    borderRadius: '8px',
  },
  closeBtn: { position: 'absolute', top: '24px', right: '24px', zIndex: 1001 },
  counter: {
    position: 'absolute',
    bottom: '24px',
    left: '50%',
    transform: 'translateX(-50%)',
    color: '#fff',
    fontSize: '14px',
    zIndex: 1001,
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: '4px 12px',
    borderRadius: '12px',
  },
});

export interface ImageLightboxProps {
  /** 图片 URL 列表 */
  images: string[];
  /** 当前索引（>=0 时显示） */
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

export function ImageLightbox({ images, index, onIndexChange, onClose }: ImageLightboxProps) {
  const styles = useStyles();
  const total = images.length;
  const { t } = useLanguage();
  const current = images[index];

  const prev = useCallback(() => {
    if (total > 1) onIndexChange((index - 1 + total) % total);
  }, [index, total, onIndexChange]);

  const next = useCallback(() => {
    if (total > 1) onIndexChange((index + 1) % total);
  }, [index, total, onIndexChange]);

  // 键盘：Esc 关闭，←/→ 切换
  useEffect(() => {
    if (index < 0 || !current) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [index, current, prev, next, onClose]);

  if (index < 0 || !current) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      {total > 1 && (
        <Button
          style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', left: '24px', zIndex: 1001 }}
          appearance="subtle"
          size="large"
          icon={<ChevronLeftRegular />}
          onClick={(e) => {
            e.stopPropagation();
            prev();
          }}
        />
      )}
      <img
        className={styles.overlayImg}
        src={current}
        alt={t('lightbox.preview', { n: index + 1 })}
        onClick={(e) => e.stopPropagation()}
      />
      {total > 1 && (
        <Button
          style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', right: '24px', zIndex: 1001 }}
          appearance="subtle"
          size="large"
          icon={<ChevronRightRegular />}
          onClick={(e) => {
            e.stopPropagation();
            next();
          }}
        />
      )}
      <Button
        className={styles.closeBtn}
        appearance="subtle"
        size="large"
        icon={<DismissRegular />}
        onClick={onClose}
      />
      {total > 1 && (
        <div className={styles.counter}>
          {index + 1} / {total}
        </div>
      )}
    </div>
  );
}
