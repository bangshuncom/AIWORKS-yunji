// 详情页：磁力种子分组 + 图集导航预览
import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Spinner,
  Badge,
  MessageBar,
  MessageBarBody,
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Avatar,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowLeftRegular,
  EditRegular,
  DeleteRegular,
  LinkRegular,
  ArrowDownloadRegular,
  DocumentRegular,
  CopyRegular,
  FolderRegular,
  OpenRegular,
  WarningRegular,
} from '@fluentui/react-icons';
import { resourceApi, imageApi, torrentApi, assetUrl } from '../lib/tauri';
import { formatTime, relativeTime, formatBytes } from '../lib/format';
import { usePerms } from '../hooks/usePerms';
import type { ResourceItem, Image, ParsedTorrentFile, FetchStatus } from '../types/models';
import { MarkdownView } from '../components/MarkdownView';
import { ImageLightbox } from '../components/ImageLightbox';

const useStyles = makeStyles({
  container: { display: 'flex', flexDirection: 'column', gap: '24px' },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  header: {
    display: 'flex',
    gap: '20px',
    alignItems: 'flex-start',
    '@media (max-width: 640px)': {
      flexDirection: 'column',
    },
  },
  thumb: {
    width: '212px',
    height: '150px',
    objectFit: 'cover',
    borderRadius: '10px',
    backgroundColor: tokens.colorNeutralBackground3,
    flexShrink: 0,
  },
  headerMain: {
    flex: 1,
    minWidth: 0,
  },
  title: { fontSize: '28px', fontWeight: 700, margin: 0, lineHeight: 1.3 },
  desc: {
    color: tokens.colorNeutralForeground2,
    whiteSpace: 'pre-wrap',
    margin: 0,
    fontSize: '15px',
    lineHeight: 1.7,
  },
  descBlock: {
    margin: 0,
    fontSize: '14px',
    lineHeight: 1.7,
    color: tokens.colorNeutralForeground2,
    fontStyle: 'italic',
    position: 'relative',
    paddingLeft: '18px',
    '&::before': {
      content: '"“"',
      position: 'absolute',
      left: 0,
      top: '-2px',
      fontSize: '22px',
      color: tokens.colorBrandForeground1,
      fontStyle: 'normal',
      lineHeight: 1,
    },
  },
  meta: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', fontSize: '13px', color: tokens.colorNeutralForeground3 },
  tags: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
  sectionTitle: {
    fontSize: '15px',
    fontWeight: 600,
    margin: 0,
    color: tokens.colorNeutralForeground1,
  },
  content: {
    padding: '20px 24px',
    borderRadius: '12px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    lineHeight: 1.8,
    fontSize: '15px',
    '& img': { maxWidth: '100%', borderRadius: '8px' },
    '& pre': { overflowX: 'auto', background: tokens.colorNeutralBackground2, padding: '12px', borderRadius: '8px' },
    '& code': { fontFamily: 'Consolas, Monaco, monospace' },
  },
  itemBlock: {
    padding: '16px 20px',
    borderRadius: '12px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  itemHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '15px',
    fontWeight: 600,
  },
  itemDesc: { fontSize: '13px', color: tokens.colorNeutralForeground2, lineHeight: 1.6 },
  magnetContent: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    padding: '10px 12px',
    borderRadius: '8px',
    backgroundColor: tokens.colorNeutralBackground2,
    fontFamily: 'Consolas, Monaco, monospace',
    fontSize: '13px',
    wordBreak: 'break-all',
    cursor: 'pointer',
  },
  gallery: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
    gap: '12px',
  },
  galleryImg: {
    width: '100%',
    aspectRatio: '4 / 3',
    objectFit: 'cover',
    borderRadius: '10px',
    cursor: 'pointer',
    transition: 'transform 0.15s',
    '&:hover': { transform: 'scale(1.02)' },
  },
  filesBox: {
    marginTop: '4px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '8px',
    overflow: 'hidden',
  },
  filesHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 14px',
    backgroundColor: tokens.colorNeutralBackground2,
    fontSize: '12px',
    color: tokens.colorNeutralForeground2,
  },
  filesTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px',
  },
  filesRow: {
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground2,
    },
  },
  filesName: {
    padding: '8px 14px',
    textAlign: 'left',
    wordBreak: 'break-all',
  },
  filesSize: {
    padding: '8px 14px',
    textAlign: 'right',
    whiteSpace: 'nowrap',
    color: tokens.colorNeutralForeground3,
    minWidth: '80px',
  },
});

interface MtGroup {
  magnetContent: string;
  magnetFileName: string;
  torrentPath: string;
  torrentFileName: string;
  description: string;
  itemId: number;
}

function extractMagnetFilename(magnet: string): string {
  const m = magnet.match(/[?&]dn=([^&]+)/i);
  if (!m) return 'magnet';
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

export function DetailPage() {
  const styles = useStyles();
  const { rid } = useParams<{ rid: string }>();
  const navigate = useNavigate();
  const { can: canFeature } = usePerms();
  const canArticle = canFeature('article');
  const [previewIndex, setPreviewIndex] = useState<number>(-1);
  // 文件列表展开状态：{ itemId: { expanded, files, loading, cached } }
  const [filesState, setFilesState] = useState<
    Record<number, { expanded: boolean; files: ParsedTorrentFile[]; loading: boolean; cached: boolean }>
  >({});
  // 磁力下载状态：{ itemId: FetchStatus }
  const [fetchState, setFetchState] = useState<Record<number, FetchStatus>>({});
  // 下载种子弹窗：当前操作的 MtGroup
  const [torrentDialog, setTorrentDialog] = useState<MtGroup | null>(null);
  // 关联文件丢失（被手动删除）的 item id 集合
  const [missingIds, setMissingIds] = useState<Set<number>>(new Set());

  const ridNum = Number(rid);
  const queryClient = useQueryClient();

  const { data: resource, isLoading } = useQuery({
    queryKey: ['resource', ridNum],
    queryFn: () => resourceApi.get(ridNum),
    enabled: !!rid && !Number.isNaN(ridNum),
  });

  const { data: images } = useQuery<Image[]>({
    queryKey: ['resource-images', ridNum],
    queryFn: () => imageApi.listResourceImages(ridNum),
    enabled: !!rid && !Number.isNaN(ridNum),
  });

  // 将 magnet_torrent 类型的 items 分组（每条 item 一组）
  const mtGroups: MtGroup[] = useMemo(() => {
    if (!resource?.items) return [];
    return resource.items
      .filter((it) => it.type === 'magnet_torrent')
      .map((it) => ({
        magnetContent: it.content || '',
        magnetFileName: it.content ? extractMagnetFilename(it.content) : '',
        torrentPath: it.file_path || '',
        torrentFileName: it.file_name || '',
        description: it.description || '',
        itemId: it.id,
      }));
  }, [resource]);

  const otherItems: ResourceItem[] = useMemo(() => {
    if (!resource?.items) return [];
    return resource.items.filter((it) => it.type !== 'magnet_torrent');
  }, [resource]);

  const galleryImages: Image[] = images ?? [];

  // 检测各条目关联的种子/附件文件是否还在磁盘上（资源数据刷新后重新检测）
  useEffect(() => {
    let cancelled = false;
    const hasFiles = resource?.items?.some((it) => !!it.file_path);
    if (!ridNum || Number.isNaN(ridNum) || !hasFiles) {
      setMissingIds(new Set());
      return;
    }
    torrentApi
      .checkFiles(ridNum)
      .then((list) => {
        if (cancelled) return;
        setMissingIds(new Set(list.filter((x) => !x.exists).map((x) => x.item_id)));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ridNum, resource]);

  const copyMagnet = (text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
  };

  // 提交磁力下载任务 + 轮询状态
  const fetchMagnet = async (itemId: number) => {
    try {
      await torrentApi.fetchTorrent(ridNum, itemId);
      setFetchState((s) => ({ ...s, [itemId]: { status: 'pending', error: '', count: 0, torrent_path: '' } }));
      // 轮询状态
      const poll = async () => {
        try {
          const status = await torrentApi.getFetchStatus(ridNum, itemId);
          setFetchState((s) => ({ ...s, [itemId]: status }));
          if (status.status === 'done' || status.status === 'failed') {
            // 下载完成，刷新资源数据
            if (status.status === 'done') {
              queryClient.invalidateQueries({ queryKey: ['resource', ridNum] });
            }
            return;
          }
          setTimeout(poll, 2000);
        } catch {
          setFetchState((s) => ({
            ...s,
            [itemId]: { status: 'failed', error: '查询状态失败', count: 0, torrent_path: '' },
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
      const cached = await torrentApi.getFiles(ridNum, itemId);
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
          await torrentApi.saveFiles(ridNum, itemId, files);
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

  if (isLoading) {
    return <Spinner label="加载中..." />;
  }

  if (!resource) {
    return (
      <MessageBar intent="warning">
        <MessageBarBody>资源不存在或已被删除</MessageBarBody>
      </MessageBar>
    );
  }

  const itemIcon = (type: string) => {
    switch (type) {
      case 'link': return <LinkRegular />;
      case 'direct_link': return <ArrowDownloadRegular />;
      case 'ed2k': return <LinkRegular />;
      case 'file': return <DocumentRegular />;
      default: return <LinkRegular />;
    }
  };

  const itemLabel = (type: string) => {
    switch (type) {
      case 'link': return '链接';
      case 'direct_link': return '直链';
      case 'ed2k': return 'ED2K';
      case 'file': return '附件';
      default: return type;
    }
  };

  return (
    <div className={styles.container}>
      {/* 顶部工具栏 */}
      <div className={styles.toolbar}>
        <Button
          appearance="subtle"
          icon={<ArrowLeftRegular />}
          onClick={() => navigate('/')}
        >
          返回
        </Button>
        {canArticle && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button
              appearance="outline"
              icon={<EditRegular />}
              onClick={() => navigate(`/edit/${resource.id}`)}
            >
              编辑
            </Button>
            <Button
              appearance="outline"
              icon={<DeleteRegular />}
              onClick={() => {
                if (confirm(`将「${resource.title}」移入回收站？`)) {
                  resourceApi.delete(resource.id).then(() => navigate('/'));
                }
              }}
            >
              删除
            </Button>
          </div>
        )}
      </div>
      {/* 标题 + 缩略图（左右布局） */}
      <div className={styles.header}>
        {resource.thumbnail_path && (
          <img
            className={styles.thumb}
            src={assetUrl(resource.thumbnail_path)}
            alt={resource.title}
            loading="lazy"
          />
        )}
        <div className={styles.headerMain}>
          <h1 className={styles.title}>{resource.title}</h1>
          <div className={styles.meta}>
            {resource.author && (
              <button
                type="button"
                onClick={() => navigate(`/?author=${resource.author!.id}`)}
                title={`查看 ${resource.author.nickname || resource.author.username} 的全部文章`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '3px 10px 3px 3px',
                  border: 'none',
                  borderRadius: '16px',
                  backgroundColor: tokens.colorNeutralBackground2,
                  color: tokens.colorNeutralForeground1,
                  fontSize: '13px',
                  cursor: 'pointer',
                }}
              >
                <Avatar
                  size={24}
                  name={resource.author.nickname || resource.author.username}
                  image={resource.author.avatar_path ? { src: assetUrl(resource.author.avatar_path) } : undefined}
                />
                {resource.author.nickname || resource.author.username}
              </button>
            )}
            <span title={formatTime(resource.created_at)}>创建于 {relativeTime(resource.created_at)}</span>
            <span title={formatTime(resource.updated_at)}>更新于 {relativeTime(resource.updated_at)}</span>
            {resource.read_level === 0 ? (
              <Badge color="success" appearance="outline">公开</Badge>
            ) : (
              <Badge color="warning" appearance="outline">需权限 {resource.read_level}</Badge>
            )}
          </div>
          {resource.tags && resource.tags.length > 0 && (
            <div className={styles.tags} style={{ marginTop: '10px' }}>
              {resource.tags.map((t) => (
                <Badge
                  key={t.id}
                  appearance="filled"
                  color="informative"
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/?tag=${t.id}`)}
                >
                  {t.name}
                </Badge>
              ))}
            </div>
          )}
          {resource.description && (
            <p className={styles.descBlock} style={{ marginTop: '12px' }}>
              {resource.description.replace(/\s*\n+\s*/g, ' ').trim()}
            </p>
          )}
        </div>
      </div>

      {/* 正文 */}
      {resource.content && (
        <MarkdownView content={resource.content} className={styles.content} />
      )}

      {/* 图集（紧跟正文之后） */}
      {galleryImages.length > 0 && (
        <div className={styles.itemBlock}>
          <div className={styles.itemHeader}>
            <DocumentRegular /> 图集 ({galleryImages.length})
          </div>
          <div className={styles.gallery}>
            {galleryImages.map((img, idx) => (
              <img
                key={img.id}
                className={styles.galleryImg}
                src={assetUrl(img.file_path)}
                alt={`图 ${idx + 1}`}
                loading="lazy"
                onClick={() => setPreviewIndex(idx)}
              />
            ))}
          </div>
        </div>
      )}

      {/* 磁力种子分组 */}
      {mtGroups.map((g, idx) => (
        <div key={g.itemId} className={styles.itemBlock} data-mt-index={idx} data-mt-item-id={g.itemId}>
          <div className={styles.itemHeader}>
            <LinkRegular /> 磁力种子 #{idx + 1}
          </div>
          {g.description && <div className={styles.itemDesc}>{g.description}</div>}
          {g.magnetContent && (
            <div
              className={styles.magnetContent}
              onClick={() => copyMagnet(g.magnetContent)}
              title="点击复制磁力链接"
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
                  ? '下载中...'
                  : fetchState[g.itemId]?.status === 'pending'
                    ? '排队中...'
                    : '获取BT文件'}
              </Button>
              {fetchState[g.itemId]?.status === 'failed' && (
                <span style={{ fontSize: '12px', color: tokens.colorPaletteRedForeground1 }}>
                  {fetchState[g.itemId]?.error || '下载失败'}
                </span>
              )}
              {fetchState[g.itemId]?.status === 'done' && (
                <span style={{ fontSize: '12px', color: tokens.colorPaletteGreenForeground1 }}>
                  已获取，包含 {fetchState[g.itemId]?.count} 个文件
                </span>
              )}
            </div>
          ) : missingIds.has(g.itemId) ? (
            // 种子文件已丢失（被手动删除等）
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <WarningRegular color={tokens.colorPaletteRedForeground1} />
              <span style={{ fontSize: '12px', color: tokens.colorPaletteRedForeground1 }}>
                种子文件已丢失（可能被手动删除）
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
                      ? '重新下载中...'
                      : fetchState[g.itemId]?.status === 'pending'
                        ? '排队中...'
                        : '重新获取BT文件'}
                  </Button>
                  {fetchState[g.itemId]?.status === 'failed' && (
                    <span style={{ fontSize: '12px', color: tokens.colorPaletteRedForeground1 }}>
                      {fetchState[g.itemId]?.error || '下载失败'}
                    </span>
                  )}
                </>
              ) : (
                canArticle && (
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={<EditRegular />}
                    onClick={() => navigate(`/edit/${resource.id}`)}
                  >
                    编辑文章重新上传
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
                onClick={() => setTorrentDialog(g)}
              >
                下载种子
              </Button>
              <Button
                appearance="subtle"
                size="small"
                icon={<DocumentRegular />}
                onClick={() => toggleFiles(g.itemId, g.torrentPath)}
              >
                {filesState[g.itemId]?.expanded ? '收起文件列表' : '查看文件列表'}
              </Button>
              {g.torrentFileName && (
                <span style={{ fontSize: '12px', color: tokens.colorNeutralForeground2 }}>
                  {g.torrentFileName}
                </span>
              )}
            </div>
          )}
          {/* 文件列表 */}
          {filesState[g.itemId]?.expanded && (
            <div className={styles.filesBox}>
              {filesState[g.itemId]?.loading ? (
                <div style={{ padding: '12px', textAlign: 'center', color: tokens.colorNeutralForeground3, fontSize: '13px' }}>
                  解析中...
                </div>
              ) : filesState[g.itemId]?.files.length === 0 ? (
                <div style={{ padding: '12px', textAlign: 'center', color: tokens.colorNeutralForeground3, fontSize: '13px' }}>
                  未解析到文件列表
                </div>
              ) : (
                <>
                  <div className={styles.filesHeader}>
                    <span>
                      {filesState[g.itemId]?.cached ? '（已缓存）' : '（本次解析）'}
                      共 {filesState[g.itemId]?.files.length} 项
                    </span>
                    <span>
                      合计{' '}
                      {formatBytes(
                        filesState[g.itemId]?.files.reduce((s, f) => s + (f.size || 0), 0) || 0,
                      )}
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

      {/* 其他附件 */}
      {otherItems.map((it) => (
        <div key={it.id} className={styles.itemBlock}>
          <div className={styles.itemHeader}>
            {itemIcon(it.type)} {itemLabel(it.type)}
          </div>
          {it.description && <div className={styles.itemDesc}>{it.description}</div>}
          {it.type === 'file' ? (
            missingIds.has(it.id) ? (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <WarningRegular color={tokens.colorPaletteRedForeground1} />
                <span style={{ fontSize: '12px', color: tokens.colorPaletteRedForeground1 }}>
                  附件「{it.file_name || '文件'}」已丢失（可能被手动删除），无法下载
                </span>
                {canArticle && (
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={<EditRegular />}
                    onClick={() => navigate(`/edit/${resource.id}`)}
                  >
                    编辑文章重新上传
                  </Button>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <Button
                  appearance="outline"
                  size="small"
                  icon={<ArrowDownloadRegular />}
                  onClick={() => setTorrentDialog({
                    magnetContent: '',
                    magnetFileName: '',
                    torrentPath: it.file_path,
                    torrentFileName: it.file_name || '附件',
                    description: '',
                    itemId: it.id,
                  })}
                >
                  下载 {it.file_name || '附件'}
                </Button>
              </div>
            )
          ) : (
            <div
              className={styles.magnetContent}
              onClick={() => navigator.clipboard?.writeText(it.content).catch(() => {})}
              title="点击复制"
            >
              <span style={{ flex: 1 }}>{it.content}</span>
              <CopyRegular />
            </div>
          )}
        </div>
      ))}

      {/* 图集预览遮罩（通用组件，与正文图片放大共用） */}
      <ImageLightbox
        images={galleryImages.map((g) => assetUrl(g.file_path))}
        index={previewIndex}
        onIndexChange={setPreviewIndex}
        onClose={() => setPreviewIndex(-1)}
      />

      {/* 下载种子/文件 弹窗 */}
      <Dialog
        open={torrentDialog !== null}
        onOpenChange={(_, e) => { if (!e.open) setTorrentDialog(null); }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>下载文件</DialogTitle>
            <DialogContent>
              <p style={{ margin: 0 }}>
                {torrentDialog?.torrentFileName || '下载文件'}
              </p>
            </DialogContent>
            <DialogActions>
              <DialogTrigger>
                <Button appearance="secondary">取消</Button>
              </DialogTrigger>
              <Button
                icon={<FolderRegular />}
                appearance="outline"
                onClick={async () => {
                  if (!torrentDialog?.torrentPath) return;
                  try {
                    await torrentApi.revealFile(torrentDialog.torrentPath);
                    setTorrentDialog(null);
                  } catch (e: any) {
                    alert(e.message || '定位失败');
                  }
                }}
              >
                定位到文件
              </Button>
              <Button
                icon={<OpenRegular />}
                appearance="primary"
                onClick={async () => {
                  if (!torrentDialog?.torrentPath) return;
                  try {
                    await torrentApi.openFile(torrentDialog.torrentPath);
                    setTorrentDialog(null);
                  } catch (e: any) {
                    alert(e.message || '打开失败');
                  }
                }}
              >
                用默认软件打开
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
