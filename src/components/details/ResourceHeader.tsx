// 详情页头部：缩略图 + 标题 + 作者 / 时间 / 阅读权限 / 标签 / 描述
import { useNavigate } from 'react-router-dom';
import { Avatar, Badge } from '@fluentui/react-components';
import { assetUrl } from '../../lib/tauri';
import { formatTime, relativeTime } from '../../lib/format';
import type { Resource } from '../../types/models';
import { useStyles } from './shared';
import { useLanguage } from '../../i18n';

export function ResourceHeader({ resource }: { resource: Resource }) {
  const styles = useStyles();
  const navigate = useNavigate();
  const { t } = useLanguage();

  return (
    <div className={styles.header}>
      {resource.thumbnail_path && (
        <img className={styles.thumb} src={assetUrl(resource.thumbnail_path)} alt={resource.title} loading="lazy" />
      )}
      <div className={styles.headerMain}>
        <h1 className={styles.title}>{resource.title}</h1>
        <div className={styles.meta}>
          {resource.author && (
            <button
              type="button"
              onClick={() => navigate(`/?author=${resource.author!.id}`)}
              title={t('resourceHeader.viewAllArticles', {
                name: resource.author.nickname || resource.author.username,
              })}
              className={styles.authorChip}
            >
              <Avatar
                size={24}
                name={resource.author.nickname || resource.author.username}
                image={resource.author.avatar_path ? { src: assetUrl(resource.author.avatar_path) } : undefined}
              />
              {resource.author.nickname || resource.author.username}
            </button>
          )}
          <span title={formatTime(resource.created_at)}>
            {t('resourceHeader.createdAt')} {relativeTime(resource.created_at, t)}
          </span>
          <span title={formatTime(resource.updated_at)}>
            {t('resourceHeader.updatedAt')} {relativeTime(resource.updated_at, t)}
          </span>
          {resource.read_level === 0 ? (
            <Badge color="success" appearance="outline">
              {t('collections.public')}
            </Badge>
          ) : (
            <Badge color="warning" appearance="outline">
              {t('resourceHeader.needLevel', { level: resource.read_level })}
            </Badge>
          )}
        </div>
        {resource.tags && resource.tags.length > 0 && (
          <div className={styles.tags} style={{ marginTop: '10px' }}>
            {resource.tags.map((tag) => (
              <Badge
                key={tag.id}
                appearance="filled"
                color="informative"
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/?tag=${tag.id}`)}
              >
                {tag.name}
              </Badge>
            ))}
          </div>
        )}
        {resource.description && (
          <p className={styles.descBlock} style={{ marginTop: '12px' }}>
            {resource.description.replace(/\s*\n+\s*/g, ' ').trim()}
          </p>
        )}
      </div>
    </div>
  );
}
