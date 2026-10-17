// 回收站（复用 ResourceList，本页只提供恢复 / 彻底删除操作）
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@fluentui/react-components';
import { ArrowCounterclockwiseRegular, DeleteRegular } from '@fluentui/react-icons';
import { resourceApi } from '../lib/tauri';
import { confirmDanger } from '../lib/dialog';
import { invalidateArticleData } from '../lib/invalidate';
import { useSelection, runBatchAction } from '../components/Selection';
import { ResourceList } from '../components/resources/ResourceList';
import { useLanguage } from '../i18n';
import type { Resource } from '../types/models';

export function TrashPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const selection = useSelection();
  const { t } = useLanguage();

  const restoreMut = useMutation({
    mutationFn: (rid: number) => resourceApi.restore(rid),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trash'] });
      // 恢复后文章重新回到列表，分类/合集/作者的计数都要加回去
      invalidateArticleData(queryClient);
    },
  });

  const permanentDeleteMut = useMutation({
    mutationFn: (rid: number) => resourceApi.permanentDelete(rid),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trash'] });
      invalidateArticleData(queryClient);
    },
  });

  const handlePermanentDelete = async (r: Resource) => {
    if (await confirmDanger(t('trash.confirmDelete', { title: r.title }))) permanentDeleteMut.mutate(r.id);
  };

  const busy = restoreMut.isPending || permanentDeleteMut.isPending;

  return (
    <ResourceList
      queryKey={['trash']}
      fetchPage={(p, pageSize) => resourceApi.listTrashPage(p, pageSize)}
      selection={selection}
      menuItems={(r) => [
        {
          icon: <ArrowCounterclockwiseRegular />,
          label: t('trash.restore'),
          onClick: () => restoreMut.mutate(r.id),
        },
        {
          icon: <DeleteRegular />,
          label: t('trash.permanentDelete'),
          danger: true,
          onClick: () => handlePermanentDelete(r),
        },
      ]}
      showDescription={false}
      emptyText={t('trash.empty')}
      toolbar={
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <h2 style={{ margin: 0 }}>{t('trash.title')}</h2>
          </div>
          <div>
            <Button appearance="outline" onClick={() => navigate('/')}>
              {t('trash.backHome')}
            </Button>
          </div>
        </>
      }
      actions={
        <>
          <Button
            appearance="outline"
            size="small"
            icon={<ArrowCounterclockwiseRegular />}
            onClick={() =>
              runBatchAction(
                selection,
                (n) => t('trash.confirmRestore', { n }),
                (id) => restoreMut.mutateAsync(id),
                () => {
                  queryClient.invalidateQueries({ queryKey: ['trash'] });
                  invalidateArticleData(queryClient);
                },
              )
            }
            disabled={busy}
          >
            {t('trash.batchRestore')}
          </Button>
          <Button
            appearance="primary"
            size="small"
            icon={<DeleteRegular />}
            onClick={() =>
              runBatchAction(
                selection,
                (n) => t('trash.confirmBatchDelete', { n }),
                (id) => permanentDeleteMut.mutateAsync(id),
                () => {
                  queryClient.invalidateQueries({ queryKey: ['trash'] });
                  invalidateArticleData(queryClient);
                },
              )
            }
            disabled={busy}
          >
            {t('trash.batchDelete')}
          </Button>
        </>
      }
      batchBusy={busy}
    />
  );
}
