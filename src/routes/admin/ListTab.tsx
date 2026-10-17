// 文章列表设置：每页条数、瀑布流是否无限滚动。存数据库，对所有用户生效
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, Input, Label, Spinner, Switch, tokens } from '@fluentui/react-components';
import { AppsListRegular } from '@fluentui/react-icons';
import { settingsApi } from '../../lib/tauri';
import { clampPageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, MIN_PAGE_SIZE } from '../../lib/listSettings';
import { useStyles } from './styles';
import { useLanguage } from '../../i18n';
import { useComposingInput } from '../../hooks/useComposingInput';

/** 每页条数只放行数字；组词期间不改写内容，见 useComposingInput */
const onlyDigits = (s: string) => s.replace(/[^0-9]/g, '');

export function ListTab() {
  const styles = useStyles();
  const { t } = useLanguage();
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

  if (isLoading) return <Spinner label={t('common.loading')} />;

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
          <AppsListRegular /> {t('settings.tab.list')}
        </div>

        <div className={styles.field}>
          <Label id="list_page_size_label">{t('list.pageSize')}</Label>
          <Input
            aria-labelledby="list_page_size_label"
            value={pageSizeInput}
            inputMode="numeric"
            placeholder={String(DEFAULT_PAGE_SIZE)}
            contentAfter={t('list.pageSizeUnit')}
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
            {t('list.pageSizeHint', { min: MIN_PAGE_SIZE, max: MAX_PAGE_SIZE })}
          </div>
        </div>

        <div className={styles.field}>
          <Switch
            label={t('list.infiniteScroll')}
            checked={infinite}
            onChange={(_, d) => updateMut.mutate({ list_infinite_scroll: d.checked ? '1' : '0' })}
          />
          <div style={{ fontSize: '12px', color: tokens.colorNeutralForeground3 }}>{t('list.infiniteHint')}</div>
        </div>

        {updateMut.isPending && <Spinner size="tiny" label={t('list.saving')} />}
      </Card>
    </div>
  );
}
