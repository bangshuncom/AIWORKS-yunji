// 合集详情页：缩略图 + 标题/元信息 + Markdown 正文 + 合集内文章列表
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button, Spinner, Badge, MessageBar, MessageBarBody, makeStyles, tokens } from '@fluentui/react-components';
import { ArrowLeftRegular, EditRegular, DocumentRegular, KeyRegular, LockClosedRegular } from '@fluentui/react-icons';
import { collectionApi, resourceApi, assetUrl } from '../lib/tauri';
import { isForbidden, errorText } from '../lib/errors';
import { PasswordDialog } from '../components/common/PasswordDialog';
import type { Collection, Resource } from '../types/models';
import { usePerms } from '../hooks/usePerms';
import { MarkdownView } from '../components/MarkdownView';
import { formatTime, relativeTime } from '../lib/format';
import { useLanguage } from '../i18n';

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
  meta: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    flexWrap: 'wrap',
    fontSize: '13px',
    color: tokens.colorNeutralForeground3,
  },
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
  resTitle: {
    fontSize: '15px',
    fontWeight: 600,
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  resDesc: {
    fontSize: '12px',
    color: tokens.colorNeutralForeground3,
    marginTop: '2px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
});

export function CollectionDetailPage() {
  const styles = useStyles();
  const { t } = useLanguage();
  const { cid } = useParams<{ cid: string }>();
  const navigate = useNavigate();
  const canEdit = usePerms().can('collection_own');
  const cidNum = Number(cid);
  // 访问密码：无权限时自动弹一次密码框
  const [pwdOpen, setPwdOpen] = useState(false);
  // 已通过密码校验但仍读不到内容 = 私有合集且权限不足
  const [pwdPassed, setPwdPassed] = useState(false);

  const {
    data: collection,
    isLoading,
    error,
    refetch,
  } = useQuery<Collection>({
    queryKey: ['collection', cidNum],
    queryFn: () => collectionApi.get(cidNum),
    enabled: !!cid && !Number.isNaN(cidNum),
    // 权限不足属于预期结果，不必重试
    retry: (count, e) => !isForbidden(e) && count < 2,
  });

  const { data: resData } = useQuery<{ items: Resource[] }>({
    queryKey: ['collection-resources', cidNum],
    queryFn: () => resourceApi.list({ page: 1, page_size: 1000, collection_id: cidNum }),
    enabled: !!cid && !Number.isNaN(cidNum),
  });

  // 受保护合集：首次进入自动弹出密码框
  useEffect(() => {
    if (isForbidden(error) && !pwdPassed) setPwdOpen(true);
  }, [error, pwdPassed]);

  // 切换到其他合集时重置解锁状态
  useEffect(() => {
    setPwdPassed(false);
    setPwdOpen(false);
  }, [cidNum]);

  if (isLoading) return <Spinner label={t('common.loading')} />;
  if (!collection) {
    // 私有 / 设了访问密码的合集：给出密码入口
    if (isForbidden(error)) {
      return (
        <div className={styles.container}>
          <Button appearance="subtle" icon={<ArrowLeftRegular />} onClick={() => navigate('/collections')}>
            {t('collectionDetail.back')}
          </Button>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '12px',
              padding: '48px 24px',
              textAlign: 'center',
              border: `1px solid ${tokens.colorNeutralStroke2}`,
              borderRadius: '12px',
              backgroundColor: tokens.colorNeutralBackground1,
            }}
          >
            <LockClosedRegular style={{ fontSize: '32px', color: tokens.colorNeutralForeground3 }} />
            <div style={{ fontSize: '16px', fontWeight: 600 }}>{t('collectionDetail.protected')}</div>
            <div style={{ fontSize: '13px', color: tokens.colorNeutralForeground3 }}>
              {pwdPassed ? t('collectionDetail.pwdPassedNoAccess') : t('collectionDetail.privateOrPwd')}
            </div>
            <Button appearance="primary" icon={<KeyRegular />} onClick={() => setPwdOpen(true)}>
              {t('detail.inputPassword')}
            </Button>
          </div>
          <PasswordDialog
            open={pwdOpen}
            title={t('detail.inputPassword')}
            onSubmit={(pwd) => collectionApi.checkAccess(cidNum, pwd)}
            onUnlocked={() => {
              setPwdPassed(true);
              void refetch();
            }}
            onClose={() => setPwdOpen(false)}
          />
        </div>
      );
    }
    return (
      <MessageBar intent="warning">
        <MessageBarBody>{errorText(error) || t('collectionDetail.notFound')}</MessageBarBody>
      </MessageBar>
    );
  }

  const resources = resData?.items ?? [];

  return (
    <div className={styles.container}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Button appearance="subtle" icon={<ArrowLeftRegular />} onClick={() => navigate('/collections')}>
          {t('collectionDetail.back')}
        </Button>
        {canEdit && (
          <Button
            appearance="outline"
            icon={<EditRegular />}
            onClick={() => navigate(`/collection-edit/${collection.id}`)}
          >
            {t('collectionDetail.edit')}
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
            <span title={formatTime(collection.created_at)}>
              {t('collectionDetail.createdAt')} {relativeTime(collection.created_at, t)}
            </span>
            <span title={formatTime(collection.updated_at)}>
              {t('collectionDetail.updatedAt')} {relativeTime(collection.updated_at, t)}
            </span>
            <Badge appearance="outline">
              {collection.visibility === 'public' ? t('collectionEdit.public') : t('collectionEdit.private')}
            </Badge>
            {collection.has_password && (
              <Badge appearance="outline" icon={<KeyRegular />}>
                {t('collections.needPassword')}
              </Badge>
            )}
            <Badge appearance="filled" color="informative">
              {collection.resource_count ?? resources.length} {t('collectionDetail.articles')}
            </Badge>
          </div>
          {collection.description && (
            <p className={styles.descBlock} style={{ marginTop: '12px' }}>
              {collection.description.replace(/\s*\n+\s*/g, ' ').trim()}
            </p>
          )}
        </div>
      </div>

      {collection.content && <MarkdownView content={collection.content} className={styles.content} />}

      {/* 合集内文章列表 */}
      <div>
        <h3 style={{ fontSize: '16px', fontWeight: 600, margin: '0 0 12px' }}>
          <DocumentRegular style={{ marginRight: '6px', verticalAlign: 'middle' }} />
          {t('collectionDetail.articlesTitle')}（{resources.length}）
        </h3>
        {resources.length === 0 ? (
          <div
            style={{ color: tokens.colorNeutralForeground3, fontSize: '13px', padding: '20px', textAlign: 'center' }}
          >
            {t('collectionDetail.noArticles')}
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
                  <div
                    style={{
                      width: '64px',
                      height: '48px',
                      borderRadius: '6px',
                      backgroundColor: tokens.colorNeutralBackground3,
                      flexShrink: 0,
                    }}
                  />
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
