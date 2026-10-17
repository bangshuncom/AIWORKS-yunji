// 合集管理页（自定义分类）
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Badge, Spinner, tokens } from '@fluentui/react-components';
import { AddRegular, RenameRegular, DeleteRegular } from '@fluentui/react-icons';
import { collectionApi, assetUrl } from '../lib/tauri';
import { confirmDanger } from '../lib/dialog';
import type { Collection } from '../types/models';
import { useSelection, CardCheckbox, BatchBar, runBatchAction } from '../components/Selection';
import { CardContextMenu } from '../components/CardContextMenu';
import { Pagination } from '../components/Pagination';
import { useSharedStyles } from '../styles/shared';
import { usePerms } from '../hooks/usePerms';
import { useLanguage } from '../i18n';

export function CollectionsPage() {
  const s = useSharedStyles();
  const { t } = useLanguage();
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

  const handleDelete = async (c: Collection) => {
    if (await confirmDanger(t('collections.deleteConfirm', { title: c.title }))) {
      deleteMut.mutate(c.id);
    }
  };

  const batchDelete = () =>
    runBatchAction(
      selection,
      (n) => t('collections.batchDeleteConfirm', { n }),
      (id) => collectionApi.delete(id),
      () => queryClient.invalidateQueries({ queryKey: ['collections'] }),
    );

  return (
    <div className={s.pageContainer}>
      <div className={s.pageHeader}>
        <h2 style={{ margin: 0 }}>{t('collections.title')}</h2>
      </div>
      {canCollection && (
        <div>
          <Button icon={<AddRegular />} appearance="primary" onClick={() => navigate('/collection-edit')}>
            {t('collections.new')}
          </Button>
        </div>
      )}

      {isLoading ? (
        <Spinner label={t('common.loading')} />
      ) : !collections || collections.length === 0 ? (
        <div className={s.emptyState}>
          <p>{t('collections.empty')}</p>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
            {collections.map((c) => (
              <CardContextMenu
                key={c.id}
                items={
                  canCollection
                    ? [
                        {
                          icon: <RenameRegular />,
                          label: t('common.edit'),
                          onClick: () => navigate(`/collection-edit/${c.id}`),
                        },
                        {
                          icon: <DeleteRegular />,
                          label: t('common.delete'),
                          danger: true,
                          onClick: () => handleDelete(c),
                        },
                      ]
                    : []
                }
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
                  {c.thumbnail_path || c.cover_path ? (
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
                        {c.resource_count ?? 0} {t('collections.resource')}
                      </Badge>
                      <Badge appearance="outline">
                        {c.visibility === 'public' ? t('collections.public') : t('collections.private')}
                      </Badge>
                      {c.has_password && (
                        <span title={t('collections.needPassword')} style={{ fontSize: '14px', lineHeight: 1 }}>
                          🔒
                        </span>
                      )}
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
          onSelectAll={(c) =>
            selection.selectAll(
              (collections ?? []).map((x) => x.id),
              c,
            )
          }
          onInvert={() => selection.invert((collections ?? []).map((x) => x.id))}
          onClear={selection.clear}
        >
          <Button appearance="primary" size="small" icon={<DeleteRegular />} onClick={batchDelete}>
            {t('collections.batchDelete')}
          </Button>
        </BatchBar>
      )}
    </div>
  );
}
