// 个人资料页：昵称/头像/简介/账户名/密码
import { useEffect, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import {
  Avatar,
  Card,
  Input,
  Button,
  Label,
  Textarea,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Spinner,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { PersonRegular, KeyRegular, CameraRegular } from '@fluentui/react-icons';
import { useAuthStore } from '../stores/authStore';
import { authApi, assetUrl } from '../lib/tauri';
import { AvatarCropDialog } from '../components/AvatarCropDialog';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    maxWidth: '720px',
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
  avatarRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    marginBottom: '12px',
  },
  bioTextarea: {
    minHeight: '80px',
  },
});

export function ProfilePage() {
  const styles = useStyles();
  const { user, setUser } = useAuthStore();

  // 资料表单
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [bio, setBio] = useState('');
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 头像裁剪弹窗选中的本地文件
  const [cropFile, setCropFile] = useState<string | null>(null);

  // 修改账户名
  const [newUsername, setNewUsername] = useState('');
  const [usernamePwd, setUsernamePwd] = useState('');
  const [usernameMsg, setUsernameMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // 修改密码
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdMsg, setPwdMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (user) {
      setNickname(user.nickname);
      setEmail(user.email);
      setBio(user.bio);
      setNewUsername(user.username);
    }
  }, [user]);

  if (!user) return <Spinner label="加载中..." />;

  const saveProfile = async () => {
    setProfileMsg(null);
    try {
      const updated = await authApi.updateProfile(nickname.trim(), email.trim(), bio);
      setUser(updated);
      setProfileMsg({ ok: true, text: '资料已保存' });
    } catch (e: any) {
      setProfileMsg({ ok: false, text: e.message || '保存失败' });
    }
  };

  const handleSelectAvatar = async () => {
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
    });
    const filePath = typeof selected === 'string' ? selected : null;
    if (filePath) setCropFile(filePath);
  };

  const saveUsername = async () => {
    setUsernameMsg(null);
    if (newUsername.trim() === user.username) {
      setUsernameMsg({ ok: true, text: '用户名未变化' });
      return;
    }
    try {
      const updated = await authApi.changeUsername(newUsername.trim(), usernamePwd);
      setUser(updated);
      setUsernameMsg({ ok: true, text: '账户名已更新' });
      setUsernamePwd('');
    } catch (e: any) {
      setUsernameMsg({ ok: false, text: e.message || '修改失败' });
    }
  };

  const savePassword = async () => {
    setPwdMsg(null);
    if (newPwd !== confirmPwd) {
      setPwdMsg({ ok: false, text: '两次输入的新密码不一致' });
      return;
    }
    try {
      await authApi.changePassword(oldPwd, newPwd);
      setPwdMsg({ ok: true, text: '密码已更新' });
      setOldPwd('');
      setNewPwd('');
      setConfirmPwd('');
    } catch (e: any) {
      setPwdMsg({ ok: false, text: e.message || '修改失败' });
    }
  };

  const avatarSrc = user.avatar_path ? assetUrl(user.avatar_path) : undefined;

  return (
    <div className={styles.container}>
      <h2 style={{ margin: 0 }}>个人资料</h2>

      {/* 基本信息 */}
      <Card className={styles.card}>
        <div className={styles.title}>
          <PersonRegular /> 基本信息
        </div>
        <div className={styles.avatarRow}>
          <Avatar size={72} name={user.nickname || user.username} image={avatarSrc ? { src: avatarSrc } : undefined} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <Button appearance="outline" icon={<CameraRegular />} onClick={handleSelectAvatar}>
              更换头像
            </Button>
            <span style={{ fontSize: '12px', color: tokens.colorNeutralForeground3 }}>
              支持 jpg / png / webp / gif，可选后裁剪
            </span>
          </div>
        </div>
        <div className={styles.field}>
          <Label htmlFor="p_nickname">昵称</Label>
          <Input id="p_nickname" value={nickname} onChange={(_, d) => setNickname(d.value)} />
        </div>
        <div className={styles.field}>
          <Label htmlFor="p_email">邮箱</Label>
          <Input id="p_email" type="email" value={email} onChange={(_, d) => setEmail(d.value)} />
        </div>
        <div className={styles.field}>
          <Label htmlFor="p_bio">简介</Label>
          <Textarea
            id="p_bio"
            className={styles.bioTextarea}
            value={bio}
            onChange={(_, d) => setBio(d.value)}
            placeholder="介绍一下自己（最多 500 字）"
          />
        </div>
        {profileMsg && (
          <MessageBar intent={profileMsg.ok ? 'success' : 'error'} style={{ marginBottom: '12px' }}>
            <MessageBarBody>
              <MessageBarTitle>{profileMsg.ok ? '成功' : '失败'}</MessageBarTitle>
              {profileMsg.text}
            </MessageBarBody>
          </MessageBar>
        )}
        <Button appearance="primary" onClick={saveProfile}>
          保存资料
        </Button>
      </Card>

      {/* 修改账户名 */}
      <Card className={styles.card}>
        <div className={styles.title}>
          <PersonRegular /> 修改账户名
        </div>
        <div className={styles.field}>
          <Label htmlFor="p_username">新用户名</Label>
          <Input id="p_username" value={newUsername} onChange={(_, d) => setNewUsername(d.value)} />
        </div>
        <div className={styles.field}>
          <Label htmlFor="p_username_pwd">当前密码（用于确认）</Label>
          <Input id="p_username_pwd" type="password" value={usernamePwd} onChange={(_, d) => setUsernamePwd(d.value)} />
        </div>
        {usernameMsg && (
          <MessageBar intent={usernameMsg.ok ? 'success' : 'error'} style={{ marginBottom: '12px' }}>
            <MessageBarBody>
              <MessageBarTitle>{usernameMsg.ok ? '成功' : '失败'}</MessageBarTitle>
              {usernameMsg.text}
            </MessageBarBody>
          </MessageBar>
        )}
        <Button appearance="primary" onClick={saveUsername} disabled={!newUsername.trim() || !usernamePwd}>
          修改账户名
        </Button>
      </Card>

      {/* 修改密码 */}
      <Card className={styles.card}>
        <div className={styles.title}>
          <KeyRegular /> 修改密码
        </div>
        <div className={styles.field}>
          <Label htmlFor="p_old_pwd">旧密码</Label>
          <Input id="p_old_pwd" type="password" value={oldPwd} onChange={(_, d) => setOldPwd(d.value)} />
        </div>
        <div className={styles.field}>
          <Label htmlFor="p_new_pwd">新密码（至少 6 位）</Label>
          <Input id="p_new_pwd" type="password" value={newPwd} onChange={(_, d) => setNewPwd(d.value)} />
        </div>
        <div className={styles.field}>
          <Label htmlFor="p_confirm_pwd">确认新密码</Label>
          <Input id="p_confirm_pwd" type="password" value={confirmPwd} onChange={(_, d) => setConfirmPwd(d.value)} />
        </div>
        {pwdMsg && (
          <MessageBar intent={pwdMsg.ok ? 'success' : 'error'} style={{ marginBottom: '12px' }}>
            <MessageBarBody>
              <MessageBarTitle>{pwdMsg.ok ? '成功' : '失败'}</MessageBarTitle>
              {pwdMsg.text}
            </MessageBarBody>
          </MessageBar>
        )}
        <Button appearance="primary" onClick={savePassword} disabled={!oldPwd || !newPwd || !confirmPwd}>
          修改密码
        </Button>
      </Card>

      {/* 头像裁剪弹窗 */}
      {cropFile && <AvatarCropDialog filePath={cropFile} onClose={() => setCropFile(null)} />}
    </div>
  );
}
