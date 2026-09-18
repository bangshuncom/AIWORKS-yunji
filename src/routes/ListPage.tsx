// 首页：资源列表（瀑布流无限滚动 / 其他视图分页 + 浮动批量操作栏）
import { useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Spinner,
  tokens,
} from '@fluentui/react-components';
import {
  DeleteRegular,
  CheckmarkCircleRegular,
  EditRegular,
  FolderRegular,
  TagRegular,
  PeopleRegular,
  DismissRegular,
} from '@fluentui/react-icons';
import { resourceApi, tagApi, collectionApi, authorApi } from '../lib/tauri';
import { usePerms } from '../hooks/usePerms';
import { useUIStore } from '../stores/uiStore';
import { useInView } from '../hooks/useInView';
import { useSelection, BatchBar, runBatchAction } from '../components/batch';
import { BatchResourceOps } from '../components/BatchResourceOps';
import { CardContextMenu } from '../components/CardContextMenu';
import { ResourceCard } from '../components/ResourceCard';
import { Pagination } from '../components/Pagination';
import { useSharedStyles } from '../styles/shared';

const PAGE_SIZE = 24;

export function ListPage() {
  const s = useSharedStyles();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const canArticle = usePerms().can('article_own');
  const { viewMode } = useUIStore();
  const queryClient = useQueryClient();
  const selection = useSelection();

  const page = parseInt(searchParams.get('page') ?? '1', 10) || 1;
  const search = searchParams.get('q') ?? '';
  const tagId = searchParams.get('tag') ? Number(searchParams.get('tag')) : undefined;
  const collectionId = searchParams.get('collection') ? Number(searchParams.get('collection')) : undefined;
  const categoryId = searchParams.get('category') ? Number(searchParams.get('category')) : undefined;
  const authorId = searchParams.get('author') ? Number(searchParams.get('author')) : undefined;

  // 瀑布流：无限滚动；其他视图：传统分页
  const isInfinite = viewMode === 'masonry';

  const filterParams = useMemo(
    () => ({
      search: search || undefined,
      tag_id: tagId,
      collection_id: collectionId,
      category_id: categoryId,
      user_id: authorId,
      sort: 'created_at' as const,
      direction: 'desc' as const,
    }),
    [search, tagId, collectionId, categoryId, authorId],
  );

  // 瀑布流无限加载
  const infiniteQuery = useInfiniteQuery({
    queryKey: ['resources', 'infinite', filterParams],
    queryFn: ({ pageParam }) =>
      resourceApi.list({ ...filterParams, page: pageParam, page_size: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.items.length, 0);
      return loaded < last.total ? allPages.length + 1 : undefined;
    },
    enabled: isInfinite,
  });

  // 其他视图分页
  const pagedParams = useMemo(
    () => ({ ...filterParams, page, page_size: PAGE_SIZE }),
    [filterParams, page],
  );
  const pagedQuery = useQuery({
    queryKey: ['resources', 'paged', pagedParams],
    queryFn: () => resourceApi.list(pagedParams),
    enabled: !isInfinite,
  });

  const data = isInfinite
    ? {
        items: infiniteQuery.data?.pages.flatMap((p) => p.items) ?? [],
        total: infiniteQuery.data?.pages[0]?.total ?? 0,
      }
    : { items: pagedQuery.data?.items ?? [], total: pagedQuery.data?.total ?? 0 };
  const isLoading = isInfinite ? infiniteQuery.isLoading : pagedQuery.isLoading;

  // 无限滚动哨兵
  const { ref: sentinelRef, inView } = useInView<HTMLDivElement>({ enabled: isInfinite });
  useEffect(() => {
    if (isInfinite && inView && infiniteQuery.hasNextPage && !infiniteQuery.isFetchingNextPage) {
      infiniteQuery.fetchNextPage();
    }
  }, [isInfinite, inView, infiniteQuery]);

  // 当前筛选的标签/合集名称（复用全局缓存；直接带参数进入时自动拉取）
  const { data: tags } = useQuery({
    queryKey: ['tags'],
    queryFn: tagApi.list,
    enabled: tagId !== undefined,
  });
  const { data: collections } = useQuery({
    queryKey: ['collections'],
    queryFn: collectionApi.list,
    enabled: collectionId !== undefined,
  });
  const { data: authors } = useQuery({
    queryKey: ['authors'],
    queryFn: authorApi.list,
    enabled: authorId !== undefined,
  });
  const activeTagName = tagId !== undefined
    ? (tags?.find((t) => t.id === tagId)?.name ?? `标签 #${tagId}`)
    : undefined;
  const activeCollectionTitle = collectionId !== undefined
    ? (collections?.find((c) => c.id === collectionId)?.title ?? `合集 #${collectionId}`)
    : undefined;
  const activeAuthor = authorId !== undefined
    ? authors?.find((a) => a.id === authorId)
    : undefined;
  const activeAuthorName = authorId !== undefined
    ? (activeAuthor ? (activeAuthor.nickname || activeAuthor.username) : `作者 #${authorId}`)
    : undefined;

  const deleteMut = useMutation({
    mutationFn: (rid: number) => resourceApi.delete(rid),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['resources'] });
      queryClient.invalidateQueries({ queryKey: ['trash'] });
    },
  });

  const updateParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    setSearchParams(next);
  };

  const setPageNum = (n: number) => {
    const next = new URLSearchParams(searchParams);
    next.set('page', String(n));
    setSearchParams(next);
  };

  // 翻页/筛选/视图变化时清空选择
  const listKey = JSON.stringify({ f: filterParams, page, viewMode });
  useEffect(() => {
    selection.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey]);

  // 分页模式翻页后回到顶部
  useEffect(() => {
    if (!isInfinite) {
      document.querySelector<HTMLElement>('[data-scroll-container]')?.scrollTo({ top: 0 });
      window.scrollTo({ top: 0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, isInfinite]);

  const items = data.items;
  const total = data.total;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const itemIds = items.map((r) => r.id);
  const allChecked = items.length > 0 && items.every((r) => selection.selected.has(r.id));

  const batchDelete = () =>
    runBatchAction(
      selection,
      (n) => `将选中的 ${n} 项移入回收站？`,
      (id) => deleteMut.mutateAsync(id),
      () => queryClient.invalidateQueries({ queryKey: ['resources'] }),
    );

  return (
    <div className={s.pageContainer}>
      {/* 顶部：当前筛选上下文（合集/标签） */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', minHeight: '32px' }}>
          {activeCollectionTitle && (
            <FilterChip
              kind="合集"
              name={activeCollectionTitle}
              icon={<FolderRegular />}
              loading={collectionId !== undefined && !collections}
              onClear={() => updateParam('collection', null)}
            />
          )}
          {activeTagName && (
            <FilterChip
              kind="标签"
              name={activeTagName}
              icon={<TagRegular />}
              loading={tagId !== undefined && !tags}
              onClear={() => updateParam('tag', null)}
            />
          )}
          {activeAuthorName && (
            <FilterChip
              kind="作者"
              name={activeAuthorName}
              icon={<PeopleRegular />}
              loading={authorId !== undefined && !authors}
              onClear={() => updateParam('author', null)}
            />
          )}
        </div>
      </div>

      {/* 列表 */}
      {isLoading ? (
        <Spinner label="加载中..." />
      ) : items.length === 0 ? (
        <div className={s.emptyState}>
          <CheckmarkCircleRegular fontSize={36} />
          <p>暂无资源</p>
        </div>
      ) : (
        <div className={
          viewMode === 'masonry' ? s.masonry
          : viewMode === 'card-v' ? s.gridV
          : viewMode === 'card-h' ? s.gridH
          : s.tableList
        }>
          {items.map((r) => (
            <CardContextMenu
              key={r.id}
              items={canArticle ? [
                {
                  icon: <EditRegular />,
                  label: '编辑',
                  onClick: () => navigate(`/edit/${r.id}`),
                },
                {
                  icon: <DeleteRegular />,
                  label: '删除',
                  danger: true,
                  onClick: () => {
                    if (confirm(`将「${r.title}」移入回收站？`)) deleteMut.mutate(r.id);
                  },
                },
              ] : []}
            >
              <ResourceCard
                resource={r}
                checked={selection.selected.has(r.id)}
                onToggle={(c) => selection.toggle(r.id, c)}
                selectable={canArticle}
                onClick={() => navigate(`/detail/${r.id}`)}
                viewMode={viewMode}
                showDescription={false}
                showTags={false}
              />
            </CardContextMenu>
          ))}
        </div>
      )}

      {/* 分页（非瀑布流视图） */}
      {!isInfinite && (
        <Pagination page={page} totalPages={totalPages} total={total} onChange={setPageNum} />
      )}

      {/* 无限滚动哨兵（瀑布流） */}
      {isInfinite && items.length > 0 && (
        <div ref={sentinelRef} style={{ display: 'flex', justifyContent: 'center', padding: '16px 0 8px' }}>
          {infiniteQuery.isFetchingNextPage ? (
            <Spinner size="tiny" label="加载更多…" />
          ) : infiniteQuery.hasNextPage ? (
            <Button size="small" appearance="subtle" onClick={() => infiniteQuery.fetchNextPage()}>
              加载更多
            </Button>
          ) : (
            <span style={{ fontSize: '12px', color: tokens.colorNeutralForeground3 }}>
              已加载全部 {total} 篇
            </span>
          )}
        </div>
      )}

      {/* 浮动批量操作栏（需文章管理权限） */}
      {canArticle && (
        <BatchBar
          selectedCount={selection.size}
          allChecked={allChecked}
          total={items.length}
          onSelectAll={(c) => selection.selectAll(itemIds, c)}
          onInvert={() => selection.invert(itemIds)}
          onClear={selection.clear}
          busy={deleteMut.isPending}
        >
          <BatchResourceOps selection={selection} />
          <Button
            appearance="primary"
            size="small"
            icon={<DeleteRegular />}
            onClick={batchDelete}
            disabled={deleteMut.isPending}
          >
            批量删除
          </Button>
        </BatchBar>
      )}
    </div>
  );
}

/** 顶部当前筛选上下文胶囊：合集 / 标签，带移除按钮 */
function FilterChip({
  kind,
  name,
  icon,
  loading,
  onClear,
}: {
  kind: string;
  name: string;
  icon: React.ReactNode;
  loading?: boolean;
  onClear: () => void;
}) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        height: '32px',
        padding: '0 6px 0 10px',
        borderRadius: '16px',
        backgroundColor: tokens.colorBrandBackground2,
        color: tokens.colorBrandForeground1,
        fontSize: '13px',
        maxWidth: '360px',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center' }}>{icon}</span>
      <span style={{ color: tokens.colorNeutralForeground3, flexShrink: 0 }}>{kind}</span>
      <strong
        title={name}
        style={{
          fontWeight: 600,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {loading ? '加载中…' : name}
      </strong>
      <button
        type="button"
        title={`清除${kind}筛选`}
        onClick={onClear}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '20px',
          height: '20px',
          padding: 0,
          border: 'none',
          borderRadius: '50%',
          background: 'transparent',
          color: 'inherit',
          cursor: 'pointer',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = tokens.colorBrandBackground2Hover;
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
        }}
      >
        <DismissRegular fontSize={12} />
      </button>
    </div>
  );
}
