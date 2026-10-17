// 详情页头部：缩略图 + 标题 + 作者 / 时间 / 阅读权限 / 标签 / 描述
import { useNavigate } from 'react-router-dom';
import { Avatar, Badge } from '@fluentui/react-components';
import { assetUrl } from '../../lib/tauri';
import { formatTime, relativeTime } from '../../lib/format';
import type { Resource } from '../../types/models';
import { useStyles } from './shared';

export function ResourceHeader({ resource }: { resource: Resource }) {
  const styles = useStyles();
  const navigate = useNavigate();

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
              title={`查看 ${resource.author.nickname || resource.author.username} 的全部文章`}
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
          <span title={formatTime(resource.created_at)}>创建于 {relativeTime(resource.created_at)}</span>
          <span title={formatTime(resource.updated_at)}>更新于 {relativeTime(resource.updated_at)}</span>
          {resource.read_level === 0 ? (
            <Badge color="success" appearance="outline">
              公开
            </Badge>
          ) : (
            <Badge color="warning" appearance="outline">
              需权限 {resource.read_level}
            </Badge>
          )}
        </div>
        {resource.tags && resource.tags.length > 0 && (
          <div className={styles.tags} style={{ marginTop: '10px' }}>
            {resource.tags.map((t) => (
              <Badge
                key={t.id}
                appearance="filled"
                color="informative"
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/?tag=${t.id}`)}
              >
                {t.name}
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
