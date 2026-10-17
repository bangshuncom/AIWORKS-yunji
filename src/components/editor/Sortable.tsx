// 拖拽排序项：附件项与图集项（dnd-kit）
import type { ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ReOrderDotsVerticalRegular } from '@fluentui/react-icons';
import { convertFileSrc } from '@tauri-apps/api/core';
import { assetUrl } from '../../lib/tauri';
import type { EditItem, EditImage } from './shared';
import { useStyles } from './shared';
import { useLanguage } from '../../i18n';

// 可排序的附件项
export function SortableItem({ item, children }: { item: EditItem; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item._id });
  const { t } = useLanguage();
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      {...attributes}
    >
      {children}
      <button
        {...listeners}
        style={{ cursor: 'grab', border: 'none', background: 'transparent', padding: '4px' }}
        title={t('sortable.dragHint')}
      >
        <ReOrderDotsVerticalRegular />
      </button>
    </div>
  );
}

// 可排序的图集项
export function SortableImage({ img, onDelete }: { img: EditImage; onDelete: () => void }) {
  const styles = useStyles();
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: String(img.id) });
  const { t } = useLanguage();
  // 三种来源：本地待上传 / 远程待本地化 / 已落库
  const src = img.localPath ? convertFileSrc(img.localPath) : img.remoteUrl ? img.remoteUrl : assetUrl(img.file_path);
  const badge = img.localPath ? t('sortable.pendingSave') : img.remoteUrl ? t('sortable.pendingLocalize') : '';
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className={styles.galleryItem}
    >
      <img
        src={src}
        className={styles.galleryImg}
        alt=""
        title={img.localPath ? t('sortable.uploadOnSave') : img.remoteUrl ? t('sortable.downloadOnSave') : ''}
        referrerPolicy="no-referrer"
        {...listeners}
      />
      {badge && <span className={styles.galleryPending}>{badge}</span>}
      <button className={styles.galleryDelete} onClick={onDelete}>
        ×
      </button>
    </div>
  );
}
