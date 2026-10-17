// 用户管理：分页列表 + 新建 / 批量新建 / 编辑 / 批量删除
import { useEffect, useState } from 'react';
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
  Textarea,
  tokens,
} from '@fluentui/react-components';
import { PersonRegular, AddRegular, DeleteRegular, EditRegular, SearchRegular } from '@fluentui/react-icons';
import { userApi, assetUrl } from '../../lib/tauri';
import { confirmDanger } from '../../lib/dialog';
import { LEVEL_OPTIONS, levelTextKey } from '../../lib/levels';
import { useAuthStore } from '../../stores/authStore';
import { useSelection, BatchBar } from '../../components/Selection';
import { UserEditDialog } from '../../components/UserEditDialog';
import { Pagination } from '../../components/Pagination';
import type { AdminUser } from '../../types/models';
import { useStyles } from './styles';
import { useLanguage } from '../../i18n';

const PAGE_SIZE = 36;

export function UsersTab() {
  const styles = useStyles();
  const { t } = useLanguage();
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
  const [createForm, setCreateForm] = useState({
    username: '',
    nickname: '',
    email: '',
    password: '',
    permission_level: 0,
  });

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
      const parts = [t('users.deleted', { n: res.deleted })];
      if (res.skipped > 0) parts.push(t('users.skipped', { n: res.skipped }));
      setMsg({ ok: true, text: parts.join('，') });
    },
    onError: (e: Error) => setMsg({ ok: false, text: e.message || t('users.deleteFailed') }),
  });

  const userIds = users.map((u) => u.id);

  const batchDelete = async () => {
    const ids = Array.from(selection.selected);
    if (ids.length === 0) return;
    // 第一层确认（任何情况下先弹，不依赖任何异步请求）
    if (!(await confirmDanger(t('users.confirmDelete', { n: ids.length })))) return;
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
          if (!(await confirmDanger(t('users.confirmDeleteHigh', { n: highTargets.length })))) return;
        }
      }
      deleteMut.mutate(ids, { onSettled: () => selection.clear() });
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || t('users.deleteFailed') });
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
      setMsg({ ok: true, text: t('users.created') });
    },
    onError: (e: Error) => setMsg({ ok: false, text: e.message || t('users.createFailed') }),
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
      setMsg({ ok: true, text: t('users.batchDone') });
    },
    onError: (e: Error) => setMsg({ ok: false, text: e.message || t('users.batchFailed') }),
  });

  const handleBatchCreate = () => {
    const lines = batchText
      .trim()
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [username, password, nickname] = l.split(',').map((s) => s.trim());
        return { username: username || '', password: password || '', nickname: nickname || username || '' };
      })
      .filter((l) => l.username && l.password);
    if (lines.length === 0) {
      setMsg({ ok: false, text: t('users.lineFormat') });
      return;
    }
    batchCreateMut.mutate(lines);
  };

  return (
    <Card className={styles.card}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <div className={styles.title}>
          <PersonRegular /> {t('settings.tab.users')}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Button
            appearance="primary"
            size="small"
            icon={<AddRegular />}
            onClick={() => {
              setCreateForm({ username: '', nickname: '', email: '', password: '', permission_level: 0 });
              setCreateOpen(true);
            }}
          >
            {t('users.new')}
          </Button>
          <Button appearance="outline" size="small" icon={<AddRegular />} onClick={() => setBatchCreateOpen(true)}>
            {t('users.batchNew')}
          </Button>
          <Input
            style={{ width: '200px' }}
            placeholder={t('users.searchPlaceholder')}
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
        <MessageBar intent={msg.ok ? 'success' : 'error'} className={styles.feedback}>
          <MessageBarBody>
            <MessageBarTitle>{msg.ok ? t('common.success') : t('common.fail')}</MessageBarTitle>
            {msg.text}
          </MessageBarBody>
        </MessageBar>
      )}

      {isLoading ? (
        <div style={{ color: tokens.colorNeutralForeground3, fontSize: '13px' }}>{t('common.loading')}</div>
      ) : users.length === 0 ? (
        <div style={{ color: tokens.colorNeutralForeground3, fontSize: '13px', padding: '12px 0' }}>
          {keyword ? t('users.noMatch') : t('users.empty')}
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
                  <span style={{ fontWeight: 400, color: tokens.colorNeutralForeground3 }}>(@{u.username})</span>
                  {u.is_admin && (
                    <Badge size="small" color="brand">
                      {t('users.admin')}
                    </Badge>
                  )}
                  {!u.is_admin && (
                    <Badge size="small" appearance="outline">
                      {t('users.level', { n: u.permission_level })}
                    </Badge>
                  )}
                  {u.id === currentUserId && <Badge size="small">{t('users.current')}</Badge>}
                </div>
                <div className={styles.userMeta}>
                  {u.email || t('users.noEmail')} · {t('users.registeredAt', { date: u.created_at.slice(0, 10) })}
                </div>
              </div>
              <Button appearance="outline" size="small" icon={<EditRegular />} onClick={() => openEdit(u)}>
                {t('common.edit')}
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
          {t('users.batchDelete')}
        </Button>
      </BatchBar>

      {/* 编辑用户对话框（公共组件，与作者页共用） */}
      <UserEditDialog
        target={editTarget}
        onClose={() => setEditTarget(null)}
        onChanged={() => setMsg({ ok: true, text: t('users.saved') })}
      />

      {/* 新建用户对话框 */}
      <Dialog open={createOpen} onOpenChange={(_, d) => setCreateOpen(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t('users.new')}</DialogTitle>
            <DialogContent>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <Label htmlFor="cu_username">{t('users.username')}</Label>
                  <Input
                    id="cu_username"
                    value={createForm.username}
                    onChange={(_, d) => setCreateForm((f) => ({ ...f, username: d.value }))}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <Label htmlFor="cu_nickname">{t('users.nickname')}</Label>
                  <Input
                    id="cu_nickname"
                    value={createForm.nickname}
                    onChange={(_, d) => setCreateForm((f) => ({ ...f, nickname: d.value }))}
                    placeholder={t('users.nicknamePlaceholder')}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <Label htmlFor="cu_email">{t('users.email')}</Label>
                  <Input
                    id="cu_email"
                    value={createForm.email}
                    onChange={(_, d) => setCreateForm((f) => ({ ...f, email: d.value }))}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <Label htmlFor="cu_pwd">{t('users.password')}</Label>
                  <Input
                    id="cu_pwd"
                    type="password"
                    value={createForm.password}
                    onChange={(_, d) => setCreateForm((f) => ({ ...f, password: d.value }))}
                    placeholder={t('users.pwdPlaceholder')}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <Label htmlFor="cu_level">{t('users.levelLabel')}</Label>
                  <Dropdown
                    id="cu_level"
                    value={t(levelTextKey(createForm.permission_level), { n: createForm.permission_level })}
                    selectedOptions={[String(createForm.permission_level)]}
                    onOptionSelect={(_, d) =>
                      d.optionValue && setCreateForm((f) => ({ ...f, permission_level: Number(d.optionValue) }))
                    }
                  >
                    {LEVEL_OPTIONS.map((n) => (
                      <Option key={n} value={String(n)} text={t(levelTextKey(n), { n })}>
                        {t(levelTextKey(n), { n })}
                      </Option>
                    ))}
                  </Dropdown>
                </div>
              </div>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setCreateOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                appearance="primary"
                disabled={
                  createMut.isPending ||
                  !createForm.username.trim() ||
                  !createForm.password.trim() ||
                  createForm.password.length < 6
                }
                onClick={() =>
                  createMut.mutate({
                    username: createForm.username.trim(),
                    nickname: createForm.nickname.trim() || createForm.username.trim(),
                    email: createForm.email.trim(),
                    password: createForm.password,
                    permission_level: createForm.permission_level,
                  })
                }
              >
                {t('users.create')}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* 批量新建用户对话框 */}
      <Dialog open={batchCreateOpen} onOpenChange={(_, d) => setBatchCreateOpen(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t('users.batchNewTitle')}</DialogTitle>
            <DialogContent>
              <p style={{ marginTop: 0, fontSize: '13px', color: tokens.colorNeutralForeground2 }}>
                {t('users.batchDescPrefix')}
                <code>
                  {t('users.username')},{t('users.password')}
                </code>
                {t('users.batchDescMid')}
                <code>
                  {t('users.username')},{t('users.password')},{t('users.nickname')}
                </code>
                {t('users.batchDescSuffix')}
              </p>
              <Textarea
                style={{ width: '100%', fontFamily: 'monospace' }}
                rows={8}
                resize="vertical"
                placeholder={t('users.batchPlaceholder')}
                value={batchText}
                onChange={(_, d) => setBatchText(d.value)}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '12px' }}>
                <Label>{t('users.batchLevel')}</Label>
                <Dropdown
                  style={{ minWidth: '200px' }}
                  value={t(levelTextKey(batchPerm), { n: batchPerm })}
                  selectedOptions={[String(batchPerm)]}
                  onOptionSelect={(_, d) => d.optionValue && setBatchPerm(Number(d.optionValue))}
                >
                  {LEVEL_OPTIONS.map((n) => (
                    <Option key={n} value={String(n)} text={t(levelTextKey(n), { n })}>
                      {t(levelTextKey(n), { n })}
                    </Option>
                  ))}
                </Dropdown>
              </div>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setBatchCreateOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                appearance="primary"
                disabled={batchCreateMut.isPending || !batchText.trim()}
                onClick={handleBatchCreate}
              >
                {batchCreateMut.isPending ? t('users.creating') : t('users.batchCreate')}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </Card>
  );
}
