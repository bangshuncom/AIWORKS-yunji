// 常规设置：站点信息 + LOGO + 窗口行为 + 链接打开方式 + 存储后端
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Input, Label, Radio, RadioGroup, Spinner, Switch, tokens } from '@fluentui/react-components';
import {
  SettingsRegular,
  CloudRegular,
  ImageRegular,
  DeleteRegular,
  DesktopRegular,
  GlobeRegular,
  FolderOpenRegular,
} from '@fluentui/react-icons';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { settingsApi, assetUrl } from '../../lib/tauri';
import { useStyles } from './styles';

export function GeneralTab() {
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
      // 单选框跳回旧模式、预览区消失（表现为上传/预览"不能用"）
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
          <Input id="site_name" value={form.site_name ?? ''} onChange={(_, d) => set('site_name', d.value)} />
        </div>
        <div className={styles.field}>
          <Label id="logo_mode_label">LOGO 样式</Label>
          <RadioGroup aria-labelledby="logo_mode_label" value={logoMode} onChange={(_, d) => set('logo_mode', d.value)}>
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
                    <span style={{ fontSize: '12px', color: tokens.colorNeutralForeground3 }}>未设置</span>
                  )
                ) : iconPath ? (
                  <img
                    src={assetUrl(iconPath)}
                    alt="图标"
                    style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain' }}
                  />
                ) : (
                  <span style={{ fontSize: '11px', color: tokens.colorNeutralForeground3 }}>默认图标</span>
                )}
              </div>
              <Button
                appearance="outline"
                icon={<ImageRegular />}
                onClick={() => pickLogo(logoMode === 'image' ? 'image' : 'icon')}
                disabled={logoBusy}
              >
                {logoMode === 'image' ? (logoPath ? '更换图片' : '上传图片') : iconPath ? '更换图标' : '上传图标'}
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
