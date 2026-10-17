// 设置页：Tab 分发。各 Tab 实现见 ./admin/ 目录，新增 Tab 只需在此注册
import { useEffect, useState } from 'react';
import { MessageBar, MessageBarBody, MessageBarTitle, Spinner, Tab, TabList } from '@fluentui/react-components';
import { usePerms } from '../hooks/usePerms';
import { useLanguage } from '../i18n';
import { GeneralTab } from './admin/GeneralTab';
import { ListTab } from './admin/ListTab';
import { UsersTab } from './admin/UsersTab';
import { PermissionsTab } from './admin/PermissionsTab';
import { ProxyTab } from './admin/ProxyTab';
import { TranslateTab } from './admin/TranslateTab';
import { CleanupTab } from './admin/CleanupTab';
import { LanguageTab } from './admin/LanguageTab';

export type TabId = 'general' | 'list' | 'users' | 'permissions' | 'proxy' | 'translate' | 'cleanup' | 'language';

export function AdminPage() {
  const { isAdmin, can, settingsLoaded } = usePerms();
  const { t } = useLanguage();
  const canUser = can('user');

  const tabs: { id: TabId; label: string }[] = [];
  if (isAdmin) tabs.push({ id: 'general', label: t('settings.tab.general') });
  if (isAdmin) tabs.push({ id: 'list', label: t('settings.tab.list') });
  if (canUser) tabs.push({ id: 'users', label: t('settings.tab.users') });
  if (isAdmin) tabs.push({ id: 'permissions', label: t('settings.tab.permissions') });
  if (isAdmin) tabs.push({ id: 'proxy', label: t('settings.tab.proxy') });
  if (isAdmin) tabs.push({ id: 'translate', label: t('settings.tab.translate') });
  if (isAdmin) tabs.push({ id: 'cleanup', label: t('settings.tab.cleanup') });
  // 语言：所有登录用户可见（含个人界面语言覆盖；全局默认部分仅管理员可改）
  tabs.push({ id: 'language', label: t('settings.tab.language') });

  const [tab, setTab] = useState<TabId | null>(tabs[0]?.id ?? null);
  useEffect(() => {
    if (tab && tabs.some((t) => t.id === tab)) return;
    setTab(tabs[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, canUser]);

  if (!settingsLoaded && !isAdmin) {
    return <Spinner label={t('settings.loading')} />;
  }

  if (tabs.length === 0) {
    return (
      <MessageBar intent="warning">
        <MessageBarBody>
          <MessageBarTitle>{t('settings.noAccess.title')}</MessageBarTitle>
          {t('settings.noAccess.desc')}
        </MessageBarBody>
      </MessageBar>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <h2 style={{ margin: 0 }}>{t('settings.title')}</h2>
      <TabList selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as TabId)}>
        {tabs.map((t) => (
          <Tab key={t.id} value={t.id}>
            {t.label}
          </Tab>
        ))}
      </TabList>

      {tab === 'general' && isAdmin && <GeneralTab />}
      {tab === 'list' && isAdmin && <ListTab />}
      {tab === 'users' && canUser && <UsersTab />}
      {tab === 'permissions' && isAdmin && <PermissionsTab />}
      {tab === 'proxy' && isAdmin && <ProxyTab />}
      {tab === 'translate' && isAdmin && <TranslateTab />}
      {tab === 'cleanup' && isAdmin && <CleanupTab />}
      {tab === 'language' && <LanguageTab />}
    </div>
  );
}
