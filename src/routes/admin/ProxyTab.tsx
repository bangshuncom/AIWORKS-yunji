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

const PROXY_MODES = [
  { value: 'system', label: '系统代理', hint: '自动读取 Windows 系统代理 / 环境变量（默认）' },
  { value: 'none', label: '不使用代理', hint: '所有网络请求直连' },
  { value: 'custom', label: '自定义代理', hint: '手动指定代理服务器地址' },
];

export function ProxyTab() {
  const styles = useStyles();
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
      setMsg({ ok: true, text: '代理设置已保存并生效' });
    },
    onError: (e: Error) => setMsg({ ok: false, text: e.message || '保存失败' }),
  });

  const save = () => {
    if (mode === 'custom' && !customUrl.trim()) {
      setMsg({ ok: false, text: '自定义模式需要填写代理地址' });
      return;
    }
    saveMut.mutate({ proxy_mode: mode, proxy_url: customUrl.trim() });
  };

  return (
    <Card className={styles.card}>
      <div className={styles.title}>
        <CloudRegular /> 代理设置
      </div>
      <p style={{ marginTop: 0, fontSize: '13px', color: tokens.colorNeutralForeground2 }}>
        影响网页采集、封面/图集下载、编辑器粘贴图片本地化等应用内网络请求。保存后立即生效。
      </p>
      <div className={styles.field}>
        <Label>代理模式</Label>
        <RadioGroup value={mode} onChange={(_, d) => setMode(d.value)}>
          {PROXY_MODES.map((m) => (
            <Radio key={m.value} value={m.value} label={m.label} />
          ))}
        </RadioGroup>
        <span style={{ fontSize: '12px', color: tokens.colorNeutralForeground3 }}>
          {PROXY_MODES.find((m) => m.value === mode)?.hint}
        </span>
      </div>
      {mode === 'custom' && (
        <div className={styles.field}>
          <Label htmlFor="proxy_url">代理地址</Label>
          <Input
            id="proxy_url"
            value={customUrl}
            onChange={(_, d) => setCustomUrl(d.value)}
            placeholder="127.0.0.1:7890 或 http://host:port"
            style={{ maxWidth: '360px' }}
          />
        </div>
      )}
      {status && (
        <div className={styles.field}>
          <Label>当前生效</Label>
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
            <MessageBarTitle>{msg.ok ? '成功' : '失败'}</MessageBarTitle>
            {msg.text}
          </MessageBarBody>
        </MessageBar>
      )}
      <Button appearance="primary" onClick={save} disabled={saveMut.isPending}>
        保存代理设置
      </Button>
    </Card>
  );
}
