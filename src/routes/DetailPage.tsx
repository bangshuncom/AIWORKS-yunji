// 详情页：头部 + 正文 + 图集 + 磁力种子 + 其他附件
// 各区块实现在 components/details/ 下，本页负责取数与编排
import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Spinner, MessageBar, MessageBarBody, tokens } from '@fluentui/react-components';
import {
  ArrowLeftRegular,
  DeleteRegular,
  DocumentRegular,
  EditRegular,
  KeyRegular,
  LockClosedRegular,
} from '@fluentui/react-icons';
import { resourceApi, imageApi, torrentApi, assetUrl } from '../lib/tauri';
import { confirmDanger, notifyError } from '../lib/dialog';
import { isForbidden, errorText } from '../lib/errors';
import { invalidateArticleData } from '../lib/invalidate';
import { PasswordDialog } from '../components/common/PasswordDialog';
import { usePerms } from '../hooks/usePerms';
import { useLanguage } from '../i18n';
import type { Image, ResourceItem } from '../types/models';
import { MarkdownView } from '../components/MarkdownView';
import { ImageLightbox } from '../components/ImageLightbox';
import { ResourceHeader } from '../components/details/ResourceHeader';
import { MagnetSection } from '../components/details/MagnetSection';
import { AttachmentsSection } from '../components/details/AttachmentsSection';
import { TorrentDownloadDialog } from '../components/details/TorrentDownloadDialog';
import { useStyles, extractMagnetFilename, type MtGroup } from '../components/details/shared';

export function DetailPage() {
  const styles = useStyles();
  const { rid } = useParams<{ rid: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can: canFeature } = usePerms();
  const { t } = useLanguage();
  const canArticle = canFeature('article');
  const [previewIndex, setPreviewIndex] = useState<number>(-1);
  // 下载种子/附件弹窗：当前操作的条目
  const [torrentDialog, setTorrentDialog] = useState<MtGroup | null>(null);
  // 关联文件丢失（被手动删除）的 item id 集合
  const [missingIds, setMissingIds] = useState<Set<number>>(new Set());
  // 访问密码：无权限时自动弹一次密码框
  const [pwdOpen, setPwdOpen] = useState(false);
  // 已通过密码校验但仍读不到内容 = 权限等级不足
  const [pwdPassed, setPwdPassed] = useState(false);

  const ridNum = Number(rid);

  const {
    data: resource,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['resource', ridNum],
    queryFn: () => resourceApi.get(ridNum),
    enabled: !!rid && !Number.isNaN(ridNum),
    // 权限不足属于预期结果，不必重试
    retry: (count, e) => !isForbidden(e) && count < 2,
  });

  // 受保护内容：首次进入自动弹出密码框
  useEffect(() => {
    if (isForbidden(error) && !pwdPassed) setPwdOpen(true);
  }, [error, pwdPassed]);

  // 切换到其他资源时重置解锁状态
  useEffect(() => {
    setPwdPassed(false);
    setPwdOpen(false);
  }, [ridNum]);

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

  if (isLoading) {
    return <Spinner label={t('common.loading')} />;
  }

  if (!resource) {
    // 阅读权限不足 / 未解锁：给出访问密码入口
    if (isForbidden(error)) {
      return (
        <div className={styles.container}>
          <Button appearance="subtle" icon={<ArrowLeftRegular />} onClick={() => navigate('/')}>
            {t('detail.back')}
          </Button>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '12px',
              padding: '48px 24px',
              textAlign: 'center',
              border: `1px solid ${tokens.colorNeutralStroke2}`,
              borderRadius: '12px',
              backgroundColor: tokens.colorNeutralBackground1,
            }}
          >
            <LockClosedRegular style={{ fontSize: '32px', color: tokens.colorNeutralForeground3 }} />
            <div style={{ fontSize: '16px', fontWeight: 600 }}>{t('detail.protected')}</div>
            <div style={{ fontSize: '13px', color: tokens.colorNeutralForeground3 }}>
              {pwdPassed ? t('detail.pwdPassedInsufficient') : t('detail.pwdHint')}
            </div>
            <Button appearance="primary" icon={<KeyRegular />} onClick={() => setPwdOpen(true)}>
              {t('detail.inputPassword')}
            </Button>
          </div>
          <PasswordDialog
            open={pwdOpen}
            title={t('detail.inputPassword')}
            onSubmit={(pwd) => resourceApi.checkAccess(ridNum, pwd)}
            onUnlocked={() => {
              setPwdPassed(true);
              void refetch();
            }}
            onClose={() => setPwdOpen(false)}
          />
        </div>
      );
    }
    return (
      <MessageBar intent="warning">
        <MessageBarBody>{errorText(error) || t('detail.notFound')}</MessageBarBody>
      </MessageBar>
    );
  }

  return (
    <div className={styles.container}>
      {/* 顶部工具栏：返回居左，编辑/删除居右 */}
      <div className={styles.toolbar}>
        <Button appearance="subtle" icon={<ArrowLeftRegular />} onClick={() => navigate('/')}>
          {t('detail.back')}
        </Button>
        {canArticle && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button appearance="outline" icon={<EditRegular />} onClick={() => navigate(`/edit/${resource.id}`)}>
              {t('list.edit')}
            </Button>
            <Button
              appearance="outline"
              icon={<DeleteRegular />}
              onClick={async () => {
                if (!(await confirmDanger(t('list.moveToTrash', { title: resource.title })))) return;
                try {
                  await resourceApi.delete(resource.id);
                  // 分类导航的计数等聚合数据都依赖本篇，先失效再跳走（导航栏常驻，不会自己重挂载）
                  invalidateArticleData(queryClient);
                  navigate('/');
                } catch (e) {
                  await notifyError(errorText(e) || t('detail.deleteFailed'));
                }
              }}
            >
              {t('list.delete')}
            </Button>
          </div>
        )}
      </div>

      <ResourceHeader resource={resource} />

      {/* 正文 */}
      {resource.content && <MarkdownView content={resource.content} className={styles.content} />}

      {/* 图集（紧跟正文之后） */}
      {galleryImages.length > 0 && (
        <div className={styles.itemBlock}>
          <div className={styles.itemHeader}>
            <DocumentRegular /> {t('detail.gallery', { count: galleryImages.length })}
          </div>
          <div className={styles.gallery}>
            {galleryImages.map((img, idx) => (
              <img
                key={img.id}
                className={styles.galleryImg}
                src={assetUrl(img.file_path)}
                alt={t('detail.imageAlt', { n: idx + 1 })}
                loading="lazy"
                onClick={() => setPreviewIndex(idx)}
              />
            ))}
          </div>
        </div>
      )}

      {/* 磁力种子分组 */}
      <MagnetSection
        rid={ridNum}
        resourceId={resource.id}
        groups={mtGroups}
        missingIds={missingIds}
        canArticle={canArticle}
        onOpenTorrent={setTorrentDialog}
      />

      {/* 其他附件 */}
      <AttachmentsSection
        items={otherItems}
        resourceId={resource.id}
        missingIds={missingIds}
        canArticle={canArticle}
        onOpenTorrent={setTorrentDialog}
      />

      {/* 图集预览遮罩（通用组件，与正文图片放大共用） */}
      <ImageLightbox
        images={galleryImages.map((g) => assetUrl(g.file_path))}
        index={previewIndex}
        onIndexChange={setPreviewIndex}
        onClose={() => setPreviewIndex(-1)}
      />

      <TorrentDownloadDialog target={torrentDialog} onClose={() => setTorrentDialog(null)} />
    </div>
  );
}
