// 资源卡片：ListPage 和 TrashPage 共用，支持四种视图模式
import type { ReactNode } from 'react';
import { Badge } from '@fluentui/react-components';
import { assetUrl } from '../lib/tauri';
import { relativeTime } from '../lib/format';
import { ITEM_TYPE_META } from '../types/models';
import type { Resource } from '../types/models';
import { useSharedStyles } from '../styles/shared';
import { useLanguage } from '../i18n';
import { CardCheckbox } from './Selection';
import type { ViewMode } from '../stores/uiStore';

export interface ResourceCardProps {
  resource: Resource;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  selectable?: boolean;
  onClick?: () => void;
  /** 卡片底部额外内容（如回收站的恢复/删除按钮） */
  footer?: ReactNode;
  /** 标题下方的额外徽章（如回收站的"已删除"标签） */
  badges?: ReactNode;
  /** 标签点击回调，不传则不显示标签 */
  onTagClick?: (tagId: number) => void;
  /** 是否显示描述（默认 true） */
  showDescription?: boolean;
  /** 是否显示标签（默认 true） */
  showTags?: boolean;
  /** 视图模式 */
  viewMode?: ViewMode;
  /** 右键菜单事件转发（供 CardContextMenu 的 MenuTrigger 注入） */
  onContextMenu?: React.MouseEventHandler;
}

export function ResourceCard({
  resource: r,
  checked,
  onToggle,
  selectable = true,
  onClick,
  footer,
  badges,
  onTagClick,
  showDescription = true,
  showTags = true,
  viewMode = 'masonry',
  onContextMenu,
}: ResourceCardProps) {
  const s = useSharedStyles();
  const { t } = useLanguage();

  const handleCardClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-batch-checkbox]')) return;
    onClick?.();
  };

  const checkbox = selectable && <CardCheckbox checked={checked} onChange={onToggle} />;

  const thumbEl = r.thumbnail_path ? <img src={assetUrl(r.thumbnail_path)} alt={r.title} loading="lazy" /> : null;

  const placeholderChar = r.title.slice(0, 1);

  const titleEl = <span className={s.cardTitle}>{r.title}</span>;

  const descEl = showDescription && r.description ? <span className={s.cardDesc}>{r.description}</span> : null;

  const metaEl = (
    <div className={s.cardMeta}>
      <span>{relativeTime(r.created_at, t)}</span>
      {r.item_types?.map((ty) => {
        const meta = ITEM_TYPE_META[ty];
        return meta ? (
          <span key={ty} title={t(meta.labelKey)} style={{ fontSize: '14px', lineHeight: 1 }}>
            {meta.icon}
          </span>
        ) : null;
      })}
      {r.has_password && (
        <span title={t('resourceCard.needPassword')} style={{ fontSize: '14px', lineHeight: 1 }}>
          🔒
        </span>
      )}
      {badges}
    </div>
  );

  // 标签单独成行，避免与附件类型图标挤在一起被误认为异常图标
  const tagsEl =
    showTags && onTagClick && r.tags && r.tags.length > 0 ? (
      <div className={s.cardTags}>
        {r.tags.slice(0, 3).map((tag) => (
          <Badge
            key={tag.id}
            appearance="tint"
            color="brand"
            size="small"
            title={t('resourceCard.filterByTag', { name: tag.name })}
            style={{ cursor: 'pointer' }}
            onClick={(e) => {
              e.stopPropagation();
              onTagClick(tag.id);
            }}
          >
            {tag.name}
          </Badge>
        ))}
        {r.tags.length > 3 && (
          <Badge appearance="tint" color="brand" size="small">
            +{r.tags.length - 3}
          </Badge>
        )}
      </div>
    ) : null;

  // === 瀑布流 ===
  if (viewMode === 'masonry') {
    return (
      <div className={`batch-card ${s.masonryCard}`} onClick={handleCardClick} onContextMenu={onContextMenu}>
        {checkbox}
        {thumbEl ? (
          <img className={s.thumb} src={assetUrl(r.thumbnail_path)} alt={r.title} loading="lazy" />
        ) : (
          <div className={s.thumbPlaceholder}>{placeholderChar}</div>
        )}
        <div className={s.cardBody}>
          {titleEl}
          {descEl}
          {metaEl}
          {tagsEl}
        </div>
        {footer}
      </div>
    );
  }

  // === 16:9 竖向卡片 ===
  if (viewMode === 'card-v') {
    return (
      <div className={`batch-card ${s.gridVCard}`} onClick={handleCardClick} onContextMenu={onContextMenu}>
        {checkbox}
        {thumbEl ? (
          <img className={s.gridVThumb} src={assetUrl(r.thumbnail_path)} alt={r.title} loading="lazy" />
        ) : (
          <div
            className={s.gridVThumb}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '32px',
              color: 'inherit',
              opacity: 0.4,
            }}
          >
            {placeholderChar}
          </div>
        )}
        <div className={s.cardBody}>
          {titleEl}
          {descEl}
          {metaEl}
          {tagsEl}
        </div>
        {footer}
      </div>
    );
  }

  // === 横向卡片 ===
  if (viewMode === 'card-h') {
    return (
      <div className={`batch-card ${s.gridHCard}`} onClick={handleCardClick} onContextMenu={onContextMenu}>
        {checkbox}
        {thumbEl ? (
          <img className={s.gridHThumb} src={assetUrl(r.thumbnail_path)} alt={r.title} loading="lazy" />
        ) : (
          <div className={s.gridHThumbPlaceholder}>{placeholderChar}</div>
        )}
        <div className={s.gridHBody}>
          {titleEl}
          {descEl}
          {metaEl}
          {tagsEl}
        </div>
        {footer}
      </div>
    );
  }

  // === 表格列表 ===
  return (
    <div className={`batch-card ${s.tableRow}`} onClick={handleCardClick} onContextMenu={onContextMenu}>
      {checkbox}
      {thumbEl ? (
        <img className={s.tableThumb} src={assetUrl(r.thumbnail_path)} alt={r.title} loading="lazy" />
      ) : (
        <div className={s.tableThumbPlaceholder}>{placeholderChar}</div>
      )}
      <div className={s.tableBody}>
        {titleEl}
        {metaEl}
        {tagsEl}
      </div>
      {footer}
    </div>
  );
}
