// 登录页
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@fluentui/react-components';
import { AuthShell } from '../components/common/AuthShell';
import { FormField } from '../components/common/FormField';
import { useAuthStore } from '../stores/authStore';

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = searchParams.get('next') || '/';
  const { login } = useAuthStore();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(username, password);
      navigate(next);
    } catch (err: any) {
      setError(err.message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="登录"
      footer={
        <>
          还没有账户？<Link to="/register">注册</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        <FormField id="username" label="用户名" value={username} onChange={(_, d) => setUsername(d.value)} required />
        <FormField
          id="password"
          label="密码"
          type="password"
          value={password}
          onChange={(_, d) => setPassword(d.value)}
          required
        />
        {error && <div style={{ color: 'red', marginBottom: '8px' }}>{error}</div>}
        <Button type="submit" appearance="primary" disabled={loading} style={{ width: '100%' }}>
          {loading ? '登录中...' : '登录'}
        </Button>
      </form>
    </AuthShell>
  );
}
