// 资源列表：瀑布流无限滚动 / 四种视图 + 分页 + 浮动批量操作栏
// 首页与回收站共用，页面差异（数据接口、卡片菜单、批量操作）通过 props 注入
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { Button, Spinner, tokens } from '@fluentui/react-components';
import type { Resource } from '../../types/models';
import type { SelectionController } from '../Selection';
import { BatchBar } from '../Selection';
import { CardContextMenu, type ContextMenuItem } from '../CardContextMenu';
import { ResourceCard } from '../ResourceCard';
import { Pagination } from '../Pagination';
import { useInView } from '../../hooks/useInView';
import { useSharedStyles } from '../../styles/shared';
import { useUIStore } from '../../stores/uiStore';
import { settingsApi } from '../../lib/tauri';
import { clampPageSize } from '../../lib/listSettings';

export interface ResourceListProps {
  /** react-query 键前缀（变化时自动重新查询） */
  queryKey: unknown[];
  /** 拉取第 page 页数据 */
  fetchPage: (page: number, pageSize: number) => Promise<{ items: Resource[]; total: number }>;
  /** 批量选择控制器 */
  selection: SelectionController;
  /** 卡片右键菜单项（返回空数组则不挂右键菜单） */
  menuItems: (r: Resource) => ContextMenuItem[];
  /** 点击卡片，不传则卡片不可点击 */
  onOpen?: (r: Resource) => void;
  /** 卡片是否显示勾选框（无权限时传 false） */
  selectable?: boolean;
  showTags?: boolean;
  showDescription?: boolean;
  /** 页码受控（首页用 URL 参数），不传则由组件内部维护 */
  page?: number;
  onPageChange?: (p: number) => void;
  /** 额外清空选择的时机（如筛选条件变化），传序列化后的值 */
  resetKey?: string;
  /** 空列表文案 */
  emptyText: string;
  /** "已加载全部 N {unit}" 中的量词 */
  allLoadedUnit?: string;
  /** 列表上方的标题 / 筛选区域 */
  toolbar?: ReactNode;
  /** 批量操作栏内的按钮 */
  actions?: ReactNode;
  batchBusy?: boolean;
}

export function ResourceList({
  queryKey,
  fetchPage,
  selection,
  menuItems,
  onOpen,
  selectable = true,
  showTags = true,
  showDescription = true,
  page: pageProp,
  onPageChange,
  resetKey,
  emptyText,
  allLoadedUnit = '项',
  toolbar,
  actions,
  batchBusy = false,
}: ResourceListProps) {
  const s = useSharedStyles();
  const { viewMode } = useUIStore();
  const [innerPage, setInnerPage] = useState(1);
  const page = pageProp ?? innerPage;
  const setPage = useCallback(
    (p: number) => {
      if (onPageChange) onPageChange(p);
      else setInnerPage(p);
    },
    [onPageChange],
  );

  // 每页条数与无限滚动取自公开设置：管理员在设置页配置，所有用户生效
  const { data: pubSettings } = useQuery<Record<string, string>>({
    queryKey: ['public-settings'],
    queryFn: settingsApi.getPublic,
    staleTime: 30_000,
  });
  // 设置里存的是字符串，需钳制：非数字回落默认，越界钳到 1–200
  const pageSize = clampPageSize(pubSettings?.list_page_size);
  // 无限滚动只对瀑布流生效，其余视图一律走分页
  const isInfinite = viewMode === 'masonry' && pubSettings?.list_infinite_scroll !== '0';

  const infiniteQuery = useInfiniteQuery({
    queryKey: [...queryKey, 'infinite', pageSize],
    queryFn: ({ pageParam }) => fetchPage(pageParam, pageSize),
    initialPageParam: 1,
    getNextPageParam: (last, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.items.length, 0);
      return loaded < last.total ? allPages.length + 1 : undefined;
    },
    enabled: isInfinite,
  });

  const pagedQuery = useQuery({
    queryKey: [...queryKey, 'paged', page, pageSize],
    queryFn: () => fetchPage(page, pageSize),
    enabled: !isInfinite,
  });

  const items: Resource[] = isInfinite
    ? (infiniteQuery.data?.pages.flatMap((p) => p.items) ?? [])
    : (pagedQuery.data?.items ?? []);
  const total = isInfinite ? (infiniteQuery.data?.pages[0]?.total ?? 0) : (pagedQuery.data?.total ?? 0);
  const isLoading = isInfinite ? infiniteQuery.isLoading : pagedQuery.isLoading;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // 每页条数调大后当前页可能越界（比如停在第 5 页，但按新条数只剩 3 页），回退到最后一页
  useEffect(() => {
    if (!isInfinite && !isLoading && total > 0 && page > totalPages) {
      setPage(totalPages);
    }
  }, [isInfinite, isLoading, total, totalPages, page, setPage]);

  // 无限滚动哨兵
  const { ref: sentinelRef, inView } = useInView<HTMLDivElement>({ enabled: isInfinite });
  useEffect(() => {
    if (isInfinite && inView && infiniteQuery.hasNextPage && !infiniteQuery.isFetchingNextPage) {
      infiniteQuery.fetchNextPage();
    }
  }, [isInfinite, inView, infiniteQuery]);

  // 翻页 / 视图 / 筛选变化时清空选择
  useEffect(() => {
    selection.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, page, resetKey, pageSize]);

  // 分页模式翻页后回到顶部
  useEffect(() => {
    if (!isInfinite) {
      document.querySelector<HTMLElement>('[data-scroll-container]')?.scrollTo({ top: 0 });
      window.scrollTo({ top: 0 });
    }
  }, [page, isInfinite]);

  const itemIds = items.map((r) => r.id);
  const allChecked = items.length > 0 && items.every((r) => selection.selected.has(r.id));

  return (
    <div className={s.pageContainer}>
      {toolbar}

      {isLoading ? (
        <Spinner label="加载中..." />
      ) : items.length === 0 ? (
        <div className={s.emptyState}>{emptyText}</div>
      ) : (
        <div
          className={
            viewMode === 'masonry'
              ? s.masonry
              : viewMode === 'card-v'
                ? s.gridV
                : viewMode === 'card-h'
                  ? s.gridH
                  : s.tableList
          }
        >
          {items.map((r) => (
            <CardContextMenu key={r.id} items={menuItems(r)}>
              <ResourceCard
                resource={r}
                checked={selection.selected.has(r.id)}
                onToggle={(c) => selection.toggle(r.id, c)}
                selectable={selectable}
                onClick={onOpen ? () => onOpen(r) : undefined}
                showDescription={showDescription}
                showTags={showTags}
                viewMode={viewMode}
              />
            </CardContextMenu>
          ))}
        </div>
      )}

      {/* 分页（非瀑布流视图） */}
      {!isInfinite && <Pagination page={page} totalPages={totalPages} total={total} onChange={setPage} />}

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
              已加载全部 {total} {allLoadedUnit}
            </span>
          )}
        </div>
      )}

      <BatchBar
        selectedCount={selection.size}
        allChecked={allChecked}
        total={items.length}
        onSelectAll={(c) => selection.selectAll(itemIds, c)}
        onInvert={() => selection.invert(itemIds)}
        onClear={selection.clear}
        busy={batchBusy}
      >
        {actions}
      </BatchBar>
    </div>
  );
}
