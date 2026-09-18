// 设置页：Tab 切换（常规 / 用户管理 / 权限管理 / 附件清理）
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Dropdown,
  Option,
  Input,
  Label,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Radio,
  RadioGroup,
  Spinner,
  Switch,
  Tab,
  TabList,
  Textarea,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  SettingsRegular,
  CloudRegular,
  PersonRegular,
  DeleteRegular,
  EditRegular,
  ShieldRegular,
  ScanObjectRegular,
  FolderOpenRegular,
  ImageRegular,
  DocumentRegular,
  DesktopRegular,
  GlobeRegular,
  SearchRegular,
  AddRegular,
} from '@fluentui/react-icons';
import { settingsApi, userApi, assetUrl, cleanupApi, torrentApi } from '../lib/tauri';
import type { OrphanFile } from '../lib/tauri';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useAuthStore } from '../stores/authStore';
import { usePerms } from '../hooks/usePerms';
import { useSelection, BatchBar } from '../components/batch';
import { UserEditDialog } from '../components/UserEditDialog';
import { Pagination } from '../components/Pagination';
import { formatBytes } from '../lib/format';
import type { AdminUser } from '../types/models';

// 0-5 权限选项文案
export const LEVEL_OPTIONS = [0, 1, 2, 3, 4, 5];
export const levelText = (n: number) =>
  n === 0 ? '0 - 所有登录用户' : n === 5 ? '5 - 仅管理员' : `权限 ${n} 级及以上`;

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    maxWidth: '760px',
  },
  card: {
    padding: '16px',
  },
  title: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '16px',
    fontWeight: 700,
    marginBottom: '12px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    marginBottom: '12px',
  },
  userRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 4px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    '&:last-child': {
      borderBottom: 'none',
    },
  },
  userCheck: {
    flexShrink: 0,
  },
  userInfo: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    minWidth: 0,
  },
  userName: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  userMeta: {
    fontSize: '12px',
    color: tokens.colorNeutralForeground3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  cleanupContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    maxWidth: '960px',
  },
  filterBar: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
  },
  orphanRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 4px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    '&:last-child': {
      borderBottom: 'none',
    },
  },
  orphanCheck: {
    flexShrink: 0,
  },
  orphanThumb: {
    width: '36px',
    height: '36px',
    objectFit: 'cover',
    borderRadius: '4px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
    flexShrink: 0,
  },
  orphanIcon: {
    width: '36px',
    height: '36px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '4px',
    backgroundColor: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground3,
    flexShrink: 0,
  },
});

type TabId = 'general' | 'users' | 'permissions' | 'proxy' | 'cleanup';

export function AdminPage() {
  const { isAdmin, can, settingsLoaded } = usePerms();
  const canUser = can('user');

  const tabs: { id: TabId; label: string }[] = [];
  if (isAdmin) tabs.push({ id: 'general', label: '常规设置' });
  if (canUser) tabs.push({ id: 'users', label: '用户管理' });
  if (isAdmin) tabs.push({ id: 'permissions', label: '权限管理' });
  if (isAdmin) tabs.push({ id: 'proxy', label: '代理设置' });
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
      {tab === 'users' && canUser && <UsersTab />}
      {tab === 'permissions' && isAdmin && <PermissionsTab />}
      {tab === 'proxy' && isAdmin && <ProxyTab />}
      {tab === 'cleanup' && isAdmin && <CleanupTab />}
    </div>
  );
}

// --- 常规：站点 + 存储 ---

function GeneralTab() {
  const styles = useStyles();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>({});
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState('');

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  const updateMut = useMutation({
    mutationFn: (s: Record<string, string>) => settingsApi.update(s),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['public-settings'] });
    },
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const refreshSettings = () => {
    queryClient.invalidateQueries({ queryKey: ['settings'] });
    queryClient.invalidateQueries({ queryKey: ['public-settings'] });
  };

  const logoMode = form.logo_mode ?? 'text';
  const logoPath = form.logo_image_path ?? '';
  const iconPath = form.logo_icon_path ?? '';

  const pickLogo = async (kind: 'image' | 'icon') => {
    setLogoError('');
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'ico'] }],
    });
    if (typeof selected !== 'string') return;
    setLogoBusy(true);
    try {
      const savedPath = await settingsApi.uploadLogo(selected, kind);
      set(kind === 'image' ? 'logo_image_path' : 'logo_icon_path', savedPath);
      // 把当前选择的 LOGO 模式一并落库：
      // 否则 refreshSettings 重拉后，未保存的模式会被数据库旧值覆盖，
      // 单选框跳回旧模式、预览区消失（表现为上传/预览“不能用”）
      await settingsApi.update({ logo_mode: logoMode });
      refreshSettings();
    } catch (e: any) {
      setLogoError(e.message || 'LOGO 上传失败');
    } finally {
      setLogoBusy(false);
    }
  };

  const removeLogo = async (kind: 'image' | 'icon') => {
    setLogoError('');
    setLogoBusy(true);
    try {
      await settingsApi.clearLogo(kind);
      set(kind === 'image' ? 'logo_image_path' : 'logo_icon_path', '');
      // 同 pickLogo：模式一并落库，避免重拉后被旧值覆盖
      await settingsApi.update({ logo_mode: logoMode });
      refreshSettings();
    } catch (e: any) {
      setLogoError(e.message || 'LOGO 清除失败');
    } finally {
      setLogoBusy(false);
    }
  };

  return (
    <div className={styles.container}>
      <Card className={styles.card}>
        <div className={styles.title}>
          <SettingsRegular /> 站点信息
        </div>
        <div className={styles.field}>
          <Label htmlFor="site_name">站点名称</Label>
          <Input
            id="site_name"
            value={form.site_name ?? ''}
            onChange={(_, d) => set('site_name', d.value)}
          />
        </div>
        <div className={styles.field}>
          <Label id="logo_mode_label">LOGO 样式</Label>
          <RadioGroup
            aria-labelledby="logo_mode_label"
            value={logoMode}
            onChange={(_, d) => set('logo_mode', d.value)}
          >
            <Radio value="text" label="文字 LOGO（仅显示站点名称）" />
            <Radio value="icon_text" label="图标 + 文字" />
            <Radio value="image" label="图片 LOGO" />
          </RadioGroup>
        </div>
        {(logoMode === 'image' || logoMode === 'icon_text') && (
          <div className={styles.field}>
            <Label>{logoMode === 'image' ? 'LOGO 图片' : '图标图片'}</Label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div
                style={
                  logoMode === 'image'
                    ? {
                        // 与侧边栏 LOGO 区域同尺寸（220×64、cover 铺满），预览即最终效果
                        width: '220px',
                        height: '64px',
                        border: `1px solid ${tokens.colorNeutralStroke2}`,
                        borderRadius: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: tokens.colorNeutralBackground2,
                        overflow: 'hidden',
                      }
                    : {
                        width: '48px',
                        height: '48px',
                        border: `1px solid ${tokens.colorNeutralStroke2}`,
                        borderRadius: '8px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: tokens.colorNeutralBackground2,
                        overflow: 'hidden',
                      }
                }
              >
                {logoMode === 'image' ? (
                  logoPath ? (
                    <img
                      src={assetUrl(logoPath)}
                      alt="LOGO"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <span style={{ fontSize: '12px', color: tokens.colorNeutralForeground3 }}>
                      未设置
                    </span>
                  )
                ) : iconPath ? (
                  <img
                    src={assetUrl(iconPath)}
                    alt="图标"
                    style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain' }}
                  />
                ) : (
                  <span style={{ fontSize: '11px', color: tokens.colorNeutralForeground3 }}>
                    默认图标
                  </span>
                )}
              </div>
              <Button
                appearance="outline"
                icon={<ImageRegular />}
                onClick={() => pickLogo(logoMode === 'image' ? 'image' : 'icon')}
                disabled={logoBusy}
              >
                {logoMode === 'image'
                  ? logoPath
                    ? '更换图片'
                    : '上传图片'
                  : iconPath
                    ? '更换图标'
                    : '上传图标'}
              </Button>
              {((logoMode === 'image' && logoPath) || (logoMode === 'icon_text' && iconPath)) && (
                <Button
                  appearance="subtle"
                  icon={<DeleteRegular />}
                  onClick={() => removeLogo(logoMode === 'image' ? 'image' : 'icon')}
                  disabled={logoBusy}
                >
                  移除
                </Button>
              )}
              {logoBusy && <Spinner size="tiny" />}
            </div>
            <div style={{ fontSize: '12px', color: tokens.colorNeutralForeground3, marginTop: '4px' }}>
              {logoMode === 'image'
                ? '图片将铺满左上角 LOGO 区域（建议宽幅图片）'
                : '建议使用正方形图片，显示为站点名称前的图标；不上传则使用默认图标'}
            </div>
            {logoError && (
              <div style={{ color: tokens.colorPaletteRedForeground1, fontSize: '12px', marginTop: '4px' }}>
                {logoError}
              </div>
            )}
          </div>
        )}
        <Button
          appearance="primary"
          onClick={() =>
            updateMut.mutate({
              site_name: form.site_name ?? '',
              logo_mode: logoMode,
            })
          }
          disabled={updateMut.isPending}
        >
          保存
        </Button>
      </Card>

      <Card className={styles.card}>
        <div className={styles.title}>
          <DesktopRegular /> 窗口行为
        </div>
        <div className={styles.field}>
          <Switch
            label="关闭按钮最小化到托盘（点击窗口 × 时隐藏到系统托盘，通过托盘菜单退出程序）"
            checked={form.close_to_tray === '1'}
            onChange={(_, d) => updateMut.mutate({ close_to_tray: d.checked ? '1' : '0' })}
          />
        </div>
      </Card>

      <Card className={styles.card}>
        <div className={styles.title}>
          <GlobeRegular /> 链接打开方式
        </div>
        <div className={styles.field}>
          <Label id="link_mode_label">正文中的外部链接点击时</Label>
          <RadioGroup
            aria-labelledby="link_mode_label"
            value={form.link_open_mode ?? 'default'}
            onChange={(_, d) => set('link_open_mode', d.value)}
          >
            <Radio value="default" label="系统默认浏览器" />
            <Radio value="custom" label="指定浏览器" />
          </RadioGroup>
        </div>
        {(form.link_open_mode ?? 'default') === 'custom' && (
          <div className={styles.field}>
            <Label htmlFor="browser_path">浏览器路径（可执行文件）</Label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Input
                id="browser_path"
                style={{ flex: 1 }}
                value={form.browser_path ?? ''}
                onChange={(_, d) => set('browser_path', d.value)}
                placeholder="如 C:\Program Files\Google\Chrome\Application\chrome.exe"
              />
              <Button
                appearance="outline"
                icon={<FolderOpenRegular />}
                onClick={async () => {
                  const selected = await openDialog({
                    multiple: false,
                    filters: [{ name: '可执行文件', extensions: ['exe'] }],
                  });
                  if (typeof selected === 'string') set('browser_path', selected);
                }}
              >
                浏览
              </Button>
            </div>
            <div style={{ fontSize: '12px', color: tokens.colorNeutralForeground3, marginTop: '4px' }}>
              指定浏览器时，点击正文外链将用该浏览器打开；留空则回退系统默认浏览器
            </div>
          </div>
        )}
        <Button
          appearance="primary"
          onClick={() =>
            updateMut.mutate({
              link_open_mode: form.link_open_mode ?? 'default',
              browser_path: form.browser_path ?? '',
            })
          }
          disabled={updateMut.isPending}
        >
          保存
        </Button>
      </Card>

      <Card className={styles.card}>
        <div className={styles.title}>
          <CloudRegular /> 存储后端
        </div>
        <div className={styles.field}>
          <Label htmlFor="local_upload_dir">本地存储目录（相对或绝对路径）</Label>
          <Input
            id="local_upload_dir"
            value={form.local_upload_dir ?? ''}
            onChange={(_, d) => set('local_upload_dir', d.value)}
          />
        </div>
        <div className={styles.field}>
          <Label htmlFor="local_url_prefix">URL 前缀（用于本地资源访问）</Label>
          <Input
            id="local_url_prefix"
            value={form.local_url_prefix ?? ''}
            onChange={(_, d) => set('local_url_prefix', d.value)}
          />
        </div>
        <Button
          appearance="primary"
          onClick={() =>
            updateMut.mutate({
              local_upload_dir: form.local_upload_dir ?? 'uploads',
              local_url_prefix: form.local_url_prefix ?? 'yunji-files',
            })
          }
          disabled={updateMut.isPending}
        >
          保存存储设置
        </Button>
      </Card>
    </div>
  );
}

// --- 用户管理 ---

function UsersTab() {
  const styles = useStyles();
  const queryClient = useQueryClient();
  const selection = useSelection();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  // 新建用户
  const [createOpen, setCreateOpen] = useState(false);
  const [batchCreateOpen, setBatchCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ username: '', nickname: '', email: '', password: '', permission_level: 0 });
  const PAGE_SIZE = 36;

  const { data, isLoading } = useQuery({
    queryKey: ['users', 'paged', page, keyword],
    queryFn: () => userApi.listPage(page, PAGE_SIZE, keyword || undefined),
  });
  const users = data?.items ?? [];
  const totalUsers = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalUsers / PAGE_SIZE));

  // 删除后当前页空了自动回退；翻页/搜索清空选择
  useEffect(() => {
    if (!isLoading && page > 1 && users.length === 0) setPage(page - 1);
  }, [isLoading, users.length, page]);
  useEffect(() => {
    selection.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, keyword]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['users'] });

  const deleteMut = useMutation({
    mutationFn: (ids: number[]) => userApi.deleteMany(ids),
    onSuccess: (res) => {
      invalidate();
      const parts = [`已删除 ${res.deleted} 个用户`];
      if (res.skipped > 0) parts.push(`自动跳过 ${res.skipped} 个（自己/权限不足）`);
      setMsg({ ok: true, text: parts.join('，') });
    },
    onError: (e: Error) => setMsg({ ok: false, text: e.message || '删除失败' }),
  });

  const userIds = users.map((u) => u.id);

  const batchDelete = async () => {
    const ids = Array.from(selection.selected);
    if (ids.length === 0) return;
    // 第一层确认（任何情况下先弹，不依赖任何异步请求）
    if (!confirm(`确认删除选中的 ${ids.length} 个用户？此操作不可恢复！（自己和权限不足的账户会被自动跳过）`)) return;
    try {
      // 拉全量用户判断目标权限（分页数据可能不含选中项）
      const all = await userApi.list();
      const targets = all.filter((u) => ids.includes(u.id));
      // 初始 admin = id 最小的管理员账户
      const adminIds = all.filter((u) => u.is_admin).map((u) => u.id);
      const isInitialAdmin = adminIds.length > 0 && currentUserId === Math.min(...adminIds);
      // 初始 admin 删除权限 5 目标：二次确认（批量只弹一次）
      if (isInitialAdmin) {
        const highTargets = targets.filter((u) => u.is_admin || u.permission_level >= 5);
        if (highTargets.length > 0) {
          if (!confirm(`选中的用户中包含 ${highTargets.length} 个权限 5 的账户，确认一并删除？此操作不可恢复！`)) return;
        }
      }
      deleteMut.mutate(ids, { onSettled: () => selection.clear() });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || '删除失败' });
    }
  };

  const openEdit = (u: AdminUser) => {
    setMsg(null);
    setEditTarget(u);
  };

  // 新建单个用户
  const createMut = useMutation({
    mutationFn: userApi.create,
    onSuccess: () => {
      invalidate();
      setCreateOpen(false);
      setCreateForm({ username: '', nickname: '', email: '', password: '', permission_level: 0 });
      setMsg({ ok: true, text: '用户已创建' });
    },
    onError: (e: Error) => setMsg({ ok: false, text: e.message || '创建失败' }),
  });

  // 批量新建：多行文本，每行 "用户名,密码" 或 "用户名,密码,昵称"
  const [batchText, setBatchText] = useState('');
  const [batchPerm, setBatchPerm] = useState(0);
  const batchCreateMut = useMutation({
    mutationFn: async (lines: { username: string; password: string; nickname: string }[]) => {
      for (const l of lines) {
        await userApi.create({ ...l, email: '', permission_level: batchPerm });
      }
    },
    onSuccess: () => {
      invalidate();
      setBatchCreateOpen(false);
      setBatchText('');
      setMsg({ ok: true, text: '批量创建完成' });
    },
    onError: (e: Error) => setMsg({ ok: false, text: e.message || '批量创建失败' }),
  });

  const handleBatchCreate = () => {
    const lines = batchText.trim().split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [username, password, nickname] = l.split(',').map((s) => s.trim());
        return { username: username || '', password: password || '', nickname: nickname || username || '' };
      })
      .filter((l) => l.username && l.password);
    if (lines.length === 0) {
      setMsg({ ok: false, text: '每行格式：用户名,密码[,昵称]' });
      return;
    }
    batchCreateMut.mutate(lines);
  };

  return (
    <Card className={styles.card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div className={styles.title}>
          <PersonRegular /> 用户管理
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Button
            appearance="primary"
            size="small"
            icon={<AddRegular />}
            onClick={() => { setCreateForm({ username: '', nickname: '', email: '', password: '', permission_level: 0 }); setCreateOpen(true); }}
          >
            新建用户
          </Button>
          <Button
            appearance="outline"
            size="small"
            icon={<AddRegular />}
            onClick={() => setBatchCreateOpen(true)}
          >
            批量新建
          </Button>
          <Input
            style={{ width: '200px' }}
            placeholder="搜索用户名 / 昵称 / 邮箱"
            value={keyword}
            onChange={(_, d) => {
              setKeyword(d.value);
              setPage(1);
            }}
            contentBefore={<SearchRegular />}
          />
        </div>
      </div>

      {msg && (
        <MessageBar intent={msg.ok ? 'success' : 'error'} style={{ marginBottom: '12px' }}>
          <MessageBarBody>
            <MessageBarTitle>{msg.ok ? '成功' : '失败'}</MessageBarTitle>
            {msg.text}
          </MessageBarBody>
        </MessageBar>
      )}

      {isLoading ? (
        <div style={{ color: tokens.colorNeutralForeground3, fontSize: '13px' }}>加载中...</div>
      ) : users.length === 0 ? (
        <div style={{ color: tokens.colorNeutralForeground3, fontSize: '13px', padding: '12px 0' }}>
          {keyword ? '没有匹配的用户' : '暂无用户'}
        </div>
      ) : (
        <div>
          {users.map((u) => (
            <div key={u.id} className={styles.userRow}>
              <Checkbox
                className={styles.userCheck}
                checked={selection.selected.has(u.id)}
                onChange={(_, d) => selection.toggle(u.id, d.checked === true)}
              />
              <Avatar
                size={36}
                name={u.nickname || u.username}
                image={u.avatar_path ? { src: assetUrl(u.avatar_path) } : undefined}
              />
              <div className={styles.userInfo}>
                <div className={styles.userName}>
                  {u.nickname || u.username}
                  <span style={{ fontWeight: 400, color: tokens.colorNeutralForeground3 }}>
                    (@{u.username})
                  </span>
                  {u.is_admin && <Badge size="small" color="brand">管理员</Badge>}
                  {!u.is_admin && <Badge size="small" appearance="outline">权限 {u.permission_level}</Badge>}
                  {u.id === currentUserId && <Badge size="small">当前用户</Badge>}
                </div>
                <div className={styles.userMeta}>
                  {u.email || '未设置邮箱'} · 注册于 {u.created_at.slice(0, 10)}
                </div>
              </div>
              <Button
                appearance="outline"
                size="small"
                icon={<EditRegular />}
                onClick={() => openEdit(u)}
              >
                编辑
              </Button>
            </div>
          ))}
          <Pagination page={page} totalPages={totalPages} total={totalUsers} onChange={setPage} />
        </div>
      )}

      {/* 批量操作栏 */}
      <BatchBar
        selectedCount={selection.size}
        allChecked={userIds.length > 0 && selection.size === userIds.length}
        total={userIds.length}
        onSelectAll={(c) => selection.selectAll(userIds, c)}
        onInvert={() => selection.invert(userIds)}
        onClear={selection.clear}
        busy={deleteMut.isPending}
      >
        <Button
          appearance="primary"
          size="small"
          icon={<DeleteRegular />}
          onClick={batchDelete}
          disabled={deleteMut.isPending}
        >
          批量删除
        </Button>
      </BatchBar>

      {/* 编辑用户对话框（公共组件，与作者页共用） */}
      <UserEditDialog
        target={editTarget}
        onClose={() => setEditTarget(null)}
        onChanged={() => setMsg({ ok: true, text: '用户信息已保存' })}
      />

      {/* 新建用户对话框 */}
      <Dialog open={createOpen} onOpenChange={(_, d) => setCreateOpen(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>新建用户</DialogTitle>
            <DialogContent>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <Label htmlFor="cu_username">用户名</Label>
                  <Input id="cu_username" value={createForm.username}
                    onChange={(_, d) => setCreateForm((f) => ({ ...f, username: d.value }))} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <Label htmlFor="cu_nickname">昵称</Label>
                  <Input id="cu_nickname" value={createForm.nickname}
                    onChange={(_, d) => setCreateForm((f) => ({ ...f, nickname: d.value }))}
                    placeholder="留空则使用用户名" />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <Label htmlFor="cu_email">邮箱（可选）</Label>
                  <Input id="cu_email" value={createForm.email}
                    onChange={(_, d) => setCreateForm((f) => ({ ...f, email: d.value }))} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <Label htmlFor="cu_pwd">密码</Label>
                  <Input id="cu_pwd" type="password" value={createForm.password}
                    onChange={(_, d) => setCreateForm((f) => ({ ...f, password: d.value }))}
                    placeholder="至少 6 位" />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <Label htmlFor="cu_level">权限值</Label>
                  <Dropdown id="cu_level"
                    value={levelText(createForm.permission_level)}
                    selectedOptions={[String(createForm.permission_level)]}
                    onOptionSelect={(_, d) => d.optionValue && setCreateForm((f) => ({ ...f, permission_level: Number(d.optionValue) }))}
                  >
                    {LEVEL_OPTIONS.map((n) => (
                      <Option key={n} value={String(n)} text={levelText(n)}>{levelText(n)}</Option>
                    ))}
                  </Dropdown>
                </div>
              </div>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setCreateOpen(false)}>取消</Button>
              <Button appearance="primary"
                disabled={createMut.isPending || !createForm.username.trim() || !createForm.password.trim() || createForm.password.length < 6}
                onClick={() => createMut.mutate({
                  username: createForm.username.trim(),
                  nickname: createForm.nickname.trim() || createForm.username.trim(),
                  email: createForm.email.trim(),
                  password: createForm.password,
                  permission_level: createForm.permission_level,
                })}
              >
                创建
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* 批量新建用户对话框 */}
      <Dialog open={batchCreateOpen} onOpenChange={(_, d) => setBatchCreateOpen(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>批量新建用户</DialogTitle>
            <DialogContent>
              <p style={{ marginTop: 0, fontSize: '13px', color: tokens.colorNeutralForeground2 }}>
                每行一个用户，格式：<code>用户名,密码</code> 或 <code>用户名,密码,昵称</code>。昵称留空则使用用户名。
              </p>
              <Textarea
                style={{ width: '100%', fontFamily: 'monospace' }}
                rows={8}
                resize="vertical"
                placeholder={'user1,123456\nuser2,abc789,小明\nuser3,xyz321'}
                value={batchText}
                onChange={(_, d) => setBatchText(d.value)}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '12px' }}>
                <Label>统一权限值</Label>
                <Dropdown
                  style={{ minWidth: '200px' }}
                  value={levelText(batchPerm)}
                  selectedOptions={[String(batchPerm)]}
                  onOptionSelect={(_, d) => d.optionValue && setBatchPerm(Number(d.optionValue))}
                >
                  {LEVEL_OPTIONS.map((n) => (
                    <Option key={n} value={String(n)} text={levelText(n)}>{levelText(n)}</Option>
                  ))}
                </Dropdown>
              </div>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setBatchCreateOpen(false)}>取消</Button>
              <Button appearance="primary"
                disabled={batchCreateMut.isPending || !batchText.trim()}
                onClick={handleBatchCreate}
              >
                {batchCreateMut.isPending ? '创建中...' : '批量创建'}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </Card>
  );
}

// --- 代理设置 ---

const PROXY_MODES = [
  { value: 'system', label: '系统代理', hint: '自动读取 Windows 系统代理 / 环境变量（默认）' },
  { value: 'none', label: '不使用代理', hint: '所有网络请求直连' },
  { value: 'custom', label: '自定义代理', hint: '手动指定代理服务器地址' },
];

function ProxyTab() {
  const styles = useStyles();
  const queryClient = useQueryClient();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });
  const { data: status } = useQuery({
    queryKey: ['proxy-status'],
    queryFn: settingsApi.getProxyStatus,
    refetchInterval: 10_000,
  });

  const [mode, setMode] = useState('system');
  const [customUrl, setCustomUrl] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (settings && !loaded) {
      setMode(settings.proxy_mode ?? 'system');
      setCustomUrl(settings.proxy_url ?? '');
      setLoaded(true);
    }
  }, [settings, loaded]);

  const saveMut = useMutation({
    mutationFn: (payload: Record<string, string>) => settingsApi.update(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['proxy-status'] });
      setMsg({ ok: true, text: '代理设置已保存并生效' });
    },
    onError: (e: Error) => setMsg({ ok: false, text: e.message || '保存失败' }),
  });

  const save = () => {
    if (mode === 'custom' && !customUrl.trim()) {
      setMsg({ ok: false, text: '自定义模式需要填写代理地址' });
      return;
    }
    saveMut.mutate({ proxy_mode: mode, proxy_url: customUrl.trim() });
  };

  return (
    <Card className={styles.card}>
      <div className={styles.title}>
        <CloudRegular /> 代理设置
      </div>
      <p style={{ marginTop: 0, fontSize: '13px', color: tokens.colorNeutralForeground2 }}>
        影响网页采集、封面/图集下载、编辑器粘贴图片本地化等应用内网络请求。保存后立即生效。
      </p>
      <div className={styles.field}>
        <Label>代理模式</Label>
        <RadioGroup
          value={mode}
          onChange={(_, d) => setMode(d.value)}
        >
          {PROXY_MODES.map((m) => (
            <Radio key={m.value} value={m.value} label={m.label} />
          ))}
        </RadioGroup>
        <span style={{ fontSize: '12px', color: tokens.colorNeutralForeground3 }}>
          {PROXY_MODES.find((m) => m.value === mode)?.hint}
        </span>
      </div>
      {mode === 'custom' && (
        <div className={styles.field}>
          <Label htmlFor="proxy_url">代理地址</Label>
          <Input
            id="proxy_url"
            value={customUrl}
            onChange={(_, d) => setCustomUrl(d.value)}
            placeholder="127.0.0.1:7890 或 http://host:port"
            style={{ maxWidth: '360px' }}
          />
        </div>
      )}
      {status && (
        <div className={styles.field}>
          <Label>当前生效</Label>
          <Badge appearance={status.effective === '直连（无代理）' ? 'outline' : 'tint'} color={status.effective === '直连（无代理）' ? undefined : 'brand'}>
            {status.effective}
          </Badge>
        </div>
      )}
      {msg && (
        <MessageBar intent={msg.ok ? 'success' : 'error'} style={{ marginBottom: '12px' }}>
          <MessageBarBody>
            <MessageBarTitle>{msg.ok ? '成功' : '失败'}</MessageBarTitle>
            {msg.text}
          </MessageBarBody>
        </MessageBar>
      )}
      <Button appearance="primary" onClick={save} disabled={saveMut.isPending}>
        保存代理设置
      </Button>
    </Card>
  );
}

// --- 权限管理 ---

const PERM_FIELDS: { key: string; label: string; hint?: string }[] = [
  { key: 'perm_article_own', label: '文章（自己）', hint: '新建、编辑、删除自己的文章' },
  { key: 'perm_article', label: '文章（管理他人）', hint: '编辑、删除、批量操作他人的文章' },
  { key: 'perm_collection_own', label: '合集（自己）', hint: '新建、编辑、删除自己的合集' },
  { key: 'perm_collection', label: '合集（管理他人）', hint: '管理他人创建的合集' },
  { key: 'perm_tag', label: '标签管理' },
  { key: 'perm_trash', label: '回收站管理' },
  { key: 'perm_user', label: '用户管理' },
];

function PermissionsTab() {
  const styles = useStyles();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  });

  useEffect(() => {
    if (settings) {
      const next: Record<string, number> = {};
      for (const f of PERM_FIELDS) {
        next[f.key] = Number(settings[f.key] ?? 5);
      }
      setForm(next);
    }
  }, [settings]);

  const saveMut = useMutation({
    mutationFn: (items: Record<string, string>) => settingsApi.update(items),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['public-settings'] });
      setMsg({ ok: true, text: '权限设置已保存' });
    },
    onError: (e: Error) => setMsg({ ok: false, text: e.message || '保存失败' }),
  });

  const save = () => {
    const items: Record<string, string> = {};
    for (const f of PERM_FIELDS) items[f.key] = String(form[f.key] ?? 5);
    saveMut.mutate(items);
  };

  return (
    <Card className={styles.card}>
      <div className={styles.title}>
        <ShieldRegular /> 权限管理
      </div>
      <p style={{ marginTop: 0, fontSize: '13px', color: tokens.colorNeutralForeground2 }}>
        设置各管理功能所需的最低权限值（0-5）。用户的权限值达到或超过该值即可使用；管理员始终拥有全部权限；默认 5（仅管理员）。
      </p>
      {PERM_FIELDS.map((f) => (
        <div key={f.key} className={styles.field}>
          <Label>{f.label}</Label>
          {f.hint && (
            <span style={{ fontSize: '12px', color: tokens.colorNeutralForeground3, display: 'block', marginBottom: '4px' }}>
              {f.hint}
            </span>
          )}
          <Dropdown
            value={levelText(form[f.key] ?? 5)}
            selectedOptions={[String(form[f.key] ?? 5)]}
            onOptionSelect={(_, d) =>
              d.optionValue && setForm((prev) => ({ ...prev, [f.key]: Number(d.optionValue) }))
            }
          >
            {LEVEL_OPTIONS.map((n) => (
              <Option key={n} value={String(n)} text={levelText(n)}>
                {levelText(n)}
              </Option>
            ))}
          </Dropdown>
        </div>
      ))}
      {msg && (
        <MessageBar intent={msg.ok ? 'success' : 'error'} style={{ marginBottom: '12px' }}>
          <MessageBarBody>
            <MessageBarTitle>{msg.ok ? '成功' : '失败'}</MessageBarTitle>
            {msg.text}
          </MessageBarBody>
        </MessageBar>
      )}
      <Button appearance="primary" onClick={save} disabled={saveMut.isPending}>
        保存权限设置
      </Button>
    </Card>
  );
}

// --- 附件清理 ---

const CATEGORY_LABELS: Record<OrphanFile['category'], string> = {
  thumbnail: '缩略图',
  gallery: '图集图片',
  content: '正文文件',
  file: '普通附件',
  torrent: '上传种子',
  magnet: '磁力种子',
  avatar: '头像',
  logo: '站点 LOGO',
  other: '其他',
};

function CleanupTab() {
  const styles = useStyles();
  const selection = useSelection();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [cat, setCat] = useState<'all' | OrphanFile['category']>('all');

  // 手动触发扫描（enabled: false，进页面不扫）
  const { data, isFetching, refetch } = useQuery({
    queryKey: ['orphan-files'],
    queryFn: cleanupApi.scan,
    enabled: false,
  });
  const files = data?.files ?? [];

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of files) m.set(f.category, (m.get(f.category) ?? 0) + 1);
    return m;
  }, [files]);

  const filtered = useMemo(
    () => (cat === 'all' ? files : files.filter((f) => f.category === cat)),
    [files, cat],
  );

  // 切换筛选时清空选择（选择基于当前列表的序号）
  const switchCat = (c: 'all' | OrphanFile['category']) => {
    setCat(c);
    selection.clear();
  };

  const deleteMut = useMutation({
    mutationFn: (paths: string[]) => cleanupApi.deleteFiles(paths),
    onSuccess: (res) => {
      selection.clear();
      // enabled:false 的查询 invalidate 不会自动重取，手动刷新
      refetch();
      setMsg({
        ok: res.failed.length === 0,
        text:
          res.failed.length === 0
            ? `已删除 ${res.deleted.length} 个文件`
            : `已删除 ${res.deleted.length} 个，${res.failed.length} 个失败（${res.failed
                .slice(0, 3)
                .map((f) => f.error)
                .join('、')}）`,
      });
    },
    onError: (e: Error) => setMsg({ ok: false, text: e.message || '删除失败' }),
  });

  const batchDelete = () => {
    const paths = filtered
      .filter((_, i) => selection.selected.has(i))
      .map((f) => f.path);
    if (paths.length === 0) return;
    if (
      !confirm(
        `确认删除选中的 ${paths.length} 个文件？\n此操作不可恢复，若文章仍在引用这些文件，对应图片/附件将无法显示或打开。`,
      )
    ) {
      return;
    }
    deleteMut.mutate(paths);
  };

  const allChecked = filtered.length > 0 && filtered.every((_, i) => selection.selected.has(i));
  const busy = isFetching || deleteMut.isPending;

  return (
    <div className={styles.cleanupContainer}>
      <Card className={styles.card}>
        <div className={styles.title}>
          <ScanObjectRegular /> 附件清理
        </div>
        <MessageBar intent="info" style={{ marginBottom: '12px' }}>
          <MessageBarBody>
            扫描存储目录中数据库已无任何引用的文件：永久删除文章后的残留（缩略图、图集、种子等），
            以及上传到正文但后来不再引用的图片/附件。<b>回收站中的文章文件不会被列为垃圾</b>。
            勾选后删除，未勾选即保留。
          </MessageBarBody>
        </MessageBar>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Button
            appearance="primary"
            icon={<ScanObjectRegular />}
            onClick={() => {
              setMsg(null);
              selection.clear();
              refetch();
            }}
            disabled={busy}
          >
            {data ? '重新扫描' : '开始扫描'}
          </Button>
          {isFetching && <Spinner size="tiny" label="扫描中（多线程遍历存储目录）..." />}
          {data && !isFetching && (
            <span style={{ fontSize: '13px', color: tokens.colorNeutralForeground3 }}>
              发现 {files.length} 个未引用文件，共 {formatBytes(data.total_size)}
            </span>
          )}
        </div>

        {msg && (
          <MessageBar intent={msg.ok ? 'success' : 'error'} style={{ marginTop: '12px' }}>
            <MessageBarBody>
              <MessageBarTitle>{msg.ok ? '完成' : '失败'}</MessageBarTitle>
              {msg.text}
            </MessageBarBody>
          </MessageBar>
        )}
      </Card>

      {data && !isFetching && files.length === 0 && (
        <Card className={styles.card}>
          <MessageBar intent="success">
            <MessageBarBody>未发现未引用文件，存储目录很干净。</MessageBarBody>
          </MessageBar>
        </Card>
      )}

      {filtered.length > 0 && (
        <Card className={styles.card}>
          <div className={styles.filterBar}>
            <Button
              size="small"
              appearance={cat === 'all' ? 'primary' : 'outline'}
              onClick={() => switchCat('all')}
            >
              全部（{files.length}）
            </Button>
            {Array.from(counts.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([c, n]) => (
                <Button
                  key={c}
                  size="small"
                  appearance={cat === c ? 'primary' : 'outline'}
                  onClick={() => switchCat(c as OrphanFile['category'])}
                >
                  {CATEGORY_LABELS[c as OrphanFile['category']]}（{n}）
                </Button>
              ))}
          </div>

          <div style={{ marginTop: '8px' }}>
            {filtered.map((f, i) => (
              <div key={f.path} className={styles.orphanRow}>
                <Checkbox
                  className={styles.orphanCheck}
                  checked={selection.selected.has(i)}
                  onChange={(_, d) => selection.toggle(i, d.checked === true)}
                />
                {f.is_image ? (
                  <img className={styles.orphanThumb} src={assetUrl(f.path)} alt="" loading="lazy" />
                ) : (
                  <div className={styles.orphanIcon}>
                    {f.category === 'thumbnail' || f.category === 'gallery' ? (
                      <ImageRegular />
                    ) : (
                      <DocumentRegular />
                    )}
                  </div>
                )}
                <div className={styles.userInfo}>
                  <div className={styles.userName}>
                    {f.name}
                    <Badge size="small" appearance="outline">
                      {CATEGORY_LABELS[f.category]}
                    </Badge>
                    <span style={{ fontWeight: 400, fontSize: '12px' }}>{formatBytes(f.size)}</span>
                  </div>
                  <div className={styles.userMeta}>
                    {f.path} · {new Date(f.modified * 1000).toLocaleString()}
                  </div>
                </div>
                <Button
                  appearance="subtle"
                  size="small"
                  icon={<FolderOpenRegular />}
                  title="在资源管理器中定位"
                  onClick={() => torrentApi.revealFile(f.path).catch(() => undefined)}
                />
              </div>
            ))}
          </div>
        </Card>
      )}

      <BatchBar
        selectedCount={selection.size}
        allChecked={allChecked}
        total={filtered.length}
        onSelectAll={(c) => selection.selectAll(filtered.map((_, i) => i), c)}
        onInvert={() => selection.invert(filtered.map((_, i) => i))}
        onClear={selection.clear}
        busy={busy}
      >
        <Button
          appearance="primary"
          size="small"
          icon={<DeleteRegular />}
          onClick={batchDelete}
          disabled={deleteMut.isPending}
        >
          删除选中
        </Button>
      </BatchBar>
    </div>
  );
}
