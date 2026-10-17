// 注册页
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@fluentui/react-components';
import { AuthShell } from '../components/common/AuthShell';
import { FormField } from '../components/common/FormField';
import { useAuthStore } from '../stores/authStore';
import { authApi } from '../lib/tauri';
import { useLanguage } from '../i18n';

export function RegisterPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
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
      setError(t('profile.pwdMismatch'));
      return;
    }
    setLoading(true);
    try {
      const user = await authApi.register(username.trim(), nickname.trim(), email.trim(), password);
      setUser(user);
      navigate('/');
    } catch (err: any) {
      setError(err.message || t('register.failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title={t('auth.register')}
      footer={
        <>
          {t('register.haveAccount')}
          <Link to="/login">{t('register.goLogin')}</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        <FormField
          id="username"
          label={t('auth.username')}
          value={username}
          onChange={(_, d) => setUsername(d.value)}
          placeholder={t('register.usernamePlaceholder')}
          required
        />
        <FormField
          id="nickname"
          label={t('profile.nickname')}
          value={nickname}
          onChange={(_, d) => setNickname(d.value)}
          required
        />
        <FormField
          id="email"
          label={t('profile.email')}
          type="email"
          value={email}
          onChange={(_, d) => setEmail(d.value)}
          required
        />
        <FormField
          id="password"
          label={t('auth.password')}
          type="password"
          value={password}
          onChange={(_, d) => setPassword(d.value)}
          placeholder={t('register.passwordPlaceholder')}
          required
        />
        <FormField
          id="confirm"
          label={t('register.confirmPassword')}
          type="password"
          value={confirmPassword}
          onChange={(_, d) => setConfirmPassword(d.value)}
          required
        />
        {error && <div style={{ color: 'red', marginBottom: '8px' }}>{error}</div>}
        <Button type="submit" appearance="primary" disabled={loading} style={{ width: '100%' }}>
          {loading ? t('register.registering') : t('auth.register')}
        </Button>
      </form>
    </AuthShell>
  );
}
