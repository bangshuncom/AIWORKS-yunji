// 认证页外壳：居中卡片 + 标题 + 页脚链接（登录 / 注册共用）
import type { ReactNode } from 'react';
import { Card, CardHeader, makeStyles } from '@fluentui/react-components';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
  },
  card: {
    width: '400px',
    padding: '24px',
  },
  footer: {
    marginTop: '12px',
    textAlign: 'center',
    fontSize: '13px',
  },
});

export function AuthShell({ title, footer, children }: { title: string; footer?: ReactNode; children: ReactNode }) {
  const s = useStyles();
  return (
    <div className={s.container}>
      <Card className={s.card}>
        <CardHeader header={<h2>{title}</h2>} />
        {children}
        {footer ? <div className={s.footer}>{footer}</div> : null}
      </Card>
    </div>
  );
}
