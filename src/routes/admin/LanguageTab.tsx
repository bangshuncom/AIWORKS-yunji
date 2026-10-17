// 语言设置：双层持久化（本地覆盖 ＞ 全局默认）
//
// - 个人语言（所有登录用户）：写到 localStorage，仅本机生效，优先级高于全局
// - 全局默认（仅管理员）：写到 settings.ui_language，对所有未自行选择语言的用户生效
// 字典加载与生效语言由 LanguageProvider 统一管理（见 src/i18n）。
import { useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Dropdown,
  Label,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Option,
  Spinner,
  tokens,
} from '@fluentui/react-components';
import { ArrowSyncRegular, FolderRegular, LocalLanguageRegular } from '@fluentui/react-icons';
import { i18nApi } from '../../lib/tauri';
import { useLanguage } from '../../i18n';
import { usePerms } from '../../hooks/usePerms';
import { useStyles } from './styles';

export function LanguageTab() {
  const styles = useStyles();
  const { t, languages, localOverride, setLocalLanguage, globalDefault, refreshLanguages, ready } = useLanguage();
  const { isAdmin } = usePerms();

  const [langDir, setLangDir] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    i18nApi
      .getLangDir()
      .then(setLangDir)
      .catch(() => {});
  }, []);

  // 全局默认语言写库（仅管理员）
  const saveGlobal = async (code: string) => {
    setSaving(true);
    setMsg(null);
    try {
      await i18nApi.setUiLanguage(code);
      setMsg({ ok: true, text: t('lang.saved') });
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      setMsg({ ok: false, text: t('lang.switchFailed', { error: err }) });
    } finally {
      setSaving(false);
    }
  };

  const langLabel = (code: string) => languages.find((l) => l.code === code)?.nativeName || code;

  return (
    <div className={styles.container}>
      <Card className={styles.card}>
        <div className={styles.title}>
          <LocalLanguageRegular /> {t('lang.title')}
        </div>
        <div style={{ fontSize: '13px', color: tokens.colorNeutralForeground2, marginBottom: '16px' }}>
          {t('lang.desc')}
        </div>

        {/* 个人界面语言：覆盖到 localStorage，仅本机生效 */}
        <div className={styles.field}>
          <Label id="lang-personal-label">{t('lang.personal')}</Label>
          <Dropdown
            aria-labelledby="lang-personal-label"
            value={localOverride ? langLabel(localOverride) : t('lang.followGlobal')}
            selectedOptions={[localOverride ?? '']}
            onOptionSelect={(_, d) => {
              if (d.optionValue === undefined) return;
              setLocalLanguage(d.optionValue || null);
            }}
          >
            <Option key="__follow" value="" text={t('lang.followGlobal')}>
              {t('lang.followGlobal')}
            </Option>
            {languages.map((l) => (
              <Option key={l.code} value={l.code} text={l.nativeName || l.name}>
                {l.nativeName || l.name}
              </Option>
            ))}
          </Dropdown>
          <div style={{ fontSize: '12px', color: tokens.colorNeutralForeground3, marginTop: '4px' }}>
            {t('lang.personalHint')}
          </div>
        </div>

        {/* 全局默认：仅管理员；写入 settings.ui_language */}
        {isAdmin && (
          <div className={styles.field}>
            <Label id="lang-global-label">{t('lang.globalDefault')}</Label>
            <Dropdown
              aria-labelledby="lang-global-label"
              value={langLabel(globalDefault)}
              selectedOptions={[globalDefault]}
              disabled={saving || languages.length === 0}
              onOptionSelect={(_, d) => {
                if (d.optionValue) saveGlobal(d.optionValue);
              }}
            >
              {languages.map((l) => (
                <Option key={l.code} value={l.code} text={l.nativeName || l.name}>
                  {l.nativeName || l.name}
                </Option>
              ))}
            </Dropdown>
            <div style={{ fontSize: '12px', color: tokens.colorNeutralForeground3, marginTop: '4px' }}>
              {t('lang.globalDefaultHint')}
            </div>
          </div>
        )}

        {msg && (
          <MessageBar
            intent={msg.ok ? 'success' : 'error'}
            className={styles.feedback}
            style={{ marginBottom: '12px' }}
          >
            <MessageBarBody>
              <MessageBarTitle>{msg.ok ? t('lang.saved') : t('error.unknown')}</MessageBarTitle>
              {msg.text}
            </MessageBarBody>
          </MessageBar>
        )}
      </Card>

      {/* 语言清单：覆盖率 / 缺失 / 解析状态 */}
      <Card className={styles.card}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '12px',
            gap: '8px',
            flexWrap: 'wrap',
          }}
        >
          <Label>{t('lang.title')}</Label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button
              appearance="subtle"
              icon={<ArrowSyncRegular />}
              disabled={!ready}
              onClick={() => refreshLanguages().catch(() => {})}
            >
              {t('lang.refresh')}
            </Button>
            <Button appearance="subtle" icon={<FolderRegular />} onClick={() => i18nApi.openFolder().catch(() => {})}>
              {t('lang.openFolder')}
            </Button>
          </div>
        </div>

        {!ready && <Spinner size="tiny" label={t('common.loading')} />}

        {ready && languages.length === 0 && (
          <div style={{ fontSize: '13px', color: tokens.colorNeutralForeground3 }}>
            {t('lang.folderPath', { path: langDir || '-' })}
          </div>
        )}

        {ready &&
          languages.map((l) => (
            <div
              key={l.code}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 4px',
                borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
                flexWrap: 'wrap',
              }}
            >
              <span style={{ fontWeight: 600, minWidth: '120px' }}>{l.nativeName || l.name}</span>
              <span style={{ fontSize: '12px', color: tokens.colorNeutralForeground3 }}>{l.code}</span>
              <Badge appearance={l.isSeed ? 'filled' : 'outline'}>
                {l.isSeed ? t('lang.official') : t('lang.user')}
              </Badge>

              {l.status === 'invalid' ? (
                <Badge color="danger">{t('lang.invalid', { error: l.error || '' })}</Badge>
              ) : (
                <>
                  <Badge color={l.coverage >= 100 ? 'success' : 'informative'}>
                    {l.coverage >= 100 ? t('lang.complete') : t('lang.coverage', { percent: l.coverage })}
                  </Badge>
                  {l.missing > 0 && (
                    <span style={{ fontSize: '12px', color: tokens.colorNeutralForeground3 }}>
                      {t('lang.missing', { count: l.missing })}
                      {` · ${t('lang.missingHint')}`}
                    </span>
                  )}
                </>
              )}

              {l.warning && (
                <span style={{ fontSize: '12px', color: tokens.colorNeutralForeground3, flexBasis: '100%' }}>
                  {l.warning}
                </span>
              )}
            </div>
          ))}

        {ready && langDir && (
          <div style={{ fontSize: '12px', color: tokens.colorNeutralForeground3, marginTop: '12px' }}>
            {t('lang.folderPath', { path: langDir })}
          </div>
        )}
      </Card>
    </div>
  );
}
