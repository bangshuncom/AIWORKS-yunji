// 访问密码解锁弹窗：资源详情页与合集详情页共用
import { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Input,
  Text,
  tokens,
} from '@fluentui/react-components';
import { KeyRegular } from '@fluentui/react-icons';

export interface PasswordDialogProps {
  open: boolean;
  /** 弹窗标题，如「该文章受访问密码保护」 */
  title: string;
  /** 密码校验回调：返回 true 表示密码正确 */
  onSubmit: (password: string) => Promise<boolean>;
  /** 解锁成功后关闭并刷新内容 */
  onUnlocked: () => void;
  onClose: () => void;
}

/**
 * 受保护内容的密码入口。
 * 服务端不会告知「是否设了密码」，因此解锁失败时统一提示密码错误或权限不足。
 */
export function PasswordDialog({ open, title, onSubmit, onUnlocked, onClose }: PasswordDialogProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // 每次打开时重置输入
  useEffect(() => {
    if (open) {
      setPassword('');
      setError('');
    }
  }, [open]);

  const submit = async () => {
    if (!password.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const ok = await onSubmit(password);
      if (ok) {
        onUnlocked();
        onClose();
      } else {
        setError('密码错误');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '校验失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                输入访问密码后即可查看；没有密码或权限不足时无法访问。
              </Text>
              <Input
                type="password"
                autoFocus
                placeholder="访问密码"
                value={password}
                onChange={(_, d) => setPassword(d.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submit();
                }}
                contentBefore={<KeyRegular />}
              />
              {error && (
                <Text size={200} style={{ color: tokens.colorPaletteRedForeground1 }}>
                  {error}
                </Text>
              )}
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose}>
              取消
            </Button>
            <Button appearance="primary" disabled={!password.trim() || busy} onClick={() => void submit()}>
              {busy ? '校验中...' : '解锁'}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
