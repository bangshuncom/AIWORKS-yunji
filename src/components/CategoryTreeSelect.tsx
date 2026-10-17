// 分类树形选择器：用 Popover + Fluent UI Tree 展示真实层级树
import { useState } from 'react';
import { Popover, PopoverSurface, PopoverTrigger, Button, makeStyles, tokens } from '@fluentui/react-components';
import { Tree, TreeItem, TreeItemLayout } from '@fluentui/react-tree';
import { FolderRegular, DocumentRegular } from '@fluentui/react-icons';
import type { Category } from '../types/models';

export interface CategoryTreeSelectProps {
  categories?: Category[];
  value: number | null | undefined;
  onChange: (id: number | null) => void;
  placeholder?: string;
  /** 是否提供"清除分类"选项 */
  allowEmpty?: boolean;
  emptyLabel?: string;
  /** 选项后显示资源数量 */
  showCount?: boolean;
  /** 排除指定分类及其整棵子树（编辑分类时选择父级用，防止循环引用） */
  excludeSubtreeOf?: number | null;
  style?: React.CSSProperties;
  disabled?: boolean;
  /** 按钮尺寸，默认 medium */
  size?: 'small' | 'medium' | 'large';
}

const useStyles = makeStyles({
  surface: {
    maxHeight: '60vh',
    minWidth: '240px',
    overflow: 'auto',
    padding: '8px',
  },
  tree: {
    background: 'transparent',
  },
  // 占位替代展开箭头：分类数量有限，树始终全展开，层级靠缩进表达即可。
  // 折叠箭头在这里是多余的——点击行既要选中又会切换展开态，容易误收起子分类。
  flatIcon: {
    width: '12px',
    flexShrink: 0,
  },
  selectedItem: {
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    borderRadius: '4px',
  },
  clearBtn: {
    width: '100%',
    justifyContent: 'flex-start',
    marginBottom: '4px',
  },
  emptyText: {
    padding: '8px 12px',
    color: tokens.colorNeutralForeground3,
    fontSize: '13px',
  },
});

/** 判断 cid 是否在 excludeId 的子树中（含自身） */
function isInSubtree(root: Category, targetId: number): boolean {
  if (root.id === targetId) return true;
  return !!(root.children && root.children.some((c) => isInSubtree(c, targetId)));
}

function filterTree(nodes: Category[], excludeId: number | null): Category[] {
  if (excludeId == null) return nodes;
  return nodes
    .filter((n) => !isInSubtree(n, excludeId))
    .map((n) => ({ ...n, children: n.children ? filterTree(n.children, excludeId) : undefined }));
}

function findName(nodes: Category[], id: number): string | undefined {
  for (const n of nodes) {
    if (n.id === id) return n.name;
    if (n.children) {
      const found = findName(n.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

export function CategoryTreeSelect({
  categories,
  value,
  onChange,
  placeholder = '选择分类',
  allowEmpty = true,
  emptyLabel = '（无分类）',
  showCount = false,
  excludeSubtreeOf = null,
  style,
  disabled,
  size = 'medium',
}: CategoryTreeSelectProps) {
  const s = useStyles();
  const [open, setOpen] = useState(false);
  const tree = filterTree(categories ?? [], excludeSubtreeOf);
  const label = value != null ? findName(tree, value) : undefined;

  const handleSelect = (id: number | null) => {
    onChange(id);
    setOpen(false);
  };

  const renderNode = (node: Category) => {
    const hasChildren = !!(node.children && node.children.length > 0);
    const isSelected = value === node.id;
    return (
      <TreeItem
        key={node.id}
        itemType={hasChildren ? 'branch' : 'leaf'}
        // 受控全展开：不给折叠的机会，点击行只做选中
        open={hasChildren ? true : undefined}
        onClick={(e) => {
          e.stopPropagation();
          handleSelect(node.id);
        }}
      >
        <TreeItemLayout
          className={isSelected ? s.selectedItem : undefined}
          expandIcon={<span className={s.flatIcon} />}
          iconBefore={hasChildren ? <FolderRegular fontSize={16} /> : <DocumentRegular fontSize={16} />}
        >
          {node.name}
          {showCount && node.resource_count != null && node.resource_count > 0 && (
            <span style={{ marginLeft: '6px', fontSize: '12px', opacity: 0.6 }}>({node.resource_count})</span>
          )}
        </TreeItemLayout>
        {hasChildren && node.children!.map(renderNode)}
      </TreeItem>
    );
  };

  return (
    <Popover open={open} onOpenChange={(_, d) => setOpen(d.open)}>
      <PopoverTrigger disableButtonEnhancement>
        <Button
          appearance="outline"
          size={size}
          style={{ minWidth: '140px', ...style }}
          disabled={disabled}
          icon={<FolderRegular fontSize={16} />}
        >
          {label ?? placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverSurface className={s.surface}>
        {allowEmpty && (
          <Button className={s.clearBtn} appearance="subtle" size="small" onClick={() => handleSelect(null)}>
            {emptyLabel}
          </Button>
        )}
        {tree.length === 0 ? (
          <div className={s.emptyText}>暂无分类</div>
        ) : (
          <Tree className={s.tree} aria-label="分类选择">
            {tree.map(renderNode)}
          </Tree>
        )}
      </PopoverSurface>
    </Popover>
  );
}
