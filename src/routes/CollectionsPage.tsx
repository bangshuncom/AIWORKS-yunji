// 合集管理页（自定义分类）
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Badge,
  Spinner,
  tokens,
} from '@fluentui/react-components';
import {
  AddRegular,
  RenameRegular,
  DeleteRegular,
} from '@fluentui/react-icons';
import { collectionApi, assetUrl } from '../lib/tauri';
import type { Collection } from '../types/models';
import { useSelection, CardCheckbox, BatchBar, runBatchAction } from '../components/batch';
import { CardContextMenu } from '../components/CardContextMenu';
import { Pagination } from '../components/Pagination';
import { useSharedStyles } from '../styles/shared';
import { usePerms } from '../hooks/usePerms';

export function CollectionsPage() {
  const s = useSharedStyles();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const perms = usePerms();
  const canCollection = perms.can('collection_own');
  const selection = useSelection();
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['collections', 'paged', page],
    queryFn: () => collectionApi.listPage(page, 36),
  });
  const collections = data?.items;
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 36));

  // 删除后当前页空了自动回退；翻页清空选择
  useEffect(() => {
    if (!isLoading && page > 1 && collections && collections.length === 0) setPage(page - 1);
  }, [isLoading, collections, page]);
  useEffect(() => {
    selection.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const deleteMut = useMutation({
    mutationFn: (id: number) => collectionApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['collections'] }),
  });

  const handleDelete = (c: Collection) => {
    if (confirm(`确认删除合集「${c.title}」？关联资源不会被删除。`)) {
      deleteMut.mutate(c.id);
    }
  };

  const batchDelete = () =>
    runBatchAction(
      selection,
      (n) => `确认删除选中的 ${n} 个合集？关联资源不会被删除。`,
      (id) => collectionApi.delete(id),
      () => queryClient.invalidateQueries({ queryKey: ['collections'] }),
    );

  return (
    <div className={s.pageContainer}>
      <div className={s.pageHeader}>
        <h2 style={{ margin: 0 }}>合集管理</h2>
      </div>
      {canCollection && (
        <div>
          <Button
            icon={<AddRegular />}
            appearance="primary"
            onClick={() => navigate('/collection-edit')}
          >
            新建合集
          </Button>
        </div>
      )}

      {isLoading ? (
        <Spinner label="加载中..." />
      ) : !collections || collections.length === 0 ? (
        <div className={s.emptyState}>
          <p>暂无合集，点击「新建合集」创建</p>
        </div>
      ) : (
        <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
          {collections.map((c) => (
            <CardContextMenu
              key={c.id}
              items={canCollection ? [
                {
                  icon: <RenameRegular />,
                  label: '编辑',
                  onClick: () => navigate(`/collection-edit/${c.id}`),
                },
                {
                  icon: <DeleteRegular />,
                  label: '删除',
                  danger: true,
                  onClick: () => handleDelete(c),
                },
              ] : []}
            >
              <div
                className="batch-card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  padding: '12px',
                  borderRadius: '8px',
                  border: `1px solid ${tokens.colorNeutralStroke2}`,
                  backgroundColor: tokens.colorNeutralBackground1,
                  position: 'relative',
                  cursor: 'pointer',
                }}
                onClick={() => navigate(`/collection/${c.id}`)}
              >
                {canCollection && (
                  <CardCheckbox
                    checked={selection.selected.has(c.id)}
                    onChange={(checked) => selection.toggle(c.id, checked)}
                  />
                )}
                {(c.thumbnail_path || c.cover_path) ? (
                  <img
                    style={{
                      width: '100%',
                      aspectRatio: '16 / 9',
                      objectFit: 'cover',
                      borderRadius: '6px',
                      backgroundColor: tokens.colorNeutralBackground3,
                    }}
                    src={assetUrl(c.thumbnail_path || c.cover_path!)}
                    alt={c.title}
                    loading="lazy"
                  />
                ) : (
                  <div
                    style={{
                      width: '100%',
                      aspectRatio: '16 / 9',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '6px',
                      backgroundColor: tokens.colorNeutralBackground3,
                      fontSize: '32px',
                      color: tokens.colorNeutralForeground3,
                    }}
                  >
                    {c.title.slice(0, 1)}
                  </div>
                )}
                <div className={s.cardBody} style={{ flex: 1 }}>
                  <span className={s.cardTitle}>{c.title}</span>
                  {c.description && <span className={s.cardDesc}>{c.description}</span>}
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <Badge appearance="filled" color="informative">
                      {c.resource_count ?? 0} 资源
                    </Badge>
                    <Badge appearance="outline">
                      {c.visibility === 'public' ? '公开' : '私有'}
                    </Badge>
                  </div>
                </div>
              </div>
            </CardContextMenu>
          ))}
        </div>
        <Pagination page={page} totalPages={totalPages} total={total} onChange={setPage} />
        </>
      )}


      {/* 浮动批量操作栏（选中至少一个合集后显示，需合集管理权限） */}
      {canCollection && (
        <BatchBar
          selectedCount={selection.size}
          allChecked={!!collections && collections.length > 0 && collections.every((c) => selection.selected.has(c.id))}
          total={collections?.length ?? 0}
          onSelectAll={(c) => selection.selectAll((collections ?? []).map((x) => x.id), c)}
          onInvert={() => selection.invert((collections ?? []).map((x) => x.id))}
          onClear={selection.clear}
        >
          <Button
            appearance="primary"
            size="small"
            icon={<DeleteRegular />}
            onClick={batchDelete}
          >
            批量删除
          </Button>
        </BatchBar>
      )}
    </div>
  );
}