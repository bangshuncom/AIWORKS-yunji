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
import type { Resource } from '../types/models';

export function TrashPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const selection = useSelection();

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
    if (await confirmDanger(`彻底删除「${r.title}」？此操作不可恢复，关联的所有文件将被清除。`))
      permanentDeleteMut.mutate(r.id);
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
      showDescription={false}
      emptyText="回收站为空"
      toolbar={
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <h2 style={{ margin: 0 }}>回收站</h2>
          </div>
          <div>
            <Button appearance="outline" onClick={() => navigate('/')}>
              返回首页
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
                (n) => `将选中的 ${n} 项恢复？`,
                (id) => restoreMut.mutateAsync(id),
                () => {
                  queryClient.invalidateQueries({ queryKey: ['trash'] });
                  invalidateArticleData(queryClient);
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
                () => {
                  queryClient.invalidateQueries({ queryKey: ['trash'] });
                  invalidateArticleData(queryClient);
                },
              )
            }
            disabled={busy}
          >
            批量彻底删除
          </Button>
        </>
      }
      batchBusy={busy}
    />
  );
}
