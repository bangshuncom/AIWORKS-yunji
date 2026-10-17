// 标签管理页
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  CardHeader,
  Input,
  Button,
  Label,
  Badge,
  Spinner,
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  DialogOpenChangeData,
  tokens,
} from '@fluentui/react-components';
import { AddRegular, RenameRegular, DeleteRegular, MergeRegular } from '@fluentui/react-icons';
import { tagApi } from '../lib/tauri';
import { confirmDanger } from '../lib/dialog';
import type { Tag } from '../types/models';
import { useSelection, CardCheckbox, BatchBar, runBatchAction } from '../components/Selection';
import { CardContextMenu } from '../components/CardContextMenu';
import { Pagination } from '../components/Pagination';
import { useSharedStyles } from '../styles/shared';
import { usePerms } from '../hooks/usePerms';

const PAGE_SIZE = 100;

export function TagsPage() {
  const s = useSharedStyles();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canTag = usePerms().can('tag');
  const selection = useSelection();
  const [newName, setNewName] = useState('');
  const [renameId, setRenameId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameOpen, setRenameOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<number | null>(null);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['tags', 'paged', page],
    queryFn: () => tagApi.listPage(page, PAGE_SIZE),
  });
  const tags = data?.items;
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // 删除后当前页空了，自动回退一页
  useEffect(() => {
    if (!isLoading && page > 1 && tags && tags.length === 0) setPage(page - 1);
  }, [isLoading, tags, page]);
  // 翻页清空选择
  useEffect(() => {
    selection.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const createMut = useMutation({
    mutationFn: (name: string) => tagApi.create(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      setNewName('');
    },
  });

  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) => tagApi.rename(id, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      setRenameOpen(false);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => tagApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tags'] }),
  });

  const mergeMut = useMutation({
    mutationFn: ({ sourceIds, targetId }: { sourceIds: number[]; targetId: number }) =>
      tagApi.merge(sourceIds, targetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      setMergeOpen(false);
      selection.clear();
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    createMut.mutate(name);
  };

  const handleRename = () => {
    if (renameId == null) return;
    const name = renameValue.trim();
    if (!name) return;
    renameMut.mutate({ id: renameId, name });
  };

  const handleDelete = async (id: number) => {
    if (await confirmDanger('确认删除该标签？关联资源不会被删除。')) deleteMut.mutate(id);
  };

  const batchDelete = () =>
    runBatchAction(
      selection,
      (n) => `确认删除选中的 ${n} 个标签？关联资源不会被删除。`,
      (id) => tagApi.delete(id),
      () => queryClient.invalidateQueries({ queryKey: ['tags'] }),
    );

  // 合并选中的标签：除目标标签外，其余选中标签作为源被删除
  const handleMerge = () => {
    if (mergeTarget == null) return;
    const sourceIds = Array.from(selection.selected).filter((id) => id !== mergeTarget);
    if (sourceIds.length === 0) return;
    mergeMut.mutate({ sourceIds, targetId: mergeTarget });
  };

  const openMergeDialog = () => {
    const selected = Array.from(selection.selected);
    if (selected.length < 2) return;
    setMergeTarget(selected[0]);
    setMergeOpen(true);
  };

  const openRename = (tag: Tag) => {
    setRenameId(tag.id);
    setRenameValue(tag.name);
    setRenameOpen(true);
  };

  return (
    <div className={s.pageContainer}>
      <div className={s.pageHeader}>
        <h2 style={{ margin: 0 }}>标签管理</h2>
      </div>

      {canTag && (
        <form onSubmit={handleCreate} className={s.field} style={{ maxWidth: '400px' }}>
          <Label htmlFor="new-tag">新建标签</Label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Input
              id="new-tag"
              value={newName}
              onChange={(_, d) => setNewName(d.value)}
              placeholder="标签名"
              style={{ flex: 1 }}
            />
            <Button
              type="submit"
              appearance="primary"
              icon={<AddRegular />}
              disabled={!newName.trim() || createMut.isPending}
            >
              新建
            </Button>
          </div>
        </form>
      )}

      {isLoading ? (
        <Spinner label="加载中..." />
      ) : !tags || tags.length === 0 ? (
        <Card>
          <CardHeader header={<span>暂无标签</span>} />
        </Card>
      ) : (
        <>
          <div className={s.gridList}>
            {tags.map((tag) => (
              <CardContextMenu
                key={tag.id}
                items={
                  canTag
                    ? [
                        {
                          icon: <RenameRegular />,
                          label: '重命名',
                          onClick: () => openRename(tag),
                        },
                        {
                          icon: <DeleteRegular />,
                          label: '删除',
                          danger: true,
                          onClick: () => handleDelete(tag.id),
                        },
                      ]
                    : []
                }
              >
                <div className={`batch-card ${s.gridCard}`} onClick={() => navigate(`/?tag=${tag.id}`)}>
                  {canTag && (
                    <CardCheckbox
                      checked={selection.selected.has(tag.id)}
                      onChange={(c) => selection.toggle(tag.id, c)}
                    />
                  )}
                  <div className={s.gridCardInfo}>
                    <span style={{ fontSize: '15px', fontWeight: 600, color: tokens.colorBrandForeground1 }}>
                      {tag.name}
                    </span>
                    <Badge appearance="filled" color="informative">
                      {tag.count ?? 0} 资源
                    </Badge>
                  </div>
                </div>
              </CardContextMenu>
            ))}
          </div>
          <Pagination page={page} totalPages={totalPages} total={total} onChange={setPage} />
        </>
      )}

      {/* 浮动批量操作栏（选中标签后显示） */}
      {canTag && (
        <BatchBar
          selectedCount={selection.size}
          allChecked={!!tags && tags.length > 0 && tags.every((t) => selection.selected.has(t.id))}
          total={tags?.length ?? 0}
          onSelectAll={(c) =>
            selection.selectAll(
              (tags ?? []).map((t) => t.id),
              c,
            )
          }
          onInvert={() => selection.invert((tags ?? []).map((t) => t.id))}
          onClear={selection.clear}
        >
          <Button
            appearance="outline"
            size="small"
            icon={<MergeRegular />}
            onClick={openMergeDialog}
            disabled={selection.size < 2 || mergeMut.isPending}
          >
            合并标签
          </Button>
          <Button appearance="primary" size="small" icon={<DeleteRegular />} onClick={batchDelete}>
            批量删除
          </Button>
        </BatchBar>
      )}

      {/* 重命名对话框 */}
      <Dialog open={renameOpen} onOpenChange={(_, e: DialogOpenChangeData) => setRenameOpen(e.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>重命名标签</DialogTitle>
            <DialogContent>
              <div className={s.field}>
                <Label htmlFor="rename-input">新名称</Label>
                <Input id="rename-input" value={renameValue} onChange={(_, d) => setRenameValue(d.value)} />
              </div>
            </DialogContent>
            <DialogActions>
              <DialogTrigger>
                <Button appearance="secondary">取消</Button>
              </DialogTrigger>
              <Button appearance="primary" onClick={handleRename} disabled={renameMut.isPending || !renameValue.trim()}>
                保存
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* 合并对话框 */}
      <Dialog open={mergeOpen} onOpenChange={(_, e: DialogOpenChangeData) => setMergeOpen(e.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>合并选中标签</DialogTitle>
            <DialogContent>
              <p style={{ marginTop: 0, color: tokens.colorNeutralForeground2 }}>
                选择目标标签，其他选中标签的资源将合并到该标签下，源标签将被删除。
              </p>
              <div
                style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '400px', overflowY: 'auto' }}
              >
                {tags
                  ?.filter((t) => selection.selected.has(t.id))
                  .map((tag) => (
                    <label
                      key={tag.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        padding: '6px 8px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="radio"
                        name="merge-target"
                        style={{ accentColor: tokens.colorBrandForeground1 }}
                        checked={mergeTarget === tag.id}
                        onChange={() => setMergeTarget(tag.id)}
                      />
                      <span>{tag.name}</span>
                      <Badge>{tag.count ?? 0}</Badge>
                    </label>
                  ))}
              </div>
            </DialogContent>
            <DialogActions>
              <DialogTrigger>
                <Button appearance="secondary">取消</Button>
              </DialogTrigger>
              <Button appearance="primary" onClick={handleMerge} disabled={mergeMut.isPending || mergeTarget == null}>
                合并
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
