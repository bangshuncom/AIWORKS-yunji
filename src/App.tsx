// 路由定义（使用 HashRouter 以兼容 Tauri 的 tauri:// 协议）
import { createHashRouter, Navigate } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { LoginPage } from './routes/LoginPage';
import { RegisterPage } from './routes/RegisterPage';
import { ProfilePage } from './routes/ProfilePage';
import { ListPage } from './routes/ListPage';
import { DetailPage } from './routes/DetailPage';
import { EditPage } from './routes/EditPage';
import { TagsPage } from './routes/TagsPage';
import { CollectionsPage } from './routes/CollectionsPage';
import { CollectionDetailPage } from './routes/CollectionDetailPage';
import { CollectionEditPage } from './routes/CollectionEditPage';
import { AuthorsPage } from './routes/AuthorsPage';
import { CategoriesPage } from './routes/CategoriesPage';
import { TrashPage } from './routes/TrashPage';
import { AdminPage } from './routes/AdminPage';
import { RequireAuth, RequirePerm } from './routes/RequireAuth';

export const router = createHashRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <ListPage /> },
      { path: 'detail/:rid', element: <DetailPage /> },
      { path: 'tags', element: <TagsPage /> },
      { path: 'authors', element: <AuthorsPage /> },
      { path: 'collections', element: <CollectionsPage /> },
      { path: 'collection/:cid', element: <CollectionDetailPage /> },
      {
        path: 'collection-edit',
        element: (
          <RequirePerm feature="collection_own">
            <CollectionEditPage />
          </RequirePerm>
        ),
      },
      {
        path: 'collection-edit/:cid',
        element: (
          <RequirePerm feature="collection_own">
            <CollectionEditPage />
          </RequirePerm>
        ),
      },
      {
        path: 'categories',
        element: (
          <RequirePerm feature="article">
            <CategoriesPage />
          </RequirePerm>
        ),
      },
      {
        path: 'edit',
        element: (
          <RequirePerm feature="article">
            <EditPage />
          </RequirePerm>
        ),
      },
      {
        path: 'edit/:rid',
        element: (
          <RequirePerm feature="article">
            <EditPage />
          </RequirePerm>
        ),
      },
      {
        path: 'trash',
        element: (
          <RequirePerm feature="trash">
            <TrashPage />
          </RequirePerm>
        ),
      },
      {
        // 各 Tab 内部按功能权限自行门控
        path: 'admin',
        element: (
          <RequireAuth>
            <AdminPage />
          </RequireAuth>
        ),
      },
      {
        path: 'profile',
        element: (
          <RequireAuth>
            <ProfilePage />
          </RequireAuth>
        ),
      },
    ],
  },
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  { path: '*', element: <Navigate to="/" replace /> },
]);
