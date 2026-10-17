// 权限管理：各项管理功能所需的最低权限值
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  Dropdown,
  Option,
  Label,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  tokens,
} from '@fluentui/react-components';
import { ShieldRegular } from '@fluentui/react-icons';
import { settingsApi } from '../../lib/tauri';
import { LEVEL_OPTIONS, levelTextKey } from '../../lib/levels';
import { useStyles } from './styles';
import { useLanguage } from '../../i18n';

/** def：数据库里没有该键时的默认阈值（其余各项默认 5 = 仅管理员） */
const PERM_FIELDS: { key: string; labelKey: string; hintKey?: string; def?: number }[] = [
  { key: 'perm_article_own', labelKey: 'perm.articleOwn', hintKey: 'perm.hint.articleOwn' },
  { key: 'perm_article', labelKey: 'perm.article', hintKey: 'perm.hint.article' },
  { key: 'perm_collection_own', labelKey: 'perm.collectionOwn', hintKey: 'perm.hint.collectionOwn' },
  { key: 'perm_collection', labelKey: 'perm.collection', hintKey: 'perm.hint.collection' },
  { key: 'perm_tag', labelKey: 'perm.tag' },
  { key: 'perm_trash', labelKey: 'perm.trash' },
  { key: 'perm_user', labelKey: 'perm.user' },
  {
    key: 'perm_translate',
    labelKey: 'perm.translate',
    hintKey: 'perm.hint.translate',
    def: 0,
  },
];

export function PermissionsTab() {
  const styles = useStyles();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });

  useEffect(() => {
    if (settings) {
      const next: Record<string, number> = {};
      for (const f of PERM_FIELDS) {
        next[f.key] = Number(settings[f.key] ?? f.def ?? 5);
      }
      setForm(next);
    }
  }, [settings]);

  const saveMut = useMutation({
    mutationFn: (items: Record<string, string>) => settingsApi.update(items),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['public-settings'] });
      setMsg({ ok: true, text: t('perm.saved') });
    },
    onError: (e: Error) => setMsg({ ok: false, text: e.message || t('edit.saveFailed') }),
  });

  const save = () => {
    const items: Record<string, string> = {};
    for (const f of PERM_FIELDS) items[f.key] = String(form[f.key] ?? f.def ?? 5);
    saveMut.mutate(items);
  };

  return (
    <Card className={styles.card}>
      <div className={styles.title}>
        <ShieldRegular /> {t('settings.tab.permissions')}
      </div>
      <p style={{ marginTop: 0, fontSize: '13px', color: tokens.colorNeutralForeground2 }}>{t('perm.desc')}</p>
      {PERM_FIELDS.map((f) => {
        const lvl = form[f.key] ?? f.def ?? 5;
        return (
          <div key={f.key} className={styles.field}>
            <Label>{t(f.labelKey)}</Label>
            {f.hintKey && (
              <span
                style={{
                  fontSize: '12px',
                  color: tokens.colorNeutralForeground3,
                  display: 'block',
                  marginBottom: '4px',
                }}
              >
                {t(f.hintKey)}
              </span>
            )}
            <Dropdown
              value={t(levelTextKey(lvl), { n: lvl })}
              selectedOptions={[String(lvl)]}
              onOptionSelect={(_, d) =>
                d.optionValue && setForm((prev) => ({ ...prev, [f.key]: Number(d.optionValue) }))
              }
            >
              {LEVEL_OPTIONS.map((n) => (
                <Option key={n} value={String(n)} text={t(levelTextKey(n), { n })}>
                  {t(levelTextKey(n), { n })}
                </Option>
              ))}
            </Dropdown>
          </div>
        );
      })}
      {msg && (
        <MessageBar intent={msg.ok ? 'success' : 'error'} className={styles.feedback}>
          <MessageBarBody>
            <MessageBarTitle>{msg.ok ? t('common.success') : t('common.fail')}</MessageBarTitle>
            {msg.text}
          </MessageBarBody>
        </MessageBar>
      )}
      <Button appearance="primary" onClick={save} disabled={saveMut.isPending}>
        {t('perm.save')}
      </Button>
    </Card>
  );
}
