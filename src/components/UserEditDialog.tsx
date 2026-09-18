// 用户编辑对话框（公共组件）：管理页-用户管理 与 作者列表页 复用
// 含头像更换（裁剪上传）、用户名/昵称/邮箱/简介/权限值/新密码
import { useState } from 'react';
import {
  Avatar,
  Button,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Input,
  Label,
  Textarea,
  Dropdown,
  Option,
} from '@fluentui/react-components';
import { ImageRegular } from '@fluentui/react-icons';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { userApi, authApi, assetUrl } from '../lib/tauri';
import { useAuthStore } from '../stores/authStore';
import { AvatarCropDialog } from './AvatarCropDialog';
import { LEVEL_OPTIONS, levelText } from '../routes/AdminPage';
import type { AdminUser } from '../types/models';

export interface UserEditDialogProps {
  /** 编辑目标（null 关闭） */
  target: AdminUser | null;
  onClose: () => void;
  /** 保存/头像更新成功后的额外回调（如刷新列表） */
  onChanged?: () => void;
}

interface EditForm {
  username: string;
  nickname: string;
  email: string;
  bio: string;
  permission_level: number;
  new_password: string;
}

export function UserEditDialog({ target, onClose, onChanged }: UserEditDialogProps) {
  const queryClient = useQueryClient();
  const currentUserId = useAuthStore((s) => s.user?.id);
  const refreshMe = useAuthStore((s) => s.setUser);
  const [form, setForm] = useState<EditForm | null>(null);
  const [formTargetId, setFormTargetId] = useState<number | null>(null);
  const [avatar, setAvatar] = useState('');
  const [cropFile, setCropFile] = useState<string | null>(null);

  // 切换目标时初始化表单（AvatarCropDialog 回调里也会更新 target，仅 id 不变时保留表单）
  if (target && formTargetId !== target.id) {
    setFormTargetId(target.id);
    setForm({
      username: target.username,
      nickname: target.nickname,
      email: target.email,
      bio: target.bio,
      permission_level: target.is_admin ? 5 : target.permission_level,
      new_password: '',
    });
    setAvatar(target.avatar_path);
  }
  if (!target && formTargetId !== null) {
    setFormTargetId(null);
    setForm(null);
    setAvatar('');
  }

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['users'] });
    queryClient.invalidateQueries({ queryKey: ['authors'] });
  };

  const updateMut = useMutation({
    mutationFn: userApi.update,
    onSuccess: async () => {
      invalidate();
      onChanged?.();
      onClose();
      // 编辑的是自己：刷新登录态，导航栏昵称立即生效
      if (target && target.id === currentUserId) {
        const fresh = await authApi.me();
        if (fresh) refreshMe(fresh);
      }
    },
  });

  const pickAvatar = async () => {
    if (!target) return;
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
    });
    if (typeof selected === 'string') setCropFile(selected);
  };

  const save = () => {
    if (!target || !form) return;
    updateMut.mutate({
      user_id: target.id,
      username: form.username.trim(),
      nickname: form.nickname.trim(),
      email: form.email.trim(),
      bio: form.bio,
      permission_level: form.permission_level,
      new_password: form.new_password.trim() || null,
    });
  };

  if (!target || !form) return null;

  return (
    <>
      <Dialog open onOpenChange={(_, d) => { if (!d.open) onClose(); }}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              编辑用户（{target.nickname || target.username}）
            </DialogTitle>
            <DialogContent>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
                <Label>头像</Label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Avatar
                    size={56}
                    name={form.nickname || form.username}
                    image={avatar ? { src: assetUrl(avatar) } : undefined}
                  />
                  <Button
                    appearance="outline"
                    size="small"
                    icon={<ImageRegular />}
                    onClick={pickAvatar}
                  >
                    更换头像
                  </Button>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
                <Label htmlFor="eu_username">用户名</Label>
                <Input
                  id="eu_username"
                  value={form.username}
                  onChange={(_, d) => setForm((f) => (f ? { ...f, username: d.value } : f))}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
                <Label htmlFor="eu_nickname">昵称</Label>
                <Input
                  id="eu_nickname"
                  value={form.nickname}
                  onChange={(_, d) => setForm((f) => (f ? { ...f, nickname: d.value } : f))}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
                <Label htmlFor="eu_email">邮箱</Label>
                <Input
                  id="eu_email"
                  value={form.email}
                  onChange={(_, d) => setForm((f) => (f ? { ...f, email: d.value } : f))}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
                <Label htmlFor="eu_bio">简介</Label>
                <Textarea
                  id="eu_bio"
                  value={form.bio}
                  onChange={(_, d) => setForm((f) => (f ? { ...f, bio: d.value } : f))}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
                <Label htmlFor="eu_level">权限值</Label>
                <Dropdown
                  id="eu_level"
                  value={target.is_admin ? '5 - 仅管理员（管理员固定 5）' : levelText(form.permission_level)}
                  selectedOptions={[String(form.permission_level)]}
                  disabled={target.is_admin}
                  onOptionSelect={(_, d) =>
                    d.optionValue && setForm((f) => (f ? { ...f, permission_level: Number(d.optionValue) } : f))
                  }
                >
                  {LEVEL_OPTIONS.map((n) => (
                    <Option key={n} value={String(n)} text={levelText(n)}>
                      {levelText(n)}
                    </Option>
                  ))}
                </Dropdown>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <Label htmlFor="eu_pwd">新密码（留空则不修改）</Label>
                <Input
                  id="eu_pwd"
                  type="password"
                  placeholder="至少 6 位"
                  value={form.new_password}
                  onChange={(_, d) => setForm((f) => (f ? { ...f, new_password: d.value } : f))}
                />
              </div>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={onClose}>
                取消
              </Button>
              <Button
                appearance="primary"
                disabled={
                  updateMut.isPending ||
                  !form.username.trim() ||
                  !form.nickname.trim() ||
                  (form.new_password.length > 0 && form.new_password.length < 6)
                }
                onClick={save}
              >
                保存
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* 裁剪并设置目标用户头像 */}
      {cropFile && target && (
        <AvatarCropDialog
          filePath={cropFile}
          targetUserId={target.id}
          onClose={() => setCropFile(null)}
          onUploaded={async (path) => {
            invalidate();
            onChanged?.();
            setAvatar(path);
            // 改的是自己：刷新登录态，导航栏头像立即生效
            if (target.id === currentUserId) {
              const fresh = await authApi.me();
              if (fresh) refreshMe(fresh);
            }
          }}
        />
      )}
    </>
  );
}
