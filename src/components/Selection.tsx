// 统一批量选择：useSelection hook + CardCheckbox（卡片勾选）+ BatchBar（浮动操作栏）
import { useCallback, useMemo, useState } from 'react';
import { confirmDanger } from '../lib/dialog';
import { useLanguage } from '../i18n';
import type { ReactNode } from 'react';
import { Button, Badge, Checkbox, makeStyles, tokens } from '@fluentui/react-components';
import { DismissRegular } from '@fluentui/react-icons';

/** 多选状态管理（选中至少一个项目后，页面底部显示批量操作栏） */
export function useSelection() {
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const toggle = useCallback((id: number, checked?: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const shouldAdd = checked === undefined ? !next.has(id) : checked;
      if (shouldAdd) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const selectOnly = useCallback((ids: number[]) => {
    setSelected(new Set(ids));
  }, []);

  const selectAll = useCallback((ids: number[], checked: boolean) => {
    setSelected(checked ? new Set(ids) : new Set());
  }, []);

  const invert = useCallback((ids: number[]) => {
    setSelected((prev) => {
      const next = new Set<number>();
      for (const id of ids) if (!prev.has(id)) next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  return useMemo(
    () => ({ selected, toggle, selectOnly, selectAll, invert, clear, size: selected.size }),
    [selected, toggle, selectOnly, selectAll, invert, clear],
  );
}

export type SelectionController = ReturnType<typeof useSelection>;

/**
 * 通用批量操作：确认后对所有选中项并发执行 action，完成后清空选择。
 * concurrency 控制最大并发数（默认 8）。
 */
export async function runBatchAction(
  selection: SelectionController,
  confirmFn: (count: number) => string,
  action: (id: number) => Promise<void>,
  onDone?: () => void,
  concurrency = 8,
) {
  const ids = Array.from(selection.selected);
  if (ids.length === 0) return;
  if (!(await confirmDanger(confirmFn(ids.length)))) return;
  await runConcurrent(ids, action, concurrency);
  onDone?.();
  selection.clear();
}

/** 并发执行批量任务，限制最大并发数 */
export async function runConcurrent<T>(items: T[], fn: (item: T) => Promise<void>, concurrency = 8): Promise<void> {
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const item = items[idx++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

const useCheckboxStyles = makeStyles({
  wrap: {
    position: 'absolute',
    top: '6px',
    right: '6px',
    zIndex: 3,
    padding: '2px',
    borderRadius: '4px',
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow4,
    lineHeight: 0,
    // 未选中时默认隐藏，hover 卡片或自身时显示（.batch-card 由页面卡片挂载）
    opacity: 0,
    transition: 'opacity .15s ease',
    '&:hover': { opacity: 1 },
  },
  on: { opacity: 1 },
});

/** 卡片右上角的勾选框：未选中时 hover 卡片才显示，选中后常驻 */
export function CardCheckbox({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  const styles = useCheckboxStyles();
  return (
    <div
      className={`batch-checkbox ${styles.wrap} ${checked ? styles.on : ''}`}
      data-batch-checkbox
      onClick={(e) => e.stopPropagation()}
    >
      <Checkbox checked={checked} onChange={(_, d) => onChange(d.checked === true)} />
    </div>
  );
}

const useBarStyles = makeStyles({
  bar: {
    position: 'fixed',
    left: '50%',
    bottom: '24px',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    paddingRight: '44px',
    borderRadius: '10px',
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorBrandStroke1}`,
    boxShadow: tokens.shadow16,
    zIndex: 2000,
    maxWidth: 'calc(90vw + 200px)',
    flexWrap: 'wrap',
  },
  cancelBtn: {
    position: 'absolute',
    top: '6px',
    right: '6px',
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
});

export interface BatchBarProps {
  /** 当前选中数量（>0 时才显示） */
  selectedCount: number;
  /** 当前页是否全选 */
  allChecked: boolean;
  /** 当前页项目总数 */
  total: number;
  onSelectAll: (checked: boolean) => void;
  onInvert: () => void;
  onClear: () => void;
  /** 批量操作按钮（仅选中时展示） */
  children: ReactNode;
  busy?: boolean;
}

/** 浮动批量操作栏：选中至少一个项目后从底部滑出，所有列表页统一风格 */
export function BatchBar({
  selectedCount,
  allChecked,
  total,
  onSelectAll,
  onInvert,
  onClear,
  children,
  busy,
}: BatchBarProps) {
  const styles = useBarStyles();
  const { t } = useLanguage();
  if (selectedCount === 0) return null;
  return (
    <div className={styles.bar}>
      <Checkbox
        checked={allChecked}
        onChange={(_, d) => onSelectAll(d.checked === true)}
        label={t('batchBar.selectAll', { n: total })}
        disabled={busy}
      />
      <Button appearance="outline" size="small" onClick={onInvert} disabled={busy}>
        {t('batchBar.invert')}
      </Button>
      <Badge appearance="filled" color="brand">
        {t('batchBar.selected', { n: selectedCount })}
      </Badge>
      <span className={styles.actions}>{children}</span>
      <Button
        className={styles.cancelBtn}
        appearance="subtle"
        size="small"
        icon={<DismissRegular />}
        onClick={onClear}
        disabled={busy}
        title={t('batchBar.clear')}
      />
    </div>
  );
}
