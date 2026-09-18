// 分类管理页：树形多级子分类，拖拽排序 / 拖动变成子分类，浮动批量操作栏
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Input,
  Button,
  Label,
  Textarea,
  Badge,
  Spinner,
  Checkbox,
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  DialogOpenChangeData,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  AddRegular,
  RenameRegular,
  DeleteRegular,
  ReOrderDotsVerticalRegular,
  ChevronRightRegular,
  FolderRegular,
  FolderOpenRegular,
} from '@fluentui/react-icons';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import { categoryApi } from '../lib/tauri';
import { usePerms } from '../hooks/usePerms';
import type { Category, CreateCategory } from '../types/models';
import { useSelection, BatchBar, runBatchAction } from '../components/batch';
import { CategoryTreeSelect } from '../components/CategoryTreeSelect';
import { useSharedStyles } from '../styles/shared';

// 前端可编辑的树节点
interface DragNode {
  id: number;
  name: string;
  slug: string;
  description: string;
  parent_id: number | null;
  sort_order: number;
  resource_count?: number;
  children: DragNode[];
}

interface FlatRow {
  node: DragNode;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
}

type DropPosition = 'before' | 'after' | 'child';
interface DropIndicator {
  targetId: number;
  position: DropPosition;
}

// --- 纯函数：树操作 ---

function cloneTree(tree: Category[]): DragNode[] {
  return tree.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    description: c.description,
    parent_id: c.parent_id,
    sort_order: c.sort_order,
    resource_count: c.resource_count,
    children: cloneTree(c.children ?? []),
  }));
}

function findNode(nodes: DragNode[], id: number): DragNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = findNode(n.children, id);
    if (hit) return hit;
  }
  return null;
}

/** ancestorId 的子树中是否包含 id（不含 ancestor 自身） */
function isInSubtree(nodes: DragNode[], ancestorId: number, id: number): boolean {
  const a = findNode(nodes, ancestorId);
  if (!a) return false;
  const walk = (ns: DragNode[]): boolean =>
    ns.some((n) => n.id === id || walk(n.children));
  return walk(a.children);
}

/** 从树中移除节点，返回 [新树, 被移除节点] */
function removeNode(nodes: DragNode[], id: number): [DragNode[], DragNode | null] {
  const idx = nodes.findIndex((n) => n.id === id);
  if (idx >= 0) {
    const next = [...nodes];
    const [removed] = next.splice(idx, 1);
    return [next, removed];
  }
  for (let i = 0; i < nodes.length; i++) {
    const [children, removed] = removeNode(nodes[i].children, id);
    if (removed) {
      const next = [...nodes];
      next[i] = { ...next[i], children };
      return [next, removed];
    }
  }
  return [nodes, null];
}

/** 在目标节点前/后插入（同父级） */
function insertSibling(
  nodes: DragNode[],
  targetId: number,
  position: 'before' | 'after',
  node: DragNode,
): DragNode[] {
  const idx = nodes.findIndex((n) => n.id === targetId);
  if (idx >= 0) {
    const next = [...nodes];
    next.splice(position === 'before' ? idx : idx + 1, 0, node);
    return next;
  }
  return nodes.map((n) => ({ ...n, children: insertSibling(n.children, targetId, position, node) }));
}

/** 作为目标节点的第一个子节点插入 */
function insertAsFirstChild(nodes: DragNode[], targetId: number, node: DragNode): DragNode[] {
  const idx = nodes.findIndex((n) => n.id === targetId);
  if (idx >= 0) {
    const next = [...nodes];
    next[idx] = { ...next[idx], children: [node, ...next[idx].children] };
    return next;
  }
  return nodes.map((n) => ({ ...n, children: insertAsFirstChild(n.children, targetId, node) }));
}

/** DFS 收集全量提交项（sort_order 为同父级内的序号） */
function collectOrder(
  nodes: DragNode[],
  acc: { id: number; parent_id: number | null; sort_order: number }[],
  parentId: number | null,
) {
  nodes.forEach((n, i) => {
    acc.push({ id: n.id, parent_id: parentId, sort_order: i });
    collectOrder(n.children, acc, n.id);
  });
}

function flattenVisible(nodes: DragNode[], collapsed: Set<number>): FlatRow[] {
  const rows: FlatRow[] = [];
  const walk = (ns: DragNode[], depth: number) => {
    for (const n of ns) {
      const hasChildren = n.children.length > 0;
      const isCollapsed = collapsed.has(n.id);
      rows.push({ node: n, depth, hasChildren, collapsed: isCollapsed });
      if (hasChildren && !isCollapsed) walk(n.children, depth + 1);
    }
  };
  walk(nodes, 0);
  return rows;
}

// --- 可拖拽 + 可放置的树行 ---

const useRowStyles = makeStyles({
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 10px',
    borderRadius: '6px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    cursor: 'pointer',
    userSelect: 'none',
  },
  dragHandle: {
    cursor: 'grab',
    display: 'flex',
    alignItems: 'center',
    color: tokens.colorNeutralForeground3,
    padding: '2px',
    '&:active': { cursor: 'grabbing' },
  },
  name: {
    fontSize: '14px',
    fontWeight: 600,
  },
  spacer: {
    display: 'inline-block',
  },
  actions: {
    display: 'flex',
    gap: '2px',
    marginLeft: 'auto',
  },
});

function DragRow({
  row,
  checked,
  disabled,
  indicator,
  onToggleCheck,
  onToggleCollapse,
  onAddChild,
  onEdit,
  onDelete,
}: {
  row: FlatRow;
  checked: boolean;
  disabled: boolean;
  indicator: DropPosition | null;
  onToggleCheck: (id: number, checked: boolean) => void;
  onToggleCollapse: (id: number) => void;
  onAddChild: (id: number) => void;
  onEdit: (cat: Category) => void;
  onDelete: (id: number, name: string) => void;
}) {
  const styles = useRowStyles();
  const { node, depth, hasChildren, collapsed } = row;

  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: node.id,
    disabled,
  });
  const { setNodeRef: setDropRef } = useDroppable({ id: node.id, disabled });

  const indicatorClass =
    indicator === 'before'
      ? 'cat-drop-before'
      : indicator === 'after'
        ? 'cat-drop-after'
        : indicator === 'child'
          ? 'cat-drop-child'
          : '';

  return (
    <div
      ref={(el) => {
        setDragRef(el);
        setDropRef(el);
      }}
      className={`batch-card ${styles.row} ${indicatorClass}`}
      style={{
        marginLeft: `${depth * 22}px`,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      {/* 拖拽手柄：拖到同级位置=排序，拖到某行中部=变成其子分类 */}
      <span
        className={styles.dragHandle}
        title="拖拽排序 / 拖到某分类上变成其子分类"
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
      >
        <ReOrderDotsVerticalRegular />
      </span>

      {/* 勾选框：hover 行时显示，选中后常驻 */}
      <span
        className="batch-checkbox"
        data-batch-checkbox
        style={{
          display: 'flex',
          alignItems: 'center',
          opacity: checked ? 1 : undefined,
          backgroundColor: tokens.colorNeutralBackground1,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <Checkbox
          checked={checked}
          onChange={(_, d) => onToggleCheck(node.id, d.checked === true)}
        />
      </span>

      {hasChildren ? (
        <ChevronRightRegular
          style={{
            cursor: 'pointer',
            transition: 'transform 0.15s',
            transform: collapsed ? 'none' : 'rotate(90deg)',
          }}
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse(node.id);
          }}
        />
      ) : (
        <span className={styles.spacer} style={{ width: '16px' }} />
      )}
      {collapsed ? <FolderRegular /> : <FolderOpenRegular />}
      <span className={styles.name}>{node.name}</span>
      <Badge appearance="outline" size="extra-small">
        {node.resource_count ?? 0}
      </Badge>

      <div className={styles.actions} onClick={(e) => e.stopPropagation()}>
        <Button
          size="small"
          appearance="subtle"
          icon={<AddRegular />}
          onClick={() => onAddChild(node.id)}
          title="添加子分类"
          disabled={disabled}
        />
        <Button
          size="small"
          appearance="subtle"
          icon={<RenameRegular />}
          onClick={() =>
            onEdit({
              id: node.id,
              parent_id: null,
              name: node.name,
              slug: node.slug,
              description: node.description,
              sort_order: node.sort_order,
              created_at: '',
              updated_at: '',
              deleted_at: null,
            })
          }
          title="编辑"
          disabled={disabled}
        />
        <Button
          size="small"
          appearance="subtle"
          icon={<DeleteRegular />}
          onClick={() => onDelete(node.id, node.name)}
          title="删除"
          disabled={disabled}
        />
      </div>
    </div>
  );
}

export function CategoriesPage() {
  const s = useSharedStyles();
  const queryClient = useQueryClient();
  const canArticle = usePerms().can('article');
  const selection = useSelection();
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [indicator, setIndicator] = useState<DropIndicator | null>(null);
  const [saving, setSaving] = useState(false);

  // 本地编辑中的树（拖拽时乐观更新）
  const [nodes, setNodes] = useState<DragNode[]>([]);

  // 编辑对话框
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editSlug, setEditSlug] = useState('');
  const [editParentId, setEditParentId] = useState<number | null>(null);

  // 新建对话框
  const [createOpen, setCreateOpen] = useState(false);
  const [createParentId, setCreateParentId] = useState<number | null>(null);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createSlug, setCreateSlug] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const { data: tree, isLoading } = useQuery<Category[]>({
    queryKey: ['categories-tree'],
    queryFn: categoryApi.listTree,
  });

  // 服务器数据同步到本地树
  useEffect(() => {
    if (tree) setNodes(cloneTree(tree));
  }, [tree]);

  const createMut = useMutation({
    mutationFn: (payload: CreateCategory) => categoryApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories-tree'] });
      queryClient.invalidateQueries({ queryKey: ['categories-flat'] });
      setCreateOpen(false);
      setCreateName('');
      setCreateDescription('');
      setCreateSlug('');
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: CreateCategory }) =>
      categoryApi.update(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories-tree'] });
      queryClient.invalidateQueries({ queryKey: ['categories-flat'] });
      setEditOpen(false);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => categoryApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories-tree'] });
      queryClient.invalidateQueries({ queryKey: ['categories-flat'] });
    },
  });

  const toggleCollapse = (id: number) => {
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openCreate = (parentId: number | null = null) => {
    setCreateParentId(parentId);
    setCreateName('');
    setCreateDescription('');
    setCreateSlug('');
    setCreateOpen(true);
  };

  const openEdit = (cat: Category) => {
    setEditId(cat.id);
    setEditName(cat.name);
    setEditDescription(cat.description);
    setEditSlug(cat.slug);
    setEditParentId(cat.parent_id);
    setEditOpen(true);
  };

  const handleCreate = () => {
    const name = createName.trim();
    if (!name) return;
    createMut.mutate({
      parent_id: createParentId,
      name,
      slug: createSlug.trim() || undefined,
      description: createDescription.trim() || undefined,
    });
  };

  const handleUpdate = () => {
    if (editId == null) return;
    const name = editName.trim();
    if (!name) return;
    updateMut.mutate({
      id: editId,
      payload: {
        parent_id: editParentId,
        name,
        slug: editSlug.trim() || undefined,
        description: editDescription.trim() || undefined,
      },
    });
  };

  const handleDelete = (id: number, name: string) => {
    if (confirm(`确认删除分类「${name}」及其所有子分类？关联资源不会被删除。`)) {
      deleteMut.mutate(id);
    }
  };

  const batchDelete = () =>
    runBatchAction(
      selection,
      (n) => `确认删除选中的 ${n} 个分类（含各自子分类）？关联资源不会被删除。`,
      (id) => categoryApi.delete(id),
      () => {
        queryClient.invalidateQueries({ queryKey: ['categories-tree'] });
        queryClient.invalidateQueries({ queryKey: ['categories-flat'] });
      },
    );

  // --- 拖拽 ---

  const onDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) {
      setIndicator(null);
      return;
    }
    const activeId = active.id as number;
    const targetId = over.id as number;
    // 不能拖入自己的子树
    if (isInSubtree(nodes, activeId, targetId)) {
      setIndicator(null);
      return;
    }
    const activeRect = active.rect.current.translated;
    if (!activeRect) return;
    const overRect = over.rect;
    const centerY = activeRect.top + activeRect.height / 2 - overRect.top;
    const h = overRect.height;
    const position: DropPosition =
      centerY < h * 0.25 ? 'before' : centerY > h * 0.75 ? 'after' : 'child';
    setIndicator({ targetId, position });

    // 拖到中部（变成子分类）时自动展开目标节点
    if (position === 'child' && collapsed.has(targetId)) {
      setCollapsed((prev) => {
        const s = new Set(prev);
        s.delete(targetId);
        return s;
      });
    }
  };

  const onDragEnd = async (e: DragEndEvent) => {
    const ind = indicator;
    setIndicator(null);
    if (!ind) return;
    const activeId = e.active.id as number;
    if (ind.targetId === activeId || isInSubtree(nodes, activeId, ind.targetId)) return;

    const [without, moved] = removeNode(nodes, activeId);
    if (!moved) return;

    let next: DragNode[];
    if (ind.position === 'child') {
      next = insertAsFirstChild(without, ind.targetId, moved);
      // 自动展开接收子分类的节点
      setCollapsed((prev) => {
        const s = new Set(prev);
        s.delete(ind.targetId);
        return s;
      });
    } else {
      next = insertSibling(without, ind.targetId, ind.position, moved);
    }

    setNodes(next);
    const items: { id: number; parent_id: number | null; sort_order: number }[] = [];
    collectOrder(next, items, null);

    setSaving(true);
    try {
      await categoryApi.saveOrder(items);
      queryClient.invalidateQueries({ queryKey: ['categories-tree'] });
      queryClient.invalidateQueries({ queryKey: ['categories-flat'] });
    } catch (err: any) {
      alert(err?.message || '排序保存失败');
      // 失败时恢复服务器数据
      queryClient.invalidateQueries({ queryKey: ['categories-tree'] });
    } finally {
      setSaving(false);
    }
  };

  const rows = flattenVisible(nodes, collapsed);
  const rowIds = rows.map((r) => r.node.id);
  const allChecked = rows.length > 0 && rows.every((r) => selection.selected.has(r.node.id));
  const dragDisabled = !canArticle || saving;

  return (
    <div className={s.pageContainer}>
      <div className={s.pageHeader}>
        <h2 style={{ margin: 0 }}>
          分类管理
          <span
            style={{
              marginLeft: '12px',
              fontWeight: 400,
              fontSize: '12px',
              color: tokens.colorNeutralForeground3,
            }}
          >
            拖动手柄可排序，拖到分类中部可变成其子分类
          </span>
        </h2>
      </div>
      <div>
        <Button
          icon={<AddRegular />}
          appearance="primary"
          onClick={() => openCreate(null)}
          disabled={!canArticle}
        >
          新建分类
        </Button>
      </div>

      {isLoading ? (
        <Spinner label="加载中..." />
      ) : nodes.length === 0 ? (
        <div style={{ padding: '48px', textAlign: 'center', color: tokens.colorNeutralForeground3 }}>
          暂无分类，点击右上角新建
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={() => setIndicator(null)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {rows.map((row) => (
              <DragRow
                key={row.node.id}
                row={row}
                checked={selection.selected.has(row.node.id)}
                disabled={dragDisabled}
                indicator={indicator?.targetId === row.node.id ? indicator.position : null}
                onToggleCheck={(id, c) => selection.toggle(id, c)}
                onToggleCollapse={toggleCollapse}
                onAddChild={(pid) => openCreate(pid)}
                onEdit={openEdit}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </DndContext>
      )}

      {/* 浮动批量操作栏（选中至少一个分类后显示） */}
      <BatchBar
        selectedCount={selection.size}
        allChecked={allChecked}
        total={rows.length}
        onSelectAll={(c) => selection.selectAll(rowIds, c)}
        onInvert={() => selection.invert(rowIds)}
        onClear={selection.clear}
        busy={deleteMut.isPending || saving}
      >
        <Button
          appearance="primary"
          size="small"
          icon={<DeleteRegular />}
          onClick={batchDelete}
          disabled={!canArticle || deleteMut.isPending}
        >
          批量删除
        </Button>
      </BatchBar>

      {/* 新建对话框（与编辑对话框结构统一） */}
      <Dialog open={createOpen} onOpenChange={(_, e: DialogOpenChangeData) => setCreateOpen(e.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>新建分类</DialogTitle>
            <DialogContent>
              <div className={s.field}>
                <Label htmlFor="create-name">名称 *</Label>
                <Input
                  id="create-name"
                  value={createName}
                  onChange={(_, d) => setCreateName(d.value)}
                  placeholder="分类名称"
                />
              </div>
              <div className={s.field}>
                <Label htmlFor="create-slug">URL 标识（可选）</Label>
                <Input
                  id="create-slug"
                  value={createSlug}
                  onChange={(_, d) => setCreateSlug(d.value)}
                  placeholder="如：software"
                />
              </div>
              <div className={s.field}>
                <Label htmlFor="create-desc">描述（可选）</Label>
                <Textarea
                  id="create-desc"
                  value={createDescription}
                  onChange={(_, d) => setCreateDescription(d.value)}
                  placeholder="分类描述"
                />
              </div>
              <div className={s.field}>
                <Label>父分类（不选则为顶级分类，拖动排序也可快速调整层级）</Label>
                <CategoryTreeSelect
                  categories={tree}
                  value={createParentId}
                  onChange={setCreateParentId}
                  emptyLabel="（顶级分类）"
                  style={{ minWidth: '240px' }}
                />
              </div>
            </DialogContent>
            <DialogActions>
              <DialogTrigger>
                <Button appearance="secondary">取消</Button>
              </DialogTrigger>
              <Button
                appearance="primary"
                onClick={handleCreate}
                disabled={!createName.trim() || createMut.isPending}
              >
                创建
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* 编辑对话框 */}
      <Dialog open={editOpen} onOpenChange={(_, e: DialogOpenChangeData) => setEditOpen(e.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>编辑分类</DialogTitle>
            <DialogContent>
              <div className={s.field}>
                <Label htmlFor="edit-name">名称 *</Label>
                <Input
                  id="edit-name"
                  value={editName}
                  onChange={(_, d) => setEditName(d.value)}
                />
              </div>
              <div className={s.field}>
                <Label htmlFor="edit-slug">URL 标识</Label>
                <Input
                  id="edit-slug"
                  value={editSlug}
                  onChange={(_, d) => setEditSlug(d.value)}
                />
              </div>
              <div className={s.field}>
                <Label htmlFor="edit-desc">描述</Label>
                <Textarea
                  id="edit-desc"
                  value={editDescription}
                  onChange={(_, d) => setEditDescription(d.value)}
                />
              </div>
              <div className={s.field}>
                <Label>父分类（拖动排序也可快速调整层级）</Label>
                <CategoryTreeSelect
                  categories={tree}
                  value={editParentId}
                  onChange={setEditParentId}
                  emptyLabel="（顶级分类）"
                  excludeSubtreeOf={editId}
                  style={{ minWidth: '240px' }}
                />
              </div>
            </DialogContent>
            <DialogActions>
              <DialogTrigger>
                <Button appearance="secondary">取消</Button>
              </DialogTrigger>
              <Button
                appearance="primary"
                onClick={handleUpdate}
                disabled={!editName.trim() || updateMut.isPending}
              >
                保存
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
