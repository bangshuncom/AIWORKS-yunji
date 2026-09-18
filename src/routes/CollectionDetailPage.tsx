// 合集详情页：缩略图 + 标题/元信息 + Markdown 正文 + 合集内文章列表
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Button,
  Spinner,
  Badge,
  MessageBar,
  MessageBarBody,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowLeftRegular,
  EditRegular,
  DocumentRegular,
} from '@fluentui/react-icons';
import { collectionApi, resourceApi, assetUrl } from '../lib/tauri';
import type { Collection, Resource } from '../types/models';
import { usePerms } from '../hooks/usePerms';
import { MarkdownView } from '../components/MarkdownView';
import { formatTime, relativeTime } from '../lib/format';

const useStyles = makeStyles({
  container: { display: 'flex', flexDirection: 'column', gap: '24px' },
  header: {
    display: 'flex',
    gap: '20px',
    alignItems: 'flex-start',
    '@media (max-width: 640px)': {
      flexDirection: 'column',
    },
  },
  thumb: {
    width: '212px',
    height: '150px',
    objectFit: 'cover',
    borderRadius: '10px',
    backgroundColor: tokens.colorNeutralBackground3,
    flexShrink: 0,
  },
  headerMain: { flex: 1, minWidth: 0 },
  title: { fontSize: '26px', fontWeight: 700, margin: 0, lineHeight: 1.3 },
  meta: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', fontSize: '13px', color: tokens.colorNeutralForeground3 },
  descBlock: {
    margin: 0,
    fontSize: '14px',
    lineHeight: 1.7,
    color: tokens.colorNeutralForeground2,
    fontStyle: 'italic',
    position: 'relative',
    paddingLeft: '18px',
    '&::before': {
      content: '"“"',
      position: 'absolute',
      left: 0,
      top: '-2px',
      fontSize: '22px',
      color: tokens.colorBrandForeground1,
      fontStyle: 'normal',
      lineHeight: 1,
    },
  },
  content: {
    padding: '20px 24px',
    borderRadius: '12px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    lineHeight: 1.8,
    fontSize: '15px',
    '& img': { maxWidth: '100%', borderRadius: '8px' },
    '& pre': { overflowX: 'auto', background: tokens.colorNeutralBackground2, padding: '12px', borderRadius: '8px' },
  },
  resList: { display: 'flex', flexDirection: 'column', gap: '10px' },
  resCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '14px 16px',
    borderRadius: '10px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    cursor: 'pointer',
    transition: 'background 0.15s',
    '&:hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  resTitle: { fontSize: '15px', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  resDesc: { fontSize: '12px', color: tokens.colorNeutralForeground3, marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
});

export function CollectionDetailPage() {
  const styles = useStyles();
  const { cid } = useParams<{ cid: string }>();
  const navigate = useNavigate();
  const canEdit = usePerms().can('collection_own');
  const cidNum = Number(cid);

  const { data: collection, isLoading } = useQuery<Collection>({
    queryKey: ['collection', cidNum],
    queryFn: () => collectionApi.get(cidNum),
    enabled: !!cid && !Number.isNaN(cidNum),
  });

  const { data: resData } = useQuery<{ items: Resource[] }>({
    queryKey: ['collection-resources', cidNum],
    queryFn: () => resourceApi.list({ page: 1, page_size: 1000, collection_id: cidNum }),
    enabled: !!cid && !Number.isNaN(cidNum),
  });

  if (isLoading) return <Spinner label="加载中..." />;
  if (!collection) {
    return (
      <MessageBar intent="warning">
        <MessageBarBody>合集不存在或已被删除</MessageBarBody>
      </MessageBar>
    );
  }

  const resources = resData?.items ?? [];

  return (
    <div className={styles.container}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Button appearance="subtle" icon={<ArrowLeftRegular />} onClick={() => navigate('/collections')}>
          返回合集
        </Button>
        {canEdit && (
          <Button appearance="outline" icon={<EditRegular />} onClick={() => navigate(`/collection-edit/${collection.id}`)}>
            编辑合集
          </Button>
        )}
      </div>

      {/* 标题 + 缩略图（左右布局，无自有封面时回退首个收录文章封面） */}
      <div className={styles.header}>
        {(collection.thumbnail_path || collection.cover_path) && (
          <img
            className={styles.thumb}
            src={assetUrl(collection.thumbnail_path || collection.cover_path!)}
            alt={collection.title}
            loading="lazy"
          />
        )}
        <div className={styles.headerMain}>
          <h1 className={styles.title}>{collection.title}</h1>
          <div className={styles.meta}>
            <span title={formatTime(collection.created_at)}>创建于 {relativeTime(collection.created_at)}</span>
            <span title={formatTime(collection.updated_at)}>更新于 {relativeTime(collection.updated_at)}</span>
            <Badge appearance="outline">{collection.visibility === 'public' ? '公开' : '私有'}</Badge>
            <Badge appearance="filled" color="informative">{collection.resource_count ?? resources.length} 篇文章</Badge>
          </div>
          {collection.description && (
            <p className={styles.descBlock} style={{ marginTop: '12px' }}>
              {collection.description.replace(/\s*\n+\s*/g, ' ').trim()}
            </p>
          )}
        </div>
      </div>

      {collection.content && (
        <MarkdownView content={collection.content} className={styles.content} />
      )}

      {/* 合集内文章列表 */}
      <div>
        <h3 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 12px' }}>
          <DocumentRegular style={{ marginRight: '6px', verticalAlign: 'middle' }} />
          合集文章（{resources.length}）
        </h3>
        {resources.length === 0 ? (
          <div style={{ color: tokens.colorNeutralForeground3, fontSize: '13px', padding: '20px', textAlign: 'center' }}>
            暂无文章
          </div>
        ) : (
          <div className={styles.resList}>
            {resources.map((r) => (
              <div key={r.id} className={styles.resCard} onClick={() => navigate(`/detail/${r.id}`)}>
                {r.thumbnail_path ? (
                  <img
                    src={assetUrl(r.thumbnail_path)}
                    alt=""
                    style={{ width: '64px', height: '48px', objectFit: 'cover', borderRadius: '6px', flexShrink: 0 }}
                    loading="lazy"
                  />
                ) : (
                  <div style={{ width: '64px', height: '48px', borderRadius: '6px', backgroundColor: tokens.colorNeutralBackground3, flexShrink: 0 }} />
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className={styles.resTitle}>{r.title}</div>
                  {r.description && <div className={styles.resDesc}>{r.description}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}