// 代理设置：系统 / 直连 / 自定义
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  Input,
  Label,
  Radio,
  RadioGroup,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  tokens,
} from '@fluentui/react-components';
import { CloudRegular } from '@fluentui/react-icons';
import { settingsApi } from '../../lib/tauri';
import { useStyles } from './styles';
import { useLanguage } from '../../i18n';

const PROXY_MODES = [
  { value: 'system', labelKey: 'proxy.system', hintKey: 'proxy.systemHint' },
  { value: 'none', labelKey: 'proxy.none', hintKey: 'proxy.noneHint' },
  { value: 'custom', labelKey: 'proxy.custom', hintKey: 'proxy.customHint' },
];

export function ProxyTab() {
  const styles = useStyles();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });
  const { data: status } = useQuery({
    queryKey: ['proxy-status'],
    queryFn: settingsApi.getProxyStatus,
    refetchInterval: 10_000,
  });

  const [mode, setMode] = useState('system');
  const [customUrl, setCustomUrl] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (settings && !loaded) {
      setMode(settings.proxy_mode ?? 'system');
      setCustomUrl(settings.proxy_url ?? '');
      setLoaded(true);
    }
  }, [settings, loaded]);

  const saveMut = useMutation({
    mutationFn: (payload: Record<string, string>) => settingsApi.update(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['proxy-status'] });
      setMsg({ ok: true, text: t('proxy.saved') });
    },
    onError: (e: Error) => setMsg({ ok: false, text: e.message || t('edit.saveFailed') }),
  });

  const save = () => {
    if (mode === 'custom' && !customUrl.trim()) {
      setMsg({ ok: false, text: t('proxy.needUrl') });
      return;
    }
    saveMut.mutate({ proxy_mode: mode, proxy_url: customUrl.trim() });
  };

  return (
    <Card className={styles.card}>
      <div className={styles.title}>
        <CloudRegular /> {t('proxy.title')}
      </div>
      <p style={{ marginTop: 0, fontSize: '13px', color: tokens.colorNeutralForeground2 }}>{t('proxy.desc')}</p>
      <div className={styles.field}>
        <Label>{t('proxy.modeLabel')}</Label>
        <RadioGroup value={mode} onChange={(_, d) => setMode(d.value)}>
          {PROXY_MODES.map((m) => (
            <Radio key={m.value} value={m.value} label={t(m.labelKey)} />
          ))}
        </RadioGroup>
        <span style={{ fontSize: '12px', color: tokens.colorNeutralForeground3 }}>
          {t(PROXY_MODES.find((m) => m.value === mode)?.hintKey ?? '')}
        </span>
      </div>
      {mode === 'custom' && (
        <div className={styles.field}>
          <Label htmlFor="proxy_url">{t('proxy.urlLabel')}</Label>
          <Input
            id="proxy_url"
            value={customUrl}
            onChange={(_, d) => setCustomUrl(d.value)}
            placeholder={t('proxy.urlPlaceholder')}
            style={{ maxWidth: '360px' }}
          />
        </div>
      )}
      {status && (
        <div className={styles.field}>
          <Label>{t('lang.effective')}</Label>
          <Badge
            appearance={status.effective === '直连（无代理）' ? 'outline' : 'tint'}
            color={status.effective === '直连（无代理）' ? undefined : 'brand'}
          >
            {status.effective}
          </Badge>
        </div>
      )}
      {msg && (
        <MessageBar intent={msg.ok ? 'success' : 'error'} className={styles.feedback}>
          <MessageBarBody>
            <MessageBarTitle>{msg.ok ? t('common.success') : t('common.fail')}</MessageBarTitle>
            {msg.text}
          </MessageBarBody>
        </MessageBar>
      )}
      <Button appearance="primary" onClick={save} disabled={saveMut.isPending}>
        {t('proxy.save')}
      </Button>
    </Card>
  );
}
