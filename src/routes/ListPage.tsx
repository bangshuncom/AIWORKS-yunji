// 首页：资源列表（复用 ResourceList，本页只提供筛选上下文与可用操作）
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, tokens } from '@fluentui/react-components';
import {
  DeleteRegular,
  EditRegular,
  FolderRegular,
  TagRegular,
  PeopleRegular,
  DismissRegular,
} from '@fluentui/react-icons';
import { resourceApi, tagApi, collectionApi, authorApi } from '../lib/tauri';
import { confirmDanger } from '../lib/dialog';
import { invalidateArticleData } from '../lib/invalidate';
import { usePerms } from '../hooks/usePerms';
import { useSelection, runBatchAction } from '../components/Selection';
import { BatchResourceOps } from '../components/BatchResourceOps';
import { ResourceList } from '../components/resources/ResourceList';
import type { ContextMenuItem } from '../components/CardContextMenu';

export function ListPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const canArticle = usePerms().can('article_own');
  const queryClient = useQueryClient();
  const selection = useSelection();

  const page = parseInt(searchParams.get('page') ?? '1', 10) || 1;
  const search = searchParams.get('q') ?? '';
  const tagId = searchParams.get('tag') ? Number(searchParams.get('tag')) : undefined;
  const collectionId = searchParams.get('collection') ? Number(searchParams.get('collection')) : undefined;
  const categoryId = searchParams.get('category') ? Number(searchParams.get('category')) : undefined;
  const authorId = searchParams.get('author') ? Number(searchParams.get('author')) : undefined;

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

  // 当前筛选的标签/合集/作者名称（复用全局缓存；直接带参数进入时自动拉取）
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
  const activeTagName = tagId !== undefined ? (tags?.find((t) => t.id === tagId)?.name ?? `标签 #${tagId}`) : undefined;
  const activeCollectionTitle =
    collectionId !== undefined
      ? (collections?.find((c) => c.id === collectionId)?.title ?? `合集 #${collectionId}`)
      : undefined;
  const activeAuthor = authorId !== undefined ? authors?.find((a) => a.id === authorId) : undefined;
  const activeAuthorName =
    authorId !== undefined
      ? activeAuthor
        ? activeAuthor.nickname || activeAuthor.username
        : `作者 #${authorId}`
      : undefined;

  const deleteMut = useMutation({
    mutationFn: (rid: number) => resourceApi.delete(rid),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trash'] });
      invalidateArticleData(queryClient);
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

  const menuItems = (r: { id: number; title: string }): ContextMenuItem[] =>
    canArticle
      ? [
          {
            icon: <EditRegular />,
            label: '编辑',
            onClick: () => navigate(`/edit/${r.id}`),
          },
          {
            icon: <DeleteRegular />,
            label: '删除',
            danger: true,
            onClick: async () => {
              if (await confirmDanger(`将「${r.title}」移入回收站？`)) deleteMut.mutate(r.id);
            },
          },
        ]
      : [];

  const batchDelete = () =>
    runBatchAction(
      selection,
      (n) => `将选中的 ${n} 项移入回收站？`,
      (id) => deleteMut.mutateAsync(id),
      () => invalidateArticleData(queryClient),
    );

  return (
    <ResourceList
      queryKey={['resources', filterParams]}
      fetchPage={(p, pageSize) => resourceApi.list({ ...filterParams, page: p, page_size: pageSize })}
      selection={selection}
      menuItems={menuItems}
      onOpen={(r) => navigate(`/detail/${r.id}`)}
      selectable={canArticle}
      showDescription={false}
      showTags={false}
      page={page}
      onPageChange={setPageNum}
      resetKey={JSON.stringify(filterParams)}
      emptyText="暂无资源"
      allLoadedUnit="篇"
      toolbar={
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
      }
      actions={
        <>
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
        </>
      }
      batchBusy={deleteMut.isPending}
    />
  );
}

/** 顶部当前筛选上下文胶囊：合集 / 标签 / 作者，带移除按钮 */
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
