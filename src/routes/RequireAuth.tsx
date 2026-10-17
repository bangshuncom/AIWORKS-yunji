// 认证守卫：未登录跳转登录页；feature 模式下还需对应功能权限
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { MessageBar, MessageBarBody, MessageBarTitle, Spinner } from '@fluentui/react-components';
import { usePerms, type Feature } from '../hooks/usePerms';
import { useLanguage } from '../i18n';

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthStore();
  const { t } = useLanguage();
  const location = useLocation();

  if (loading) {
    return <Spinner label={t('common.loading')} />;
  }

  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  return <>{children}</>;
}

const FEATURE_LABEL_KEY: Record<Feature, string> = {
  article_own: 'perm.articleOwn',
  article: 'perm.article',
  collection_own: 'perm.collectionOwn',
  collection: 'perm.collection',
  tag: 'perm.tag',
  trash: 'perm.trash',
  user: 'perm.user',
};

export function RequirePerm({ feature, children }: { feature: Feature; children: React.ReactNode }) {
  const { user, loading } = useAuthStore();
  const { can, settingsLoaded } = usePerms();
  const { t } = useLanguage();
  const location = useLocation();

  if (loading) {
    return <Spinner label={t('common.loading')} />;
  }
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  // 管理员无需读取阈值；普通用户等待公开设置加载完成再判定
  if (!settingsLoaded && !user.is_admin) {
    return <Spinner label={t('common.loading')} />;
  }
  if (!can(feature)) {
    return (
      <MessageBar intent="warning">
        <MessageBarBody>
          <MessageBarTitle>{t('settings.noAccess.title')}</MessageBarTitle>
          {t('perm.need', { feature: t(FEATURE_LABEL_KEY[feature]) })}
        </MessageBarBody>
      </MessageBar>
    );
  }
  return <>{children}</>;
}
