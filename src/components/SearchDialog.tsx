// 全局搜索弹窗：遮罩 + 类型下拉 + 搜索输入 + 结果列表 + 分页
import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Input, Spinner, Dropdown, Option, tokens, makeStyles } from '@fluentui/react-components';
import { SearchRegular, DismissRegular } from '@fluentui/react-icons';
import { resourceApi, collectionApi, tagApi, authorApi, assetUrl } from '../lib/tauri';
import { Pagination } from './Pagination';
import { relativeTime } from '../lib/format';
import type { Resource, Collection, Tag, AuthorInfo } from '../types/models';
import { useLanguage } from '../i18n';

const PAGE_SIZE = 10;

type SearchType = 'article' | 'collection' | 'tag' | 'author';

const TYPE_OPTIONS: { key: SearchType; labelKey: string; placeholderKey: string }[] = [
  { key: 'article', labelKey: 'search.type.article', placeholderKey: 'search.placeholder.article' },
  { key: 'collection', labelKey: 'search.type.collection', placeholderKey: 'search.placeholder.collection' },
  { key: 'tag', labelKey: 'search.type.tag', placeholderKey: 'search.placeholder.tag' },
  { key: 'author', labelKey: 'search.type.author', placeholderKey: 'search.placeholder.author' },
];

const useStyles = makeStyles({
  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    backgroundColor: 'rgba(0,0,0,0.4)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingTop: '80px',
  },
  panel: {
    width: 'min(680px, 92vw)',
    maxHeight: 'min(80vh, 720px)',
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: '12px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '16px 20px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  typeDropdown: {
    width: '60px',
    flexShrink: 0,
  },
  input: {
    flex: 1,
  },
  closeBtn: {
    flexShrink: 0,
    width: '36px',
    height: '36px',
    borderRadius: '6px',
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    color: tokens.colorNeutralForeground2,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  body: {
    flex: 1,
    overflowY: 'auto',
    padding: '8px 0',
  },
  resultItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 20px',
    cursor: 'pointer',
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  thumb: {
    width: '48px',
    height: '48px',
    objectFit: 'cover',
    borderRadius: '6px',
    flexShrink: 0,
    backgroundColor: tokens.colorNeutralBackground3,
  },
  thumbPlaceholder: {
    width: '48px',
    height: '48px',
    borderRadius: '6px',
    flexShrink: 0,
    backgroundColor: tokens.colorNeutralBackground3,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '20px',
    fontWeight: 700,
    color: tokens.colorNeutralForeground3,
  },
  avatar: {
    width: '40px',
    height: '40px',
    objectFit: 'cover',
    borderRadius: '50%',
    flexShrink: 0,
    backgroundColor: tokens.colorNeutralBackground3,
  },
  avatarPlaceholder: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    flexShrink: 0,
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '18px',
    fontWeight: 700,
  },
  resultBody: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  resultTitle: {
    fontSize: '14px',
    fontWeight: 600,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  resultDesc: {
    fontSize: '12px',
    color: tokens.colorNeutralForeground2,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  resultMeta: {
    fontSize: '12px',
    color: tokens.colorNeutralForeground3,
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  emptyState: {
    padding: '60px 20px',
    textAlign: 'center',
    color: tokens.colorNeutralForeground3,
    fontSize: '14px',
  },
  footer: {
    padding: '8px 20px 12px',
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
});

interface SearchDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SearchDialog({ open, onClose }: SearchDialogProps) {
  const styles = useStyles();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [type, setType] = useState<SearchType>('article');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const panelRef = useRef<HTMLDivElement>(null);

  const typeMeta = TYPE_OPTIONS.find((o) => o.key === type)!;
  const typeLabel = t(typeMeta.labelKey);

  // 打开时聚焦输入框，关闭时重置
  useEffect(() => {
    if (open) {
      setTimeout(() => (panelRef.current?.querySelector('input[type="text"]') as HTMLInputElement | null)?.focus(), 50);
    } else {
      setKeyword('');
      setPage(1);
    }
  }, [open]);

  // 关键词或类型变化重置页码
  useEffect(() => {
    setPage(1);
  }, [keyword, type]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const enabled = open && keyword.trim().length > 0;

  const articleQuery = useQuery({
    queryKey: ['search', 'article', keyword, page],
    queryFn: () =>
      resourceApi.list({
        page,
        page_size: PAGE_SIZE,
        search: keyword,
        sort: 'created_at',
        direction: 'desc',
      }),
    enabled: enabled && type === 'article',
  });
  const collectionQuery = useQuery({
    queryKey: ['search', 'collection', keyword, page],
    queryFn: () => collectionApi.listPage(page, PAGE_SIZE, keyword),
    enabled: enabled && type === 'collection',
  });
  const tagQuery = useQuery({
    queryKey: ['search', 'tag', keyword, page],
    queryFn: () => tagApi.listPage(page, PAGE_SIZE, keyword),
    enabled: enabled && type === 'tag',
  });
  const authorQuery = useQuery({
    queryKey: ['search', 'author', keyword, page],
    queryFn: () => authorApi.listPage(page, PAGE_SIZE, keyword),
    enabled: enabled && type === 'author',
  });

  const go = useCallback(
    (path: string) => {
      onClose();
      navigate(path);
    },
    [navigate, onClose],
  );

  if (!open) return null;

  const total =
    type === 'article'
      ? (articleQuery.data?.total ?? 0)
      : type === 'collection'
        ? (collectionQuery.data?.total ?? 0)
        : type === 'tag'
          ? (tagQuery.data?.total ?? 0)
          : (authorQuery.data?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const isFetching =
    type === 'article'
      ? articleQuery.isFetching
      : type === 'collection'
        ? collectionQuery.isFetching
        : type === 'tag'
          ? tagQuery.isFetching
          : authorQuery.isFetching;

  const renderResults = () => {
    if (!enabled) {
      return <div className={styles.emptyState}>{t('search.prompt', { type: typeLabel })}</div>;
    }
    if (isFetching) {
      return (
        <div className={styles.emptyState}>
          <Spinner label={t('search.searching')} />
        </div>
      );
    }
    if (type === 'article') {
      const items: Resource[] = articleQuery.data?.items ?? [];
      if (items.length === 0) return <div className={styles.emptyState}>{t('search.noArticle')}</div>;
      return (
        <>
          {items.map((r) => (
            <div key={r.id} className={styles.resultItem} onClick={() => go(`/detail/${r.id}`)}>
              {r.thumbnail_path ? (
                <img className={styles.thumb} src={assetUrl(r.thumbnail_path)} alt="" />
              ) : (
                <div className={styles.thumbPlaceholder}>{r.title.charAt(0).toUpperCase()}</div>
              )}
              <div className={styles.resultBody}>
                <span className={styles.resultTitle}>{r.title}</span>
                <span className={styles.resultMeta}>
                  {r.author?.nickname || r.author?.username || t('search.unknown')}
                  <span>·</span>
                  {relativeTime(r.created_at, t)}
                </span>
              </div>
            </div>
          ))}
        </>
      );
    }
    if (type === 'collection') {
      const items: Collection[] = collectionQuery.data?.items ?? [];
      if (items.length === 0) return <div className={styles.emptyState}>{t('search.noCollection')}</div>;
      return (
        <>
          {items.map((c) => (
            <div key={c.id} className={styles.resultItem} onClick={() => go(`/collection/${c.id}`)}>
              {c.thumbnail_path || c.cover_path ? (
                <img className={styles.thumb} src={assetUrl(c.thumbnail_path || c.cover_path!)} alt="" />
              ) : (
                <div className={styles.thumbPlaceholder}>{c.title.charAt(0).toUpperCase()}</div>
              )}
              <div className={styles.resultBody}>
                <span className={styles.resultTitle}>{c.title}</span>
                <span className={styles.resultMeta}>
                  {c.resource_count != null && t('search.totalArticles', { n: c.resource_count })}
                  {c.description ? (
                    <>
                      <span>·</span>
                      {c.description}
                    </>
                  ) : null}
                </span>
              </div>
            </div>
          ))}
        </>
      );
    }
    if (type === 'tag') {
      const items: Tag[] = tagQuery.data?.items ?? [];
      if (items.length === 0) return <div className={styles.emptyState}>{t('search.noTag')}</div>;
      return (
        <>
          {items.map((tag) => (
            <div key={tag.id} className={styles.resultItem} onClick={() => go(`/?tag=${tag.id}`)}>
              <div className={styles.thumbPlaceholder}>#</div>
              <div className={styles.resultBody}>
                <span className={styles.resultTitle}>{tag.name}</span>
                <span className={styles.resultMeta}>
                  {tag.count != null && t('search.articleCount', { n: tag.count })}
                </span>
              </div>
            </div>
          ))}
        </>
      );
    }
    // author
    const items: AuthorInfo[] = authorQuery.data?.items ?? [];
    if (items.length === 0) return <div className={styles.emptyState}>{t('search.noAuthor')}</div>;
    return (
      <>
        {items.map((a) => (
          <div key={a.id} className={styles.resultItem} onClick={() => go(`/?author=${a.id}`)}>
            {a.avatar_path ? (
              <img className={styles.avatar} src={assetUrl(a.avatar_path)} alt="" />
            ) : (
              <div className={styles.avatarPlaceholder}>{(a.nickname || a.username).charAt(0).toUpperCase()}</div>
            )}
            <div className={styles.resultBody}>
              <span className={styles.resultTitle}>{a.nickname || a.username}</span>
              <span className={styles.resultMeta}>{t('search.articleCount', { n: a.resource_count })}</span>
            </div>
          </div>
        ))}
      </>
    );
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div ref={panelRef} className={styles.panel} onClick={(e) => e.stopPropagation()}>
        {/* 搜索栏：类型下拉 + 输入框 + 关闭 */}
        <div className={styles.header}>
          <Dropdown
            className={styles.typeDropdown}
            style={{ width: '120px', minWidth: '120px' }}
            value={typeLabel}
            selectedOptions={[type]}
            onOptionSelect={(_, d) => setType(d.optionValue as SearchType)}
          >
            {TYPE_OPTIONS.map((o) => (
              <Option key={o.key} value={o.key} text={t(o.labelKey)}>
                {t(o.labelKey)}
              </Option>
            ))}
          </Dropdown>
          <Input
            className={styles.input}
            placeholder={t(typeMeta.placeholderKey)}
            value={keyword}
            onChange={(_, d) => setKeyword(d.value)}
            contentBefore={<SearchRegular />}
          />
          <button className={styles.closeBtn} onClick={onClose} title={t('common.close')}>
            <DismissRegular />
          </button>
        </div>

        {/* 结果列表 */}
        <div className={styles.body}>{renderResults()}</div>

        {/* 分页 */}
        {totalPages > 1 && (
          <div className={styles.footer}>
            <Pagination page={page} totalPages={totalPages} total={total} onChange={setPage} />
          </div>
        )}
      </div>
    </div>
  );
}
