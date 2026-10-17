// 详情页磁力种子区块：文件列表展开、BT 文件获取（含断点轮询）、种子下载入口
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, tokens } from '@fluentui/react-components';
import {
  ArrowDownloadRegular,
  CopyRegular,
  DocumentRegular,
  EditRegular,
  LinkRegular,
  WarningRegular,
} from '@fluentui/react-icons';
import { useNavigate } from 'react-router-dom';
import { torrentApi } from '../../lib/tauri';
import { formatBytes } from '../../lib/format';
import type { ParsedTorrentFile, FetchStatus } from '../../types/models';
import { useStyles, type MtGroup } from './shared';
import { useLanguage } from '../../i18n';

export function MagnetSection({
  rid,
  resourceId,
  groups,
  missingIds,
  canArticle,
  onOpenTorrent,
}: {
  rid: number;
  resourceId: number;
  groups: MtGroup[];
  missingIds: Set<number>;
  canArticle: boolean;
  onOpenTorrent: (g: MtGroup) => void;
}) {
  const styles = useStyles();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // 文件列表展开状态：{ itemId: { expanded, files, loading, cached } }
  const [filesState, setFilesState] = useState<
    Record<number, { expanded: boolean; files: ParsedTorrentFile[]; loading: boolean; cached: boolean }>
  >({});
  // 磁力下载状态：{ itemId: FetchStatus }
  const [fetchState, setFetchState] = useState<Record<number, FetchStatus>>({});

  const copyMagnet = (text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
  };

  // 提交磁力下载任务 + 轮询状态
  const fetchMagnet = async (itemId: number) => {
    try {
      await torrentApi.fetchTorrent(rid, itemId);
      setFetchState((s) => ({ ...s, [itemId]: { status: 'pending', error: '', count: 0, torrent_path: '' } }));
      // 轮询状态
      const poll = async () => {
        try {
          const status = await torrentApi.getFetchStatus(rid, itemId);
          setFetchState((s) => ({ ...s, [itemId]: status }));
          if (status.status === 'done' || status.status === 'failed') {
            // 下载完成，刷新资源数据
            if (status.status === 'done') {
              queryClient.invalidateQueries({ queryKey: ['resource', rid] });
            }
            return;
          }
          setTimeout(poll, 2000);
        } catch {
          setFetchState((s) => ({
            ...s,
            [itemId]: { status: 'failed', error: t('magnet.queryFailed'), count: 0, torrent_path: '' },
          }));
        }
      };
      setTimeout(poll, 1000);
    } catch (e: any) {
      setFetchState((s) => ({
        ...s,
        [itemId]: { status: 'failed', error: String(e), count: 0, torrent_path: '' },
      }));
    }
  };

  // 切换文件列表展开/收起
  const toggleFiles = async (itemId: number, torrentPath: string) => {
    const cur = filesState[itemId];
    // 收起
    if (cur?.expanded) {
      setFilesState((s) => ({ ...s, [itemId]: { ...cur, expanded: false } }));
      return;
    }
    // 展开：先查缓存
    setFilesState((s) => ({
      ...s,
      [itemId]: { expanded: true, files: [], loading: true, cached: false },
    }));
    try {
      const cached = await torrentApi.getFiles(rid, itemId);
      if (cached.length > 0) {
        const files: ParsedTorrentFile[] = cached.map((f) => ({ name: f.name, size: f.size }));
        setFilesState((s) => ({
          ...s,
          [itemId]: { expanded: true, files, loading: false, cached: true },
        }));
        return;
      }
      // 无缓存：解析 torrent 文件
      if (!torrentPath) {
        setFilesState((s) => ({
          ...s,
          [itemId]: { expanded: true, files: [], loading: false, cached: false },
        }));
        return;
      }
      const files = await torrentApi.parseTorrentFile(torrentPath);
      setFilesState((s) => ({
        ...s,
        [itemId]: { expanded: true, files, loading: false, cached: false },
      }));
      // 回写缓存（能阅读该文章即可）
      if (files.length > 0) {
        try {
          await torrentApi.saveFiles(rid, itemId, files);
        } catch {
          // 忽略缓存保存失败
        }
      }
    } catch {
      setFilesState((s) => ({
        ...s,
        [itemId]: { expanded: true, files: [], loading: false, cached: false },
      }));
    }
  };

  return (
    <>
      {groups.map((g, idx) => (
        <div key={g.itemId} className={styles.itemBlock} data-mt-index={idx} data-mt-item-id={g.itemId}>
          <div className={styles.itemHeader}>
            <LinkRegular /> {t('magnet.seedN', { n: idx + 1 })}
          </div>
          {g.description && <div className={styles.itemDesc}>{g.description}</div>}
          {g.magnetContent && (
            <div
              className={styles.magnetContent}
              onClick={() => copyMagnet(g.magnetContent)}
              title={t('magnet.copyTitle')}
            >
              <span style={{ flex: 1 }}>{g.magnetContent}</span>
              <CopyRegular />
            </div>
          )}
          {!g.torrentPath ? (
            // 无种子文件：能阅读文章即可获取 BT 文件
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Button
                appearance="primary"
                size="small"
                icon={<ArrowDownloadRegular />}
                onClick={() => fetchMagnet(g.itemId)}
                disabled={['pending', 'running'].includes(fetchState[g.itemId]?.status || '')}
              >
                {fetchState[g.itemId]?.status === 'running'
                  ? t('magnet.downloading')
                  : fetchState[g.itemId]?.status === 'pending'
                    ? t('magnet.queued')
                    : t('magnet.getBt')}
              </Button>
              {fetchState[g.itemId]?.status === 'failed' && (
                <span style={{ fontSize: '12px', color: tokens.colorPaletteRedForeground1 }}>
                  {fetchState[g.itemId]?.error || t('magnet.downloadFailed')}
                </span>
              )}
              {fetchState[g.itemId]?.status === 'done' && (
                <span style={{ fontSize: '12px', color: tokens.colorPaletteGreenForeground1 }}>
                  {t('magnet.fetched', { n: fetchState[g.itemId]?.count })}
                </span>
              )}
            </div>
          ) : missingIds.has(g.itemId) ? (
            // 种子文件已丢失（被手动删除等）
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <WarningRegular color={tokens.colorPaletteRedForeground1} />
              <span style={{ fontSize: '12px', color: tokens.colorPaletteRedForeground1 }}>
                {t('magnet.torrentLost')}
              </span>
              {g.magnetContent ? (
                <>
                  <Button
                    appearance="primary"
                    size="small"
                    icon={<ArrowDownloadRegular />}
                    onClick={() => fetchMagnet(g.itemId)}
                    disabled={['pending', 'running'].includes(fetchState[g.itemId]?.status || '')}
                  >
                    {fetchState[g.itemId]?.status === 'running'
                      ? t('magnet.redownloading')
                      : fetchState[g.itemId]?.status === 'pending'
                        ? t('magnet.queued')
                        : t('magnet.regetBt')}
                  </Button>
                  {fetchState[g.itemId]?.status === 'failed' && (
                    <span style={{ fontSize: '12px', color: tokens.colorPaletteRedForeground1 }}>
                      {fetchState[g.itemId]?.error || t('magnet.downloadFailed')}
                    </span>
                  )}
                </>
              ) : (
                canArticle && (
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={<EditRegular />}
                    onClick={() => navigate(`/edit/${resourceId}`)}
                  >
                    {t('magnet.editReupload')}
                  </Button>
                )
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Button
                appearance="outline"
                size="small"
                icon={<ArrowDownloadRegular />}
                onClick={() => onOpenTorrent(g)}
              >
                {t('magnet.downloadTorrent')}
              </Button>
              <Button
                appearance="subtle"
                size="small"
                icon={<DocumentRegular />}
                onClick={() => toggleFiles(g.itemId, g.torrentPath)}
              >
                {filesState[g.itemId]?.expanded ? t('magnet.collapseFiles') : t('magnet.expandFiles')}
              </Button>
              {g.torrentFileName && (
                <span style={{ fontSize: '12px', color: tokens.colorNeutralForeground2 }}>{g.torrentFileName}</span>
              )}
            </div>
          )}
          {/* 文件列表 */}
          {filesState[g.itemId]?.expanded && (
            <div className={styles.filesBox}>
              {filesState[g.itemId]?.loading ? (
                <div
                  style={{
                    padding: '12px',
                    textAlign: 'center',
                    color: tokens.colorNeutralForeground3,
                    fontSize: '13px',
                  }}
                >
                  {t('magnet.parsing')}
                </div>
              ) : filesState[g.itemId]?.files.length === 0 ? (
                <div
                  style={{
                    padding: '12px',
                    textAlign: 'center',
                    color: tokens.colorNeutralForeground3,
                    fontSize: '13px',
                  }}
                >
                  {t('magnet.noFiles')}
                </div>
              ) : (
                <>
                  <div className={styles.filesHeader}>
                    <span>
                      {filesState[g.itemId]?.cached ? t('magnet.cached') : t('magnet.parsedNow')}
                      {t('magnet.totalLabel')} {filesState[g.itemId]?.files.length} {t('magnet.unitItem')}
                    </span>
                    <span>
                      {t('magnet.totalSize')}{' '}
                      {formatBytes(filesState[g.itemId]?.files.reduce((s, f) => s + (f.size || 0), 0) || 0)}
                    </span>
                  </div>
                  <table className={styles.filesTable}>
                    <tbody>
                      {filesState[g.itemId]?.files.map((f, i) => (
                        <tr key={i} className={styles.filesRow}>
                          <td className={styles.filesName}>{f.name}</td>
                          <td className={styles.filesSize}>{formatBytes(f.size)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
