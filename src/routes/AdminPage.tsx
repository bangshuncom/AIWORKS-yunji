// 设置页：Tab 分发。各 Tab 实现见 ./admin/ 目录，新增 Tab 只需在此注册
import { useEffect, useState } from 'react';
import { MessageBar, MessageBarBody, MessageBarTitle, Spinner, Tab, TabList } from '@fluentui/react-components';
import { usePerms } from '../hooks/usePerms';
import { GeneralTab } from './admin/GeneralTab';
import { ListTab } from './admin/ListTab';
import { UsersTab } from './admin/UsersTab';
import { PermissionsTab } from './admin/PermissionsTab';
import { ProxyTab } from './admin/ProxyTab';
import { TranslateTab } from './admin/TranslateTab';
import { CleanupTab } from './admin/CleanupTab';

export type TabId = 'general' | 'list' | 'users' | 'permissions' | 'proxy' | 'translate' | 'cleanup';

export function AdminPage() {
  const { isAdmin, can, settingsLoaded } = usePerms();
  const canUser = can('user');

  const tabs: { id: TabId; label: string }[] = [];
  if (isAdmin) tabs.push({ id: 'general', label: '常规设置' });
  if (isAdmin) tabs.push({ id: 'list', label: '文章列表' });
  if (canUser) tabs.push({ id: 'users', label: '用户管理' });
  if (isAdmin) tabs.push({ id: 'permissions', label: '权限管理' });
  if (isAdmin) tabs.push({ id: 'proxy', label: '代理设置' });
  if (isAdmin) tabs.push({ id: 'translate', label: '翻译设置' });
  if (isAdmin) tabs.push({ id: 'cleanup', label: '附件清理' });

  const [tab, setTab] = useState<TabId | null>(tabs[0]?.id ?? null);
  useEffect(() => {
    if (tab && tabs.some((t) => t.id === tab)) return;
    setTab(tabs[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, canUser]);

  if (!settingsLoaded && !isAdmin) {
    return <Spinner label="加载中..." />;
  }

  if (tabs.length === 0) {
    return (
      <MessageBar intent="warning">
        <MessageBarBody>
          <MessageBarTitle>无权访问</MessageBarTitle>
          当前账户没有任何设置项的访问权限。
        </MessageBarBody>
      </MessageBar>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <h2 style={{ margin: 0 }}>应用设置</h2>
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
    </div>
  );
}
