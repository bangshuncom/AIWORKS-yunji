// 回收站（瀑布流无限滚动 / 其他视图分页 + 浮动批量操作栏）
import { useEffect, useState } from 'react';
import {
  Button,
  Spinner,
  Card,
  tokens,
} from '@fluentui/react-components';
import { ArrowCounterclockwiseRegular, DeleteRegular } from '@fluentui/react-icons';
import { useNavigate } from 'react-router-dom';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resourceApi } from '../lib/tauri';
import { useUIStore } from '../stores/uiStore';
import type { Resource } from '../types/models';
import { useSelection, BatchBar, runBatchAction } from '../components/batch';
import { ResourceCard } from '../components/ResourceCard';
import { CardContextMenu } from '../components/CardContextMenu';
import { Pagination } from '../components/Pagination';
import { useInView } from '../hooks/useInView';
import { useSharedStyles } from '../styles/shared';

const PAGE_SIZE = 24;

export function TrashPage() {
  const s = useSharedStyles();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { viewMode } = useUIStore();
  const selection = useSelection();
  const [page, setPage] = useState(1);

  const isInfinite = viewMode === 'masonry';

  const infiniteQuery = useInfiniteQuery({
    queryKey: ['trash', 'infinite'],
    queryFn: ({ pageParam }) => resourceApi.listTrashPage(pageParam, PAGE_SIZE),
    initialPageParam: 1,
    getNextPageParam: (last, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.items.length, 0);
      return loaded < last.total ? allPages.length + 1 : undefined;
    },
    enabled: isInfinite,
  });

  const pagedQuery = useQuery({
    queryKey: ['trash', 'paged', page],
    queryFn: () => resourceApi.listTrashPage(page, PAGE_SIZE),
    enabled: !isInfinite,
  });

  const items: Resource[] = isInfinite
    ? infiniteQuery.data?.pages.flatMap((p) => p.items) ?? []
    : pagedQuery.data?.items ?? [];
  const total = isInfinite
    ? infiniteQuery.data?.pages[0]?.total ?? 0
    : pagedQuery.data?.total ?? 0;
  const isLoading = isInfinite ? infiniteQuery.isLoading : pagedQuery.isLoading;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const { ref: sentinelRef, inView } = useInView<HTMLDivElement>({ enabled: isInfinite });
  useEffect(() => {
    if (isInfinite && inView && infiniteQuery.hasNextPage && !infiniteQuery.isFetchingNextPage) {
      infiniteQuery.fetchNextPage();
    }
  }, [isInfinite, inView, infiniteQuery]);

  // 视图/翻页变化时清空选择；分页翻页回到顶部
  useEffect(() => {
    selection.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, page]);
  useEffect(() => {
    if (!isInfinite) {
      document.querySelector<HTMLElement>('[data-scroll-container]')?.scrollTo({ top: 0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, isInfinite]);

  const restoreMut = useMutation({
    mutationFn: (rid: number) => resourceApi.restore(rid),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trash'] });
      queryClient.invalidateQueries({ queryKey: ['resources'] });
    },
  });

  const permanentDeleteMut = useMutation({
    mutationFn: (rid: number) => resourceApi.permanentDelete(rid),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['trash'] }),
  });

  const handlePermanentDelete = (r: Resource) => {
    if (confirm(`彻底删除「${r.title}」？此操作不可恢复，关联的所有文件将被清除。`))
      permanentDeleteMut.mutate(r.id);
  };

  const itemIds = items.map((r) => r.id);
  const allChecked = items.length > 0 && items.every((r) => selection.selected.has(r.id));
  const busy = restoreMut.isPending || permanentDeleteMut.isPending;

  return (
    <div className={s.pageContainer}>
      <div className={s.pageHeader}>
        <h2 style={{ margin: 0 }}>回收站</h2>
      </div>
      <div>
        <Button appearance="outline" onClick={() => navigate('/')}>返回首页</Button>
      </div>

      {isLoading ? (
        <Spinner label="加载中..." />
      ) : items.length === 0 ? (
        <Card>
          <div style={{ padding: '24px', textAlign: 'center', color: tokens.colorNeutralForeground2 }}>
            回收站为空
          </div>
        </Card>
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
              items={[
                {
                  icon: <ArrowCounterclockwiseRegular />,
                  label: '恢复',
                  onClick: () => restoreMut.mutate(r.id),
                },
                {
                  icon: <DeleteRegular />,
                  label: '彻底删除',
                  danger: true,
                  onClick: () => handlePermanentDelete(r),
                },
              ]}
            >
              <ResourceCard
                resource={r}
                checked={selection.selected.has(r.id)}
                onToggle={(c) => selection.toggle(r.id, c)}
                showDescription={false}
                viewMode={viewMode}
              />
            </CardContextMenu>
          ))}
        </div>
      )}

      {/* 分页（非瀑布流视图） */}
      {!isInfinite && (
        <Pagination page={page} totalPages={totalPages} total={total} onChange={setPage} />
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
              已加载全部 {total} 项
            </span>
          )}
        </div>
      )}

      {/* 浮动批量操作栏 */}
      <BatchBar
        selectedCount={selection.size}
        allChecked={allChecked}
        total={items.length}
        onSelectAll={(c) => selection.selectAll(itemIds, c)}
        onInvert={() => selection.invert(itemIds)}
        onClear={selection.clear}
        busy={busy}
      >
        <Button
          appearance="outline"
          size="small"
          icon={<ArrowCounterclockwiseRegular />}
          onClick={() =>
            runBatchAction(
              selection,
              (n) => `将选中的 ${n} 项恢复？`,
              (id) => restoreMut.mutateAsync(id),
              () => {
                queryClient.invalidateQueries({ queryKey: ['trash'] });
                queryClient.invalidateQueries({ queryKey: ['resources'] });
              },
            )
          }
          disabled={busy}
        >
          批量恢复
        </Button>
        <Button
          appearance="primary"
          size="small"
          icon={<DeleteRegular />}
          onClick={() =>
            runBatchAction(
              selection,
              (n) => `将选中的 ${n} 项彻底删除？此操作不可恢复。`,
              (id) => permanentDeleteMut.mutateAsync(id),
              () => queryClient.invalidateQueries({ queryKey: ['trash'] }),
            )
          }
          disabled={busy}
        >
          批量彻底删除
        </Button>
      </BatchBar>
    </div>
  );
}
