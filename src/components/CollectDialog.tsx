// 网页采集弹窗：粘贴单页 URL → 选择采集插件 → 抓取并按选择器提取 → 预览勾选 → 回填编辑表单。
// 只负责「把页面内容读成结构化字段」：不写库、不下载图片。
// 封面与图集在此仅登记为「待本地化」，真正下载发生在保存时（见 EditPage 的 saveMut）。
import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Input,
  Textarea,
  Spinner,
  Select,
  Checkbox,
  MessageBar,
  MessageBarBody,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowDownloadRegular,
  GlobeRegular,
  FolderAddRegular,
  ArrowLeftRegular,
  ImageRegular,
  LinkRegular,
} from '@fluentui/react-icons';
import { open } from '@tauri-apps/plugin-dialog';
import { collectorApi } from '../lib/tauri';
import { confirmInfo } from '../lib/dialog';
import type { CollectorInfo } from '../lib/tauri';
import { extractPage, magnetName, magnetTrackerCount, parsePlugin, urlMatches } from '../lib/collector';
import type { CollectResult } from '../lib/collector';
import { useLanguage } from '../i18n';

export interface CollectApplyPayload {
  title: string;
  /** 游戏简介 → 写入文章正文（Markdown） */
  content: string;
  /** 远程封面地址；仅登记，保存时才下载本地化 */
  thumbnailUrl: string | null;
  /** 远程图集地址；仅登记，保存时才下载本地化 */
  imageUrls: string[];
  magnets: string[];
  sourceUrl: string | null;
  /** 抓图防盗链 Referer（页面最终 URL），保存时下载图片需要 */
  referer: string;
}

const useStyles = makeStyles({
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.35)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '24px',
  },
  dialog: {
    background: tokens.colorNeutralBackground1,
    borderRadius: '10px',
    boxShadow: tokens.shadow64,
    width: '760px',
    maxWidth: '100%',
    maxHeight: '88vh',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 18px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    fontWeight: 600,
    fontSize: '15px',
  },
  body: {
    padding: '16px 18px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    padding: '12px 18px',
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  row: { display: 'flex', gap: '8px', alignItems: 'center' },
  sectionLabel: {
    fontWeight: 600,
    fontSize: '13px',
    color: tokens.colorNeutralForeground2,
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginTop: '4px',
  },
  imgGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
    gap: '8px',
  },
  imgCell: {
    position: 'relative',
    borderRadius: '6px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    overflow: 'hidden',
    background: tokens.colorNeutralBackground2,
    aspectRatio: '16 / 9',
    cursor: 'pointer',
  },
  imgCellImg: { width: '100%', height: '100%', objectFit: 'cover' },
  imgCellCheck: { position: 'absolute', top: '4px', left: '4px', zIndex: 1 },
  imgCellFallback: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: tokens.colorNeutralForeground3,
    fontSize: '11px',
    padding: '4px',
    textAlign: 'center',
  },
  magnetRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-start',
    padding: '8px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '6px',
  },
  coverBox: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
  },
  coverImg: {
    width: '64px',
    height: '90px',
    objectFit: 'cover',
    borderRadius: '6px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    background: tokens.colorNeutralBackground2,
  },
});

type Step = 'input' | 'loading' | 'preview';

export function CollectDialog({
  hasThumbnail,
  onClose,
  onApply,
}: {
  hasThumbnail: boolean;
  onClose: () => void;
  onApply: (payload: CollectApplyPayload) => Promise<void>;
}) {
  const s = useStyles();
  const { t } = useLanguage();
  const [step, setStep] = useState<Step>('input');
  const [url, setUrl] = useState('');
  const [plugins, setPlugins] = useState<CollectorInfo[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [error, setError] = useState('');
  const [referer, setReferer] = useState('');

  const [extracted, setExtracted] = useState<CollectResult | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [useThumb, setUseThumb] = useState(!hasThumbnail);
  const [useSource, setUseSource] = useState(true);
  const [imgSet, setImgSet] = useState<Set<number>>(new Set());
  const [magSet, setMagSet] = useState<Set<number>>(new Set());

  useEffect(() => {
    collectorApi
      .list()
      .then((list) => {
        setPlugins(list);
        if (url && list.length > 0) {
          const m = list.find((p) => urlMatches(p.patterns, url));
          if (m) setSelectedId(m.id);
        }
        if (!selectedId) setSelectedId(list[0]?.id ?? '');
      })
      .catch((e: Error) => setError(e.message));
    // 仅初始化加载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // URL 变化时自动匹配插件
  useEffect(() => {
    if (!url || plugins.length === 0) return;
    const m = plugins.find((p) => urlMatches(p.patterns, url));
    if (m) setSelectedId(m.id);
  }, [url, plugins]);

  const selectedPlugin = useMemo(() => plugins.find((p) => p.id === selectedId), [plugins, selectedId]);

  const start = async () => {
    setError('');
    const target = url.trim();
    if (!/^https?:\/\//i.test(target)) {
      setError(t('collect.invalidUrl'));
      return;
    }
    if (!selectedPlugin) {
      setError(t('collect.selectPlugin'));
      return;
    }
    setStep('loading');
    try {
      const page = await collectorApi.fetch(target);
      const plugin = parsePlugin(selectedPlugin);
      const result = extractPage(page.body, page.final_url, plugin);
      setReferer(page.final_url);
      setExtracted(result);
      setTitle(result.title);
      setDescription(result.description);
      setImgSet(new Set(result.images.map((_, i) => i)));
      setMagSet(new Set(result.magnets.map((_, i) => i)));
      setUseThumb(!hasThumbnail);
      setUseSource(true);
      if (!result.title && !result.thumbnail && result.images.length === 0 && result.magnets.length === 0) {
        setError(t('collect.noContent'));
        setStep('input');
        return;
      }
      setStep('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('collect.failed'));
      setStep('input');
    }
  };

  const importPlugin = async () => {
    setError('');
    const picked = await open({
      multiple: false,
      filters: [{ name: t('collect.pluginFile'), extensions: ['json'] }],
    });
    if (typeof picked !== 'string') return;
    if (!(await confirmInfo(t('collect.importConfirm'), t('collect.importTitle')))) return;
    try {
      const info = await collectorApi.importPlugin(picked);
      setPlugins((prev) => [info, ...prev.filter((p) => p.id !== info.id)]);
      setSelectedId(info.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('collect.importFailed'));
    }
  };

  const toggle = (set: Set<number>, setter: (s: Set<number>) => void, i: number, checked: boolean) => {
    const next = new Set(set);
    if (checked) next.add(i);
    else next.delete(i);
    setter(next);
  };

  const confirm = async () => {
    if (!extracted) return;
    try {
      // onApply 只往编辑表单写值，不写库、不下载，因此是瞬时完成的
      await onApply({
        title: title.trim(),
        content: description.trim(),
        thumbnailUrl: useThumb && extracted.thumbnail ? extracted.thumbnail : null,
        imageUrls: extracted.images.filter((_, i) => imgSet.has(i)),
        magnets: extracted.magnets.filter((_, i) => magSet.has(i)),
        sourceUrl: useSource ? referer || url.trim() : null,
        referer,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('collect.applyFailed'));
    }
  };

  return (
    <div className={s.overlay} onClick={(e) => e.target === e.currentTarget && step !== 'loading' && onClose()}>
      <div className={s.dialog}>
        <div className={s.header}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <GlobeRegular /> {t('edit.webCollect')}
          </span>
          {selectedPlugin && (
            <span style={{ fontWeight: 400, fontSize: '12px', color: tokens.colorNeutralForeground3 }}>
              {selectedPlugin.name}
            </span>
          )}
        </div>

        <div className={s.body}>
          {error && (
            <MessageBar intent="error">
              <MessageBarBody>{error}</MessageBarBody>
            </MessageBar>
          )}

          {(step === 'input' || step === 'loading') && (
            <>
              <Input
                placeholder={t('collect.urlPlaceholder')}
                value={url}
                onChange={(_, d) => setUrl(d.value)}
                contentBefore={<GlobeRegular />}
                disabled={step === 'loading'}
              />
              <div className={s.row}>
                <Select
                  style={{ flex: 1 }}
                  value={selectedId}
                  onChange={(_, d) => setSelectedId(d.value)}
                  disabled={step === 'loading' || plugins.length === 0}
                >
                  {plugins.length === 0 && <option value="">{t('collect.noPlugins')}</option>}
                  {plugins.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {urlMatches(p.patterns, url) ? t('collect.matchCurrent') : ''}
                    </option>
                  ))}
                </Select>
                <Button icon={<FolderAddRegular />} onClick={importPlugin} disabled={step === 'loading'}>
                  {t('collect.importPlugin')}
                </Button>
              </div>
              {selectedPlugin?.description && (
                <span style={{ fontSize: '12px', color: tokens.colorNeutralForeground3 }}>
                  {selectedPlugin.description}
                </span>
              )}
              {step === 'loading' && <Spinner labelPosition="below" label={t('collect.loading')} />}
            </>
          )}

          {step === 'preview' && extracted && (
            <>
              <div>
                <div className={s.sectionLabel}>{t('collect.titleField')}</div>
                <Input value={title} onChange={(_, d) => setTitle(d.value)} style={{ width: '100%' }} />
              </div>

              <div>
                <div className={s.sectionLabel}>{t('collect.gameIntro')}</div>
                <Textarea
                  value={description}
                  onChange={(_, d) => setDescription(d.value)}
                  rows={8}
                  resize="vertical"
                  style={{ width: '100%' }}
                />
              </div>

              {extracted.thumbnail && (
                <div>
                  <div className={s.sectionLabel}>
                    <Checkbox
                      checked={useThumb}
                      onChange={(_, d) => setUseThumb(d.checked === true)}
                      label={t('edit.coverImage')}
                    />
                  </div>
                  <div className={s.coverBox} style={{ marginTop: '6px' }}>
                    <RemoteImg className={s.coverImg} src={extracted.thumbnail} />
                    <span style={{ fontSize: '12px', color: tokens.colorNeutralForeground3, wordBreak: 'break-all' }}>
                      {extracted.thumbnail}
                    </span>
                  </div>
                </div>
              )}

              {extracted.images.length > 0 && (
                <div>
                  <div className={s.sectionLabel}>
                    <ImageRegular /> {t('collect.gallery', { n: imgSet.size, total: extracted.images.length })}
                    <Button
                      size="small"
                      appearance="subtle"
                      onClick={() =>
                        setImgSet(
                          imgSet.size === extracted.images.length
                            ? new Set()
                            : new Set(extracted.images.map((_, i) => i)),
                        )
                      }
                    >
                      {imgSet.size === extracted.images.length ? t('collect.selectNone') : t('collect.selectAll')}
                    </Button>
                  </div>
                  <div className={s.imgGrid}>
                    {extracted.images.map((u, i) => (
                      <div key={u} className={s.imgCell} onClick={() => toggle(imgSet, setImgSet, i, !imgSet.has(i))}>
                        <Checkbox
                          className={s.imgCellCheck}
                          checked={imgSet.has(i)}
                          onChange={(_, d) => toggle(imgSet, setImgSet, i, d.checked === true)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <RemoteImg className={s.imgCellImg} src={u} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {extracted.magnets.length > 0 && (
                <div>
                  <div className={s.sectionLabel}>
                    🧲 {t('collect.magnets', { n: magSet.size, total: extracted.magnets.length })}
                    <Button
                      size="small"
                      appearance="subtle"
                      onClick={() =>
                        setMagSet(
                          magSet.size === extracted.magnets.length
                            ? new Set()
                            : new Set(extracted.magnets.map((_, i) => i)),
                        )
                      }
                    >
                      {magSet.size === extracted.magnets.length ? t('collect.selectNone') : t('collect.selectAll')}
                    </Button>
                  </div>
                  {extracted.magnets.map((m, i) => {
                    const dn = magnetName(m);
                    return (
                      <div key={m} className={s.magnetRow} style={{ marginTop: '6px' }}>
                        <Checkbox
                          checked={magSet.has(i)}
                          onChange={(_, d) => toggle(magSet, setMagSet, i, d.checked === true)}
                        />
                        <div style={{ fontSize: '12px', minWidth: 0 }}>
                          <div style={{ fontWeight: 600 }}>{dn || t('collect.magnetN', { n: i + 1 })}</div>
                          <div style={{ color: tokens.colorNeutralForeground3, wordBreak: 'break-all' }}>
                            {m.slice(0, 100)}
                            {m.length > 100 ? '…' : ''}
                          </div>
                          <div>
                            {magnetTrackerCount(m)} {t('collect.tracker')}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className={s.sectionLabel}>
                <LinkRegular />
                <Checkbox
                  checked={useSource}
                  onChange={(_, d) => setUseSource(d.checked === true)}
                  label={t('collect.asLink')}
                />
              </div>

              <span style={{ fontSize: '12px', color: tokens.colorNeutralForeground3 }}>
                {t('collect.hintPrefix')}
                <b>{t('collect.hintBold')}</b>
                {t('collect.hintSuffix')}
              </span>
            </>
          )}
        </div>

        <div className={s.footer}>
          <Button appearance="subtle" onClick={onClose} disabled={step === 'loading'}>
            {t('common.cancel')}
          </Button>
          {step === 'preview' && (
            <>
              <Button icon={<ArrowLeftRegular />} onClick={() => setStep('input')}>
                {t('collect.prev')}
              </Button>
              <Button
                appearance="primary"
                icon={<ArrowDownloadRegular />}
                onClick={confirm}
                disabled={!title.trim() && !useThumb && imgSet.size === 0 && magSet.size === 0 && !useSource}
              >
                {t('collect.confirm')}
              </Button>
            </>
          )}
          {step === 'input' && (
            <Button appearance="primary" icon={<ArrowDownloadRegular />} onClick={start}>
              {t('collect.start')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 远程图片预览：加载失败时显示兜底（部分站防盗链，实际下载由后端带 Referer 完成） */
function RemoteImg({ src, className }: { src: string; className: string }) {
  const [failed, setFailed] = useState(false);
  const { t } = useLanguage();
  if (failed) {
    return (
      <div
        className={className}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '11px',
          color: 'var(--colorNeutralForeground3)',
          padding: '4px',
          textAlign: 'center',
        }}
      >
        {t('collect.previewUnavailable')}
      </div>
    );
  }
  return (
    <img
      className={className}
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
