// 应用入口：FluentProvider + QueryClientProvider + RouterProvider
import React from 'react';
import ReactDOM from 'react-dom/client';
import { FluentProvider } from '@fluentui/react-components';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { yunjiLightTheme, yunjiDarkTheme } from './theme/fluentTheme';
import { router } from './App';
import { useUIStore } from './stores/uiStore';
import { useAuthStore } from './stores/authStore';
import { initAssetBaseDir, settingsApi } from './lib/tauri';
import './styles/global.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function AppContent() {
  const theme = useUIStore((s) => s.theme);
  const init = useAuthStore((s) => s.init);

  React.useEffect(() => {
    // 并行初始化认证状态和资源根目录
    Promise.all([init(), initAssetBaseDir()]).catch(() => {});
    // 禁用 Tauri/WebView 默认右键菜单；有操作权限的卡片由 Fluent UI openOnContext 接管
    const handler = (e: MouseEvent) => {
      e.preventDefault();
    };
    document.addEventListener('contextmenu', handler);
    // 拦截外部链接点击：禁止 WebView 内部导航，交由系统/指定浏览器打开。
    // 捕获阶段监听，先于 React 合成事件执行。
    const clickHandler = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest?.('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href') || '';
      // 仅拦 http(s) 外链；排除本地附件（data-asset）和 asset 协议资源
      if (!/^https?:\/\//i.test(href)) return;
      if (anchor.hasAttribute('data-asset')) return;
      if (/^https?:\/\/asset\.localhost\//i.test(href)) return;
      e.preventDefault();
      settingsApi.openExternalUrl(href).catch((err) => {
        console.error('打开外部链接失败:', err);
      });
    };
    document.addEventListener('click', clickHandler, true);
    return () => {
      document.removeEventListener('contextmenu', handler);
      document.removeEventListener('click', clickHandler, true);
    };
  }, [init]);

  return (
    <FluentProvider theme={theme === 'dark' ? yunjiDarkTheme : yunjiLightTheme}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </FluentProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppContent />
  </React.StrictMode>,
);
