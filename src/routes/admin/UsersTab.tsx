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
import { LEVEL_OPTIONS, levelText } from '../../lib/levels';
import { useAuthStore } from '../../stores/authStore';
import { useSelection, BatchBar } from '../../components/Selection';
import { UserEditDialog } from '../../components/UserEditDialog';
import { Pagination } from '../../components/Pagination';
import type { AdminUser } from '../../types/models';
import { useStyles } from './styles';

const PAGE_SIZE = 36;

export function UsersTab() {
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
    if (
      !(await confirmDanger(
        `确认删除选中的 ${ids.length} 个用户？此操作不可恢复！（自己和权限不足的账户会被自动跳过）`,
      ))
    )
      return;
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
          if (
            !(await confirmDanger(
              `选中的用户中包含 ${highTargets.length} 个权限 5 的账户，确认一并删除？此操作不可恢复！`,
            ))
          )
            return;
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
      setMsg({ ok: false, text: '每行格式：用户名,密码[,昵称]' });
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
          <PersonRegular /> 用户管理
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
            新建用户
          </Button>
          <Button appearance="outline" size="small" icon={<AddRegular />} onClick={() => setBatchCreateOpen(true)}>
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
        <MessageBar intent={msg.ok ? 'success' : 'error'} className={styles.feedback}>
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
                  <span style={{ fontWeight: 400, color: tokens.colorNeutralForeground3 }}>(@{u.username})</span>
                  {u.is_admin && (
                    <Badge size="small" color="brand">
                      管理员
                    </Badge>
                  )}
                  {!u.is_admin && (
                    <Badge size="small" appearance="outline">
                      权限 {u.permission_level}
                    </Badge>
                  )}
                  {u.id === currentUserId && <Badge size="small">当前用户</Badge>}
                </div>
                <div className={styles.userMeta}>
                  {u.email || '未设置邮箱'} · 注册于 {u.created_at.slice(0, 10)}
                </div>
              </div>
              <Button appearance="outline" size="small" icon={<EditRegular />} onClick={() => openEdit(u)}>
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
                  <Input
                    id="cu_username"
                    value={createForm.username}
                    onChange={(_, d) => setCreateForm((f) => ({ ...f, username: d.value }))}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <Label htmlFor="cu_nickname">昵称</Label>
                  <Input
                    id="cu_nickname"
                    value={createForm.nickname}
                    onChange={(_, d) => setCreateForm((f) => ({ ...f, nickname: d.value }))}
                    placeholder="留空则使用用户名"
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <Label htmlFor="cu_email">邮箱（可选）</Label>
                  <Input
                    id="cu_email"
                    value={createForm.email}
                    onChange={(_, d) => setCreateForm((f) => ({ ...f, email: d.value }))}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <Label htmlFor="cu_pwd">密码</Label>
                  <Input
                    id="cu_pwd"
                    type="password"
                    value={createForm.password}
                    onChange={(_, d) => setCreateForm((f) => ({ ...f, password: d.value }))}
                    placeholder="至少 6 位"
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <Label htmlFor="cu_level">权限值</Label>
                  <Dropdown
                    id="cu_level"
                    value={levelText(createForm.permission_level)}
                    selectedOptions={[String(createForm.permission_level)]}
                    onOptionSelect={(_, d) =>
                      d.optionValue && setCreateForm((f) => ({ ...f, permission_level: Number(d.optionValue) }))
                    }
                  >
                    {LEVEL_OPTIONS.map((n) => (
                      <Option key={n} value={String(n)} text={levelText(n)}>
                        {levelText(n)}
                      </Option>
                    ))}
                  </Dropdown>
                </div>
              </div>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setCreateOpen(false)}>
                取消
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
                    <Option key={n} value={String(n)} text={levelText(n)}>
                      {levelText(n)}
                    </Option>
                  ))}
                </Dropdown>
              </div>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setBatchCreateOpen(false)}>
                取消
              </Button>
              <Button
                appearance="primary"
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
