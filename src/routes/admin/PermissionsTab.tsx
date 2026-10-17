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
import { LEVEL_OPTIONS, levelText } from '../../lib/levels';
import { useStyles } from './styles';

/** def：数据库里没有该键时的默认阈值（其余各项默认 5 = 仅管理员） */
const PERM_FIELDS: { key: string; label: string; hint?: string; def?: number }[] = [
  { key: 'perm_article_own', label: '文章（自己）', hint: '新建、编辑、删除自己的文章' },
  { key: 'perm_article', label: '文章（管理他人）', hint: '编辑、删除、批量操作他人的文章' },
  { key: 'perm_collection_own', label: '合集（自己）', hint: '新建、编辑、删除自己的合集' },
  { key: 'perm_collection', label: '合集（管理他人）', hint: '管理他人创建的合集' },
  { key: 'perm_tag', label: '标签管理' },
  { key: 'perm_trash', label: '回收站管理' },
  { key: 'perm_user', label: '用户管理' },
  {
    key: 'perm_translate',
    label: '使用翻译',
    hint: '在编辑页翻译标题与正文；翻译额度由管理员统一提供',
    def: 0,
  },
];

export function PermissionsTab() {
  const styles = useStyles();
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
      setMsg({ ok: true, text: '权限设置已保存' });
    },
    onError: (e: Error) => setMsg({ ok: false, text: e.message || '保存失败' }),
  });

  const save = () => {
    const items: Record<string, string> = {};
    for (const f of PERM_FIELDS) items[f.key] = String(form[f.key] ?? f.def ?? 5);
    saveMut.mutate(items);
  };

  return (
    <Card className={styles.card}>
      <div className={styles.title}>
        <ShieldRegular /> 权限管理
      </div>
      <p style={{ marginTop: 0, fontSize: '13px', color: tokens.colorNeutralForeground2 }}>
        设置各管理功能所需的最低权限值（0-5）。用户的权限值达到或超过该值即可使用；管理员始终拥有全部权限；默认
        5（仅管理员）。
      </p>
      {PERM_FIELDS.map((f) => (
        <div key={f.key} className={styles.field}>
          <Label>{f.label}</Label>
          {f.hint && (
            <span
              style={{ fontSize: '12px', color: tokens.colorNeutralForeground3, display: 'block', marginBottom: '4px' }}
            >
              {f.hint}
            </span>
          )}
          <Dropdown
            value={levelText(form[f.key] ?? f.def ?? 5)}
            selectedOptions={[String(form[f.key] ?? f.def ?? 5)]}
            onOptionSelect={(_, d) => d.optionValue && setForm((prev) => ({ ...prev, [f.key]: Number(d.optionValue) }))}
          >
            {LEVEL_OPTIONS.map((n) => (
              <Option key={n} value={String(n)} text={levelText(n)}>
                {levelText(n)}
              </Option>
            ))}
          </Dropdown>
        </div>
      ))}
      {msg && (
        <MessageBar intent={msg.ok ? 'success' : 'error'} className={styles.feedback}>
          <MessageBarBody>
            <MessageBarTitle>{msg.ok ? '成功' : '失败'}</MessageBarTitle>
            {msg.text}
          </MessageBarBody>
        </MessageBar>
      )}
      <Button appearance="primary" onClick={save} disabled={saveMut.isPending}>
        保存权限设置
      </Button>
    </Card>
  );
}
