// 附件清理：扫描存储目录中无数据库引用的文件并批量删除
import { useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Spinner,
  tokens,
} from '@fluentui/react-components';
import {
  ScanObjectRegular,
  ImageRegular,
  DocumentRegular,
  DeleteRegular,
  FolderOpenRegular,
} from '@fluentui/react-icons';
import { cleanupApi, torrentApi, assetUrl } from '../../lib/tauri';
import { confirmDanger } from '../../lib/dialog';
import { formatBytes } from '../../lib/format';
import type { OrphanFile } from '../../lib/tauri';
import { useSelection, BatchBar } from '../../components/Selection';
import { useStyles } from './styles';
import { useLanguage } from '../../i18n';

const CATEGORY_LABEL_KEYS: Record<OrphanFile['category'], string> = {
  thumbnail: 'cleanup.cat.thumbnail',
  gallery: 'cleanup.cat.gallery',
  content: 'cleanup.cat.content',
  file: 'cleanup.cat.file',
  torrent: 'cleanup.cat.torrent',
  magnet: 'cleanup.cat.magnet',
  avatar: 'cleanup.cat.avatar',
  logo: 'cleanup.cat.logo',
  other: 'cleanup.cat.other',
};

export function CleanupTab() {
  const styles = useStyles();
  const { t } = useLanguage();
  const selection = useSelection();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [cat, setCat] = useState<'all' | OrphanFile['category']>('all');

  // 手动触发扫描（enabled: false，进页面不扫）
  const { data, isFetching, refetch } = useQuery({
    queryKey: ['orphan-files'],
    queryFn: cleanupApi.scan,
    enabled: false,
  });
  // 必须 memo：直接写 `data?.files ?? []` 每次渲染都是新数组，
  // 会让下面两个 useMemo 的依赖每次都变，等于没缓存
  const files = useMemo(() => data?.files ?? [], [data]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of files) m.set(f.category, (m.get(f.category) ?? 0) + 1);
    return m;
  }, [files]);

  const filtered = useMemo(() => (cat === 'all' ? files : files.filter((f) => f.category === cat)), [files, cat]);

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
            ? t('cleanup.deleted', { n: res.deleted.length })
            : t('cleanup.deletedPartial', {
                deleted: res.deleted.length,
                failed: res.failed.length,
                errors: res.failed
                  .slice(0, 3)
                  .map((f) => f.error)
                  .join('、'),
              }),
      });
    },
    onError: (e: Error) => setMsg({ ok: false, text: e.message || t('users.deleteFailed') }),
  });

  const batchDelete = async () => {
    const paths = filtered.filter((_, i) => selection.selected.has(i)).map((f) => f.path);
    if (paths.length === 0) return;
    const ok = await confirmDanger(t('cleanup.confirmDelete', { n: paths.length }));
    if (!ok) return;
    deleteMut.mutate(paths);
  };

  const allChecked = filtered.length > 0 && filtered.every((_, i) => selection.selected.has(i));
  const busy = isFetching || deleteMut.isPending;

  return (
    <div className={styles.cleanupContainer}>
      <Card className={styles.card}>
        <div className={styles.title}>
          <ScanObjectRegular /> {t('cleanup.title')}
        </div>
        <MessageBar intent="info" className={styles.feedback}>
          <MessageBarBody>
            {t('cleanup.descPrefix')}
            <b>{t('cleanup.descBold')}</b>
            {t('cleanup.descSuffix')}
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
            {data ? t('cleanup.rescan') : t('cleanup.scan')}
          </Button>
          {isFetching && <Spinner size="tiny" label={t('cleanup.scanning')} />}
          {data && !isFetching && (
            <span style={{ fontSize: '13px', color: tokens.colorNeutralForeground3 }}>
              {t('cleanup.found', { n: files.length, size: formatBytes(data.total_size) })}
            </span>
          )}
        </div>

        {msg && (
          <MessageBar intent={msg.ok ? 'success' : 'error'} style={{ marginTop: '12px' }}>
            <MessageBarBody>
              <MessageBarTitle>{msg.ok ? t('cleanup.done') : t('common.fail')}</MessageBarTitle>
              {msg.text}
            </MessageBarBody>
          </MessageBar>
        )}
      </Card>

      {data && !isFetching && files.length === 0 && (
        <Card className={styles.card}>
          <MessageBar intent="success">
            <MessageBarBody>{t('cleanup.clean')}</MessageBarBody>
          </MessageBar>
        </Card>
      )}

      {filtered.length > 0 && (
        <Card className={styles.card}>
          <div className={styles.filterBar}>
            <Button size="small" appearance={cat === 'all' ? 'primary' : 'outline'} onClick={() => switchCat('all')}>
              {t('cleanup.allCount', { n: files.length })}
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
                  {t(CATEGORY_LABEL_KEYS[c as OrphanFile['category']])}（{n}）
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
                    {f.category === 'thumbnail' || f.category === 'gallery' ? <ImageRegular /> : <DocumentRegular />}
                  </div>
                )}
                <div className={styles.userInfo}>
                  <div className={styles.userName}>
                    {f.name}
                    <Badge size="small" appearance="outline">
                      {t(CATEGORY_LABEL_KEYS[f.category])}
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
                  title={t('cleanup.locate')}
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
        onSelectAll={(c) =>
          selection.selectAll(
            filtered.map((_, i) => i),
            c,
          )
        }
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
          {t('cleanup.deleteSelected')}
        </Button>
      </BatchBar>
    </div>
  );
}
