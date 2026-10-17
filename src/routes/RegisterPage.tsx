// 注册页
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@fluentui/react-components';
import { AuthShell } from '../components/common/AuthShell';
import { FormField } from '../components/common/FormField';
import { useAuthStore } from '../stores/authStore';
import { authApi } from '../lib/tauri';

export function RegisterPage() {
  const navigate = useNavigate();
  const { setUser } = useAuthStore();
  const [username, setUsername] = useState('');
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    setLoading(true);
    try {
      const user = await authApi.register(username.trim(), nickname.trim(), email.trim(), password);
      setUser(user);
      navigate('/');
    } catch (err: any) {
      setError(err.message || '注册失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="注册"
      footer={
        <>
          已有账户？<Link to="/login">去登录</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        <FormField
          id="username"
          label="用户名"
          value={username}
          onChange={(_, d) => setUsername(d.value)}
          placeholder="2-32 个字符"
          required
        />
        <FormField id="nickname" label="昵称" value={nickname} onChange={(_, d) => setNickname(d.value)} required />
        <FormField id="email" label="邮箱" type="email" value={email} onChange={(_, d) => setEmail(d.value)} required />
        <FormField
          id="password"
          label="密码"
          type="password"
          value={password}
          onChange={(_, d) => setPassword(d.value)}
          placeholder="至少 6 位"
          required
        />
        <FormField
          id="confirm"
          label="确认密码"
          type="password"
          value={confirmPassword}
          onChange={(_, d) => setConfirmPassword(d.value)}
          required
        />
        {error && <div style={{ color: 'red', marginBottom: '8px' }}>{error}</div>}
        <Button type="submit" appearance="primary" disabled={loading} style={{ width: '100%' }}>
          {loading ? '注册中...' : '注册'}
        </Button>
      </form>
    </AuthShell>
  );
}
