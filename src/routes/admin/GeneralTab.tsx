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
import { useLanguage } from '../../i18n';

export function GeneralTab() {
  const styles = useStyles();
  const { t } = useLanguage();
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
      filters: [{ name: t('edit.filterImage'), extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'ico'] }],
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
      setLogoError(e.message || t('general.logoUploadFailed'));
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
      setLogoError(e.message || t('general.logoClearFailed'));
    } finally {
      setLogoBusy(false);
    }
  };

  return (
    <div className={styles.container}>
      <Card className={styles.card}>
        <div className={styles.title}>
          <SettingsRegular /> {t('general.siteInfo')}
        </div>
        <div className={styles.field}>
          <Label htmlFor="site_name">{t('general.siteName')}</Label>
          <Input id="site_name" value={form.site_name ?? ''} onChange={(_, d) => set('site_name', d.value)} />
        </div>
        <div className={styles.field}>
          <Label id="logo_mode_label">{t('general.logoStyle')}</Label>
          <RadioGroup aria-labelledby="logo_mode_label" value={logoMode} onChange={(_, d) => set('logo_mode', d.value)}>
            <Radio value="text" label={t('general.logoText')} />
            <Radio value="icon_text" label={t('general.logoIconText')} />
            <Radio value="image" label={t('general.logoImage')} />
          </RadioGroup>
        </div>
        {(logoMode === 'image' || logoMode === 'icon_text') && (
          <div className={styles.field}>
            <Label>{logoMode === 'image' ? t('general.logoImageLabel') : t('general.iconImageLabel')}</Label>
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
                      alt={t('general.logo')}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <span style={{ fontSize: '12px', color: tokens.colorNeutralForeground3 }}>
                      {t('general.notSet')}
                    </span>
                  )
                ) : iconPath ? (
                  <img
                    src={assetUrl(iconPath)}
                    alt={t('general.icon')}
                    style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain' }}
                  />
                ) : (
                  <span style={{ fontSize: '11px', color: tokens.colorNeutralForeground3 }}>
                    {t('general.defaultIcon')}
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
                    ? t('general.changeImage')
                    : t('general.uploadImage')
                  : iconPath
                    ? t('general.changeIcon')
                    : t('general.uploadIcon')}
              </Button>
              {((logoMode === 'image' && logoPath) || (logoMode === 'icon_text' && iconPath)) && (
                <Button
                  appearance="subtle"
                  icon={<DeleteRegular />}
                  onClick={() => removeLogo(logoMode === 'image' ? 'image' : 'icon')}
                  disabled={logoBusy}
                >
                  {t('general.remove')}
                </Button>
              )}
              {logoBusy && <Spinner size="tiny" />}
            </div>
            <div style={{ fontSize: '12px', color: tokens.colorNeutralForeground3, marginTop: '4px' }}>
              {logoMode === 'image' ? t('general.logoImageHint') : t('general.logoIconHint')}
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
          {t('common.save')}
        </Button>
      </Card>

      <Card className={styles.card}>
        <div className={styles.title}>
          <DesktopRegular /> {t('general.windowBehavior')}
        </div>
        <div className={styles.field}>
          <Switch
            label={t('general.closeToTray')}
            checked={form.close_to_tray === '1'}
            onChange={(_, d) => updateMut.mutate({ close_to_tray: d.checked ? '1' : '0' })}
          />
        </div>
      </Card>

      <Card className={styles.card}>
        <div className={styles.title}>
          <GlobeRegular /> {t('general.linkOpenMode')}
        </div>
        <div className={styles.field}>
          <Label id="link_mode_label">{t('general.linkLabel')}</Label>
          <RadioGroup
            aria-labelledby="link_mode_label"
            value={form.link_open_mode ?? 'default'}
            onChange={(_, d) => set('link_open_mode', d.value)}
          >
            <Radio value="default" label={t('general.defaultBrowser')} />
            <Radio value="custom" label={t('general.customBrowser')} />
          </RadioGroup>
        </div>
        {(form.link_open_mode ?? 'default') === 'custom' && (
          <div className={styles.field}>
            <Label htmlFor="browser_path">{t('general.browserPath')}</Label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Input
                id="browser_path"
                style={{ flex: 1 }}
                value={form.browser_path ?? ''}
                onChange={(_, d) => set('browser_path', d.value)}
                placeholder={t('general.chromePathExample')}
              />
              <Button
                appearance="outline"
                icon={<FolderOpenRegular />}
                onClick={async () => {
                  const selected = await openDialog({
                    multiple: false,
                    filters: [{ name: t('general.executable'), extensions: ['exe'] }],
                  });
                  if (typeof selected === 'string') set('browser_path', selected);
                }}
              >
                {t('general.browse')}
              </Button>
            </div>
            <div style={{ fontSize: '12px', color: tokens.colorNeutralForeground3, marginTop: '4px' }}>
              {t('general.browserHint')}
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
          {t('common.save')}
        </Button>
      </Card>

      <Card className={styles.card}>
        <div className={styles.title}>
          <CloudRegular /> {t('general.storageBackend')}
        </div>
        <div className={styles.field}>
          <Label htmlFor="local_upload_dir">{t('general.localDir')}</Label>
          <Input
            id="local_upload_dir"
            value={form.local_upload_dir ?? ''}
            onChange={(_, d) => set('local_upload_dir', d.value)}
          />
        </div>
        <div className={styles.field}>
          <Label htmlFor="local_url_prefix">{t('general.urlPrefix')}</Label>
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
          {t('general.saveStorage')}
        </Button>
      </Card>
    </div>
  );
}
