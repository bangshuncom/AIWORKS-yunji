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
import { LEVEL_OPTIONS, levelTextKey } from '../lib/levels';
import type { AdminUser } from '../types/models';
import { useLanguage } from '../i18n';

export interface UserEditDialogProps {
  /** 编辑目标（null 关闭） */
  target: AdminUser | null;
  onClose: () => void;
  /** {t('common.save')}/头像更新成功后的额外回调（如刷新列表） */
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
  const { t } = useLanguage();
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
      filters: [{ name: t('edit.filterImage'), extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
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
      <Dialog
        open
        onOpenChange={(_, d) => {
          if (!d.open) onClose();
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t('userEdit.title', { name: target.nickname || target.username })}</DialogTitle>
            <DialogContent>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
                <Label>{t('userEdit.avatar')}</Label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Avatar
                    size={56}
                    name={form.nickname || form.username}
                    image={avatar ? { src: assetUrl(avatar) } : undefined}
                  />
                  <Button appearance="outline" size="small" icon={<ImageRegular />} onClick={pickAvatar}>
                    {t('profile.changeAvatar')}
                  </Button>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
                <Label htmlFor="eu_username">{t('auth.username')}</Label>
                <Input
                  id="eu_username"
                  value={form.username}
                  onChange={(_, d) => setForm((f) => (f ? { ...f, username: d.value } : f))}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
                <Label htmlFor="eu_nickname">{t('profile.nickname')}</Label>
                <Input
                  id="eu_nickname"
                  value={form.nickname}
                  onChange={(_, d) => setForm((f) => (f ? { ...f, nickname: d.value } : f))}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
                <Label htmlFor="eu_email">{t('profile.email')}</Label>
                <Input
                  id="eu_email"
                  value={form.email}
                  onChange={(_, d) => setForm((f) => (f ? { ...f, email: d.value } : f))}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
                <Label htmlFor="eu_bio">{t('profile.bio')}</Label>
                <Textarea
                  id="eu_bio"
                  value={form.bio}
                  onChange={(_, d) => setForm((f) => (f ? { ...f, bio: d.value } : f))}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
                <Label htmlFor="eu_level">{t('userEdit.permissionLevel')}</Label>
                <Dropdown
                  id="eu_level"
                  value={
                    target.is_admin
                      ? t('userEdit.adminFixed')
                      : t(levelTextKey(form.permission_level), { n: form.permission_level })
                  }
                  selectedOptions={[String(form.permission_level)]}
                  disabled={target.is_admin}
                  onOptionSelect={(_, d) =>
                    d.optionValue && setForm((f) => (f ? { ...f, permission_level: Number(d.optionValue) } : f))
                  }
                >
                  {LEVEL_OPTIONS.map((n) => (
                    <Option key={n} value={String(n)} text={t(levelTextKey(n), { n })}>
                      {t(levelTextKey(n), { n })}
                    </Option>
                  ))}
                </Dropdown>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <Label htmlFor="eu_pwd">{t('userEdit.newPwd')}</Label>
                <Input
                  id="eu_pwd"
                  type="password"
                  placeholder={t('register.passwordPlaceholder')}
                  value={form.new_password}
                  onChange={(_, d) => setForm((f) => (f ? { ...f, new_password: d.value } : f))}
                />
              </div>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={onClose}>
                {t('common.cancel')}
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
                {t('common.save')}
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
