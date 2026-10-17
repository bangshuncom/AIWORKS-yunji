// 登录页
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@fluentui/react-components';
import { AuthShell } from '../components/common/AuthShell';
import { FormField } from '../components/common/FormField';
import { useAuthStore } from '../stores/authStore';
import { useLanguage } from '../i18n';

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = searchParams.get('next') || '/';
  const { login } = useAuthStore();
  const { t } = useLanguage();
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
      setError(err.message || t('auth.loginFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title={t('auth.login')}
      footer={
        <>
          {t('auth.noAccount')}
          <Link to="/register">{t('auth.register')}</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        <FormField
          id="username"
          label={t('auth.username')}
          value={username}
          onChange={(_, d) => setUsername(d.value)}
          required
        />
        <FormField
          id="password"
          label={t('auth.password')}
          type="password"
          value={password}
          onChange={(_, d) => setPassword(d.value)}
          required
        />
        {error && <div style={{ color: 'red', marginBottom: '8px' }}>{error}</div>}
        <Button type="submit" appearance="primary" disabled={loading} style={{ width: '100%' }}>
          {loading ? t('auth.loggingIn') : t('auth.login')}
        </Button>
      </form>
    </AuthShell>
  );
}
