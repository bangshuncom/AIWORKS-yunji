// 点选式多选：搜索框实时过滤 + 候选项 pill 点选切换。
//
// 标签与合集共用——两者只是字段名不同（name/count 与 title/resource_count）,
// 由调用方归一化成 PillOption 再传进来，避免同一套筛选逻辑写两遍。
import { useMemo, useState } from 'react';
import { Button, Input, tokens } from '@fluentui/react-components';
import { useStyles } from './shared';
import { useLanguage } from '../../i18n';

export interface PillOption {
  id: number;
  label: string;
  count?: number;
}

export function PillPicker({
  options,
  selectedIds,
  onChange,
  searchPlaceholder,
  emptyHint,
  noMatchHint,
  topCount = 20,
}: {
  options: PillOption[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
  searchPlaceholder: string;
  /** 一个可选项都没有时的提示 */
  emptyHint?: string;
  /** 有可选项但被搜索词过滤光时的提示 */
  noMatchHint?: string;
  /** 没有搜索词时最多展示多少个（按 count 倒序） */
  topCount?: number;
}) {
  const styles = useStyles();
  const { t } = useLanguage();
  const [search, setSearch] = useState('');

  // 已选的永远置顶：否则被搜索词过滤掉之后就再也点不掉了
  const visible = useMemo(() => {
    const picked = selectedIds.map((id) => options.find((o) => o.id === id)).filter((o): o is PillOption => o != null);
    const q = search.trim().toLowerCase();
    const rest = options
      .filter((o) => !selectedIds.includes(o.id))
      .filter((o) => !q || o.label.toLowerCase().includes(q))
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
    // 有搜索词时不限条数，否则只看前 topCount 个最常用的
    return [...picked, ...(q ? rest : rest.slice(0, topCount))];
  }, [options, selectedIds, search, topCount]);

  const toggle = (id: number) =>
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);

  return (
    <>
      <Input value={search} onChange={(_, d) => setSearch(d.value)} placeholder={searchPlaceholder} />
      <div className={styles.tagOptions}>
        {visible.length === 0 ? (
          <span style={{ fontSize: '12px', color: tokens.colorNeutralForeground3 }}>
            {options.length === 0 ? (emptyHint ?? t('pill.empty')) : (noMatchHint ?? t('pill.noMatch'))}
          </span>
        ) : (
          visible.map((o) => {
            const on = selectedIds.includes(o.id);
            return (
              <Button
                key={o.id}
                size="small"
                appearance={on ? 'primary' : 'outline'}
                onClick={() => toggle(o.id)}
                title={on ? t('pill.selectedTip', { n: o.count ?? 0 }) : t('pill.selectTip', { n: o.count ?? 0 })}
              >
                {o.label}
                {o.count ? ` (${o.count})` : ''}
              </Button>
            );
          })
        )}
      </div>
    </>
  );
}
