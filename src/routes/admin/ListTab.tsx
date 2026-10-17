// 文章列表设置：每页条数、瀑布流是否无限滚动。存数据库，对所有用户生效
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, Input, Label, Spinner, Switch, tokens } from '@fluentui/react-components';
import { AppsListRegular } from '@fluentui/react-icons';
import { settingsApi } from '../../lib/tauri';
import { clampPageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MIN_PAGE_SIZE } from '../../lib/listSettings';
import { useStyles } from './styles';
import { useComposingInput } from '../../hooks/useComposingInput';

/** 每页条数只放行数字；组词期间不改写内容，见 useComposingInput */
const onlyDigits = (s: string) => s.replace(/[^0-9]/g, '');

export function ListTab() {
  const styles = useStyles();
  const queryClient = useQueryClient();
  const composing = useComposingInput();

  // null = 未编辑，显示已保存值；非 null = 用户正在输入，提交成功后再回落
  const [draft, setDraft] = useState<string | null>(null);

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });

  const updateMut = useMutation({
    mutationFn: (patch: Record<string, string>) => settingsApi.update(patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['public-settings'] });
    },
  });

  if (isLoading) return <Spinner label="加载中..." />;

  const savedPageSize = clampPageSize(settings?.list_page_size);
  const pageSizeInput = draft ?? String(savedPageSize);
  const infinite = (settings?.list_infinite_scroll ?? '1') !== '0';

  // 失焦 / 回车时提交；空输入或值未变则放弃编辑
  const commitPageSize = () => {
    if (draft === null) return;
    const raw = draft.trim();
    if (raw === '') {
      setDraft(null);
      return;
    }
    const next = clampPageSize(raw);
    if (next === savedPageSize) {
      setDraft(null);
      return;
    }
    updateMut.mutate({ list_page_size: String(next) }, { onSuccess: () => setDraft(null) });
  };

  return (
    <div className={styles.container}>
      <Card className={styles.card}>
        <div className={styles.title}>
          <AppsListRegular /> 文章列表
        </div>

        <div className={styles.field}>
          <Label id="list_page_size_label">每页显示条数</Label>
          <Input
            aria-labelledby="list_page_size_label"
            value={pageSizeInput}
            inputMode="numeric"
            placeholder={String(DEFAULT_PAGE_SIZE)}
            contentAfter="条"
            style={{ maxWidth: '140px' }}
            onChange={(_, d) => setDraft(composing.transform(d.value, onlyDigits))}
            onCompositionStart={composing.onCompositionStart}
            onCompositionEnd={(ev) => {
              composing.onCompositionEnd();
              setDraft(onlyDigits(ev.currentTarget.value));
            }}
            onBlur={commitPageSize}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitPageSize();
              else if (e.key === 'Escape') setDraft(null);
            }}
          />
          <div style={{ fontSize: '12px', color: tokens.colorNeutralForeground3, marginTop: '4px' }}>
            可填 {MIN_PAGE_SIZE}–{MAX_PAGE_SIZE} 之间的整数，回车或点击别处保存。首页文章列表与回收站同时生效。
          </div>
        </div>

        <div className={styles.field}>
          <Switch
            label="瀑布流使用无限滚动加载"
            checked={infinite}
            onChange={(_, d) => updateMut.mutate({ list_infinite_scroll: d.checked ? '1' : '0' })}
          />
          <div style={{ fontSize: '12px', color: tokens.colorNeutralForeground3 }}>
            仅对瀑布流视图生效：开启后滚动到底部自动加载下一页，关闭则瀑布流也改用底部分页控件。
            竖向卡片、横向卡片、表格列表这三种视图始终使用分页，不受此开关影响。
          </div>
        </div>

        {updateMut.isPending && <Spinner size="tiny" label="保存中…" />}
      </Card>
    </div>
  );
}
