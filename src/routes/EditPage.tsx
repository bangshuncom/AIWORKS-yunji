// 编辑页：拖拽排序附件与图集、上传/删除文件
import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';
import {
  Card,
  Button,
  Dropdown,
  Input,
  Label,
  Option,
  Spinner,
  MessageBar,
  MessageBarBody,
} from '@fluentui/react-components';
import { ArrowLeftRegular, DeleteRegular, ArrowUploadRegular, GlobeRegular } from '@fluentui/react-icons';
import {
  resourceApi,
  imageApi,
  tagApi,
  collectionApi,
  categoryApi,
  authorApi,
  assetUrl,
  collectorApi,
  registerPendingAsset,
  listPendingAssets,
  clearPendingAsset,
} from '../lib/tauri';
import type { CreateItem, Resource, Tag, Image, Collection, Category, AuthorInfo } from '../types/models';
import { usePerms } from '../hooks/usePerms';
import { useAuthStore } from '../stores/authStore';
import { CategoryTreeSelect } from '../components/CategoryTreeSelect';
import { CollectDialog } from '../components/CollectDialog';
import type { CollectApplyPayload } from '../components/CollectDialog';

import { BasicInfoCard } from '../components/editor/BasicInfoCard';
import { ItemsCard } from '../components/editor/ItemsCard';
import { GalleryCard } from '../components/editor/GalleryCard';
import { PillPicker, type PillOption } from '../components/editor/PillPicker';
import {
  useStyles,
  CARD_STYLE,
  THUMB_ACTION_STYLE,
  genId,
  isPendingImage,
  normalizeTagInput,
  type EditItem,
  type EditImage,
} from '../components/editor/shared';
import { SaveProgressDialog, useImageDownloadProgress, type ProgressRow } from '../components/editor/ImageProgress';
import { errorText } from '../lib/errors';
import { invalidateArticleData } from '../lib/invalidate';

export function EditPage() {
  const styles = useStyles();
  const { rid } = useParams<{ rid: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const initialRid = rid ? Number(rid) : NaN;
  const [currentRid, setCurrentRid] = useState<number>(initialRid);
  const ridNum = currentRid;
  const isEdit = !Number.isNaN(ridNum) && ridNum > 0;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [readLevel, setReadLevel] = useState(0);
  const [accessPassword, setAccessPassword] = useState('');
  // 服务端记录的密码状态：是否已设置（不回传密码本身）
  const [hasPassword, setHasPassword] = useState(false);
  // 本次保存是否清除访问密码
  const [clearPassword, setClearPassword] = useState(false);
  const [thumbnailPath, setThumbnailPath] = useState('');
  // 管理员马甲：可选其他用户身份发布
  const isAdmin = usePerms().isAdmin;
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [authorId, setAuthorId] = useState<number | null>(null);
  const { data: authors } = useQuery<AuthorInfo[]>({
    queryKey: ['authors'],
    queryFn: authorApi.list,
    enabled: isAdmin,
  });
  // 选中但尚未上传的本地封面（保存时才上传）
  const [pendingThumbnail, setPendingThumbnail] = useState<string | null>(null);
  // 采集回填的远程封面：仅登记地址，保存时才下载本地化
  const [pendingRemoteThumb, setPendingRemoteThumb] = useState<{ url: string; referer: string } | null>(null);
  // 保存期间是否正在下载远程图片（用于显示进度并挡住表单）
  const [savingRemote, setSavingRemote] = useState(false);
  // 下载开始时快照的进度行（下载途中 pendingRemoteThumb 会被清空，不能用实时值渲染）
  const [savingRows, setSavingRows] = useState<ProgressRow[]>([]);
  // 远程图片下载进度（订阅后端 collector-progress）
  const imgProgress = useImageDownloadProgress();
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [newTagNames, setNewTagNames] = useState('');
  const [collectionIds, setCollectionIds] = useState<number[]>([]);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [items, setItems] = useState<EditItem[]>([]);
  const [gallery, setGallery] = useState<EditImage[]>([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(!isEdit);
  const [collectOpen, setCollectOpen] = useState(false);

  // 拖拽传感器
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const { data: resource, error: loadError } = useQuery<Resource>({
    queryKey: ['resource', ridNum],
    queryFn: () => resourceApi.get(ridNum),
    enabled: isEdit,
    retry: false,
  });

  const { data: images } = useQuery<Image[]>({
    queryKey: ['resource-images', ridNum],
    queryFn: () => imageApi.listResourceImages(ridNum),
    enabled: isEdit,
  });

  const { data: tags } = useQuery<Tag[]>({
    queryKey: ['tags'],
    queryFn: tagApi.list,
  });

  const { data: collections } = useQuery<Collection[]>({
    queryKey: ['collections'],
    queryFn: collectionApi.list,
  });
  const collectionOptions = useMemo<PillOption[]>(
    () => (collections ?? []).map((c) => ({ id: c.id, label: c.title, count: c.resource_count })),
    [collections],
  );
  const { data: categoriesTree } = useQuery<Category[]>({
    queryKey: ['categories-tree'],
    queryFn: categoryApi.listTree,
  });

  useEffect(() => {
    if (isEdit && resource && !loaded) {
      setTitle(resource.title);
      setDescription(resource.description);
      setContent(resource.content);
      setReadLevel(resource.read_level ?? 0);
      setHasPassword(!!resource.has_password);
      setThumbnailPath(resource.thumbnail_path);
      setAuthorId(resource.user_id ?? null);
      setTagIds(resource.tags?.map((t) => t.id) ?? []);
      setCollectionIds(resource.collections?.map((c) => c.id) ?? []);
      setCategoryId(resource.category?.id ?? null);
      setItems(
        resource.items?.map((it) => ({
          _id: genId(),
          type: it.type as CreateItem['type'],
          content: it.content,
          description: it.description,
          file_path: it.file_path,
          file_name: it.file_name,
        })) ?? [],
      );
      setLoaded(true);
    }
  }, [isEdit, resource, loaded]);

  useEffect(() => {
    if (isEdit && images && loaded) {
      // 以服务端为准，但保留尚未落库的项（本地待上传 / 远程未下载成功），
      // 否则保存后的一次 refetch 会把「待本地化」的图从界面上抹掉，用户就没法重试了
      setGallery((prev) => {
        const pending = prev.filter(isPendingImage);
        const server = images.map((im) => ({ id: im.id, file_path: im.file_path }));
        return pending.length > 0 ? [...server, ...pending] : server;
      });
    }
  }, [isEdit, images, loaded]);

  // 文件上传
  const pickFile = async (extensions?: string[]) => {
    const selected = await openDialog({
      multiple: false,
      filters: extensions ? [{ name: '文件', extensions }] : undefined,
    });
    return typeof selected === 'string' ? selected : null;
  };

  const pickImages = async () => {
    const selected = await openDialog({
      multiple: true,
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
    });
    if (!selected) return [];
    return Array.isArray(selected) ? selected : [selected];
  };

  // 选择封面：仅本地暂存预览，保存时才上传（会顶掉采集来的远程封面）
  const uploadThumbnail = async () => {
    const filePath = await pickFile(['jpg', 'jpeg', 'png', 'webp']);
    if (!filePath) return;
    setPendingRemoteThumb(null);
    setPendingThumbnail(filePath);
  };

  const clearThumbnail = async () => {
    // 先清除「尚未落库」的暂存封面（本地文件 / 采集来的远程地址）
    if (pendingRemoteThumb) {
      setPendingRemoteThumb(null);
      return;
    }
    if (pendingThumbnail) {
      setPendingThumbnail(null);
      return;
    }
    try {
      if (isEdit && thumbnailPath) {
        await imageApi.clearResourceThumbnail(ridNum);
        queryClient.invalidateQueries({ queryKey: ['resource', ridNum] });
      }
      setThumbnailPath('');
    } catch (e: any) {
      setError(e.message || '清除失败');
    }
  };

  // 选择图集图片：仅本地暂存预览，保存时才上传（无需先有标题/rid）
  const uploadGallery = async () => {
    const files = await pickImages();
    if (files.length === 0) return;
    const temps: EditImage[] = files.map((fp) => ({
      id: `temp_${genId()}`,
      file_path: '',
      localPath: fp,
    }));
    setGallery((g) => [...g, ...temps]);
  };

  const deleteGalleryImage = async (img: EditImage) => {
    // 尚未落库的图（本地待上传 / 远程待本地化）：直接从列表移除即可
    if (isPendingImage(img)) {
      setGallery((g) => g.filter((im) => im.id !== img.id));
      return;
    }
    if (!isEdit) return;
    try {
      await imageApi.deleteResourceImage(Number(img.id));
      setGallery((g) => g.filter((im) => im.id !== img.id));
    } catch (e: any) {
      setError(e.message || '删除失败');
    }
  };

  // Markdown 正文内选择图片/附件：仅注册本地暂存（插入占位符），保存时才上传
  const uploadContentAsset = async (kind: 'image' | 'file') => {
    const selected = await openDialog({
      multiple: false,
      filters: kind === 'image' ? [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }] : undefined,
    });
    if (typeof selected !== 'string') return null;
    const name = selected.split(/[\\/]/).pop() || 'file';
    const marker = registerPendingAsset(selected);
    return { path: marker, name };
  };

  // 附件管理
  const addItem = (type: CreateItem['type']) => {
    setItems((arr) => [
      ...arr,
      { _id: genId(), type, content: '', description: '', file_path: '', file_name: '', _isNew: true },
    ]);
  };

  const updateItem = (id: string, patch: Partial<EditItem>) => {
    setItems((arr) => arr.map((it) => (it._id === id ? { ...it, ...patch } : it)));
  };

  const removeItem = (id: string) => {
    setItems((arr) => arr.filter((it) => it._id !== id));
  };

  const uploadItemFile = async (id: string) => {
    const filePath = await pickFile();
    if (!filePath) return;
    const fileName = filePath.split(/[\\/]/).pop() || 'file';
    // 仅本地暂存，保存时才上传
    updateItem(id, { file_path: '', file_name: fileName, localFilePath: filePath });
  };

  const uploadTorrent = async (id: string) => {
    const filePath = await pickFile(['torrent']);
    if (!filePath) return;
    const fileName = filePath.split(/[\\/]/).pop() || 'file.torrent';
    // 仅本地暂存，保存时才上传
    updateItem(id, { file_path: '', file_name: fileName, localFilePath: filePath });
  };

  // dnd-kit 拖拽结束处理
  const handleItemDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setItems((arr) => {
      const oldIndex = arr.findIndex((it) => it._id === active.id);
      const newIndex = arr.findIndex((it) => it._id === over.id);
      if (oldIndex < 0 || newIndex < 0) return arr;
      return arrayMove(arr, oldIndex, newIndex);
    });
  };

  const handleGalleryDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = gallery.findIndex((im) => String(im.id) === active.id);
    const newIndex = gallery.findIndex((im) => String(im.id) === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const newGallery = arrayMove(gallery, oldIndex, newIndex);
    setGallery(newGallery);
    // 存在尚未上传的本地图片时，排序在保存时统一提交
    if (isEdit && newGallery.every((im) => !im.localPath)) {
      const ordered = newGallery.map((im) => Number(im.id));
      imageApi.reorderResourceImages(ridNum, ordered).catch(() => {});
    }
  };

  // 过滤无效附件项 + 磁力格式校验（保留 localFilePath，由调用方在保存时上传）
  const validateAndFilterItems = (): EditItem[] | null => {
    const valid = items.filter((it) => {
      if (it.type === 'magnet_torrent') {
        // 必须至少有磁力链接或种子文件之一
        return (it.content && it.content.trim()) || it.file_path || it.localFilePath;
      }
      if (it.type === 'link' || it.type === 'ed2k' || it.type === 'direct_link') {
        return it.content && it.content.trim();
      }
      if (it.type === 'file') {
        return it.file_path || it.localFilePath;
      }
      return false;
    });
    // 磁力链接格式校验
    for (const it of valid) {
      if (it.type === 'magnet_torrent' && it.content) {
        const v = it.content.trim();
        if (v && !/^magnet:\?xt=urn:btih:([a-fA-F0-9]{40}|[A-Za-z2-7]{32})/.test(v)) {
          setError('磁力链接格式错误：应以 magnet:?xt=urn:btih: 开头');
          return null;
        }
      }
    }
    return valid;
  };

  // 校验附件，并把本地暂存文件上传后组装成提交结构
  const prepareItems = async (): Promise<CreateItem[] | null> => {
    const valid = validateAndFilterItems();
    if (valid === null) return null;
    return Promise.all(
      valid.map(async (it) => {
        let filePath = it.file_path;
        if (it.localFilePath) {
          const subdir = it.type === 'magnet_torrent' ? 'torrents' : 'files';
          filePath = await resourceApi.uploadFile(it.localFilePath, subdir);
          // 写回 state，失败重试时不重复上传
          updateItem(it._id, { file_path: filePath, localFilePath: undefined });
        }
        return {
          type: it.type,
          content: it.content?.trim() ?? '',
          description: it.description ?? '',
          file_path: filePath,
          file_name: it.file_name ?? '',
        };
      }),
    );
  };

  // 批量创建新标签，返回合并后的 tag_ids
  const resolveTagIds = async (): Promise<number[]> => {
    const names = normalizeTagInput(newTagNames)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length === 0) return tagIds;
    const newIds: number[] = [];
    for (const name of names) {
      // 已存在同名标签则复用
      const existing = tags?.find((t) => t.name === name);
      if (existing) {
        newIds.push(existing.id);
      } else {
        try {
          const id = await tagApi.create(name);
          newIds.push(id);
        } catch {
          // 创建失败跳过
        }
      }
    }
    const merged = new Set([...tagIds, ...newIds]);
    return Array.from(merged);
  };

  // 网页采集回填：只往表单写值——不落库、不下载图片。
  // 这样在采集弹窗里反复预览/取消都不会留下半成品文章，也为「保存是唯一落库点」这条规则兜底。
  const handleCollectApply = async (p: CollectApplyPayload) => {
    // 页面没提取到标题、表单也空时，保存必然失败（保存按钮也依赖标题），提前给出指引
    const nextTitle = p.title.trim() || title.trim();
    if (!nextTitle) {
      throw new Error('未能从该页面提取到标题：请先在「标题」一栏填写，再点确认回填');
    }
    setTitle(nextTitle);
    // 游戏简介写入文章正文（已有正文时不覆盖）
    if (p.content && !content.trim()) setContent(p.content);

    // 磁力 + 来源链接写入附件（按内容去重）
    if (p.sourceUrl || p.magnets.length > 0) {
      setItems((arr) => {
        const have = new Set(arr.map((it) => it.content.trim()));
        const next = [...arr];
        if (p.sourceUrl && !have.has(p.sourceUrl.trim())) {
          next.push({
            _id: genId(),
            type: 'link',
            content: p.sourceUrl,
            description: '来源链接',
            file_path: '',
            file_name: '',
            _isNew: true,
          });
        }
        for (const m of p.magnets) {
          if (!have.has(m.trim())) {
            next.push({
              _id: genId(),
              type: 'magnet_torrent',
              content: m,
              description: '',
              file_path: '',
              file_name: '',
              _isNew: true,
            });
          }
        }
        return next;
      });
    }

    // 封面：登记为「待本地化」（保存时才下载），保留防盗链所需的 Referer
    if (p.thumbnailUrl) {
      setPendingRemoteThumb({ url: p.thumbnailUrl, referer: p.referer });
    }

    // 图集：同样只登记远程地址，并按地址去重（重复采集同一页不会重复添加）
    if (p.imageUrls.length > 0) {
      setGallery((g) => {
        const have = new Set(g.map((im) => im.remoteUrl).filter((u): u is string => !!u));
        const add: EditImage[] = p.imageUrls
          .filter((u) => !have.has(u))
          .map((u) => ({
            id: `remote_${genId()}`,
            file_path: '',
            remoteUrl: u,
            remoteReferer: p.referer,
          }));
        return add.length > 0 ? [...g, ...add] : g;
      });
    }
  };

  // 保存
  const saveMut = useMutation({
    mutationFn: async () => {
      // 1. 校验附件并上传本地暂存的附件/种子
      const submitItems = await prepareItems();
      if (submitItems === null) return;
      const resolvedTagIds = await resolveTagIds();

      // 2. 上传正文内本地暂存的图片/附件，替换占位符为存储相对路径
      let finalContent = content;
      for (const [token, localPath] of listPendingAssets()) {
        const marker = `__pending__/${token}/file`;
        if (!finalContent.includes(marker)) {
          clearPendingAsset(token);
          continue;
        }
        const relPath = await resourceApi.uploadFile(localPath, 'content');
        finalContent = finalContent.split(marker).join(relPath);
        clearPendingAsset(token);
      }
      setContent(finalContent);

      // 3. 新建：创建文章拿到 id。
      // 这是全流程唯一的落库点——采集回填、选本地图都不建文章，因此这里也是
      // 「封面/图集需要 rid」这一依赖成立的地方。
      let savedId = ridNum;
      if (!isEdit) {
        savedId = await resourceApi.create({
          title: title.trim(),
          description: description.trim(),
          content: finalContent.trim(),
          read_level: readLevel,
          access_password: accessPassword,
          clear_password: clearPassword || undefined,
          // 有待传封面（本地文件或远程地址）时先留空，处理完成后写回
          thumbnail_path: pendingThumbnail || pendingRemoteThumb ? '' : thumbnailPath,
          tag_ids: resolvedTagIds,
          collection_ids: collectionIds,
          category_id: categoryId,
          items: submitItems,
          author_id: isAdmin && authorId != null && authorId !== currentUserId ? authorId : undefined,
        });
        setCurrentRid(savedId);
      }

      // 4. 封面：本地暂存文件上传
      let finalThumbnail = thumbnailPath;
      if (pendingThumbnail) {
        finalThumbnail = await imageApi.setResourceThumbnail(savedId, pendingThumbnail);
        setThumbnailPath(finalThumbnail);
        setPendingThumbnail(null);
      }

      // 5. 图集：本地暂存图片上传（并发）。临时 id -> 真实 id / 相对路径
      const resolved = new Map<string, { realId: number; filePath: string }>();
      const localPending = gallery.filter((im) => im.localPath);
      const uploaded = await Promise.all(
        localPending.map(async (im) => {
          const r = await imageApi.uploadResourceImage(savedId, im.localPath!);
          return { tempId: String(im.id), realId: r.id, filePath: r.file_path };
        }),
      );
      for (const u of uploaded) resolved.set(u.tempId, { realId: u.realId, filePath: u.filePath });

      // 6. 远程封面/图集：此刻才下载本地化（图床慢，全程推送进度）
      const problems: string[] = [];
      const remoteGallery = gallery.filter((im) => im.remoteUrl);
      const rows: ProgressRow[] = [
        ...(pendingRemoteThumb ? [{ key: 'cover-0', label: '封面图' }] : []),
        ...remoteGallery.map((_, i) => ({ key: `image-${i}`, label: `图集 ${i + 1}` })),
      ];
      if (rows.length > 0) {
        setSavingRows(rows);
        imgProgress.reset();
        setSavingRemote(true);
        try {
          await imgProgress.track(async () => {
            if (pendingRemoteThumb) {
              try {
                const saved = await collectorApi.setThumbnail(
                  savedId,
                  pendingRemoteThumb.url,
                  pendingRemoteThumb.referer,
                );
                finalThumbnail = saved;
                setThumbnailPath(saved);
                setPendingRemoteThumb(null);
              } catch (e) {
                problems.push(`封面下载失败：${errorText(e) || '未知错误'}`);
              }
            }
            if (remoteGallery.length > 0) {
              try {
                const res = await collectorApi.addImages(
                  savedId,
                  remoteGallery.map((im) => im.remoteUrl!),
                  remoteGallery[0].remoteReferer ?? '',
                );
                // 后端按来源地址回传结果，据此把占位项换成真实记录
                for (const im of res.images) {
                  const hit = remoteGallery.find((g) => g.remoteUrl === im.source_url);
                  if (hit) resolved.set(String(hit.id), { realId: im.id, filePath: im.file_path });
                }
                for (const f of res.failed) problems.push(`${f.url} 下载失败：${f.error}`);
              } catch (e) {
                problems.push(`图集下载失败：${errorText(e) || '未知错误'}`);
              }
            }
          });
        } finally {
          setSavingRemote(false);
        }
      }

      // 7. 把已落库的项写回列表（失败项保持「待本地化」，下次保存会重试）
      if (resolved.size > 0) {
        setGallery((g) =>
          g.map((im) => {
            const r = resolved.get(String(im.id));
            return r ? { id: r.realId, file_path: r.filePath } : im;
          }),
        );
      }

      // 8. 按当前显示顺序提交排序（只提交已落库的项，未成功的不参与）
      const orderedIds = gallery
        .map((im) => resolved.get(String(im.id))?.realId ?? (typeof im.id === 'number' ? im.id : NaN))
        .filter((n) => Number.isFinite(n));
      if (orderedIds.length > 0) {
        await imageApi.reorderResourceImages(savedId, orderedIds);
      }

      // 封面回退：未设置封面时，取图集第一张（不复制文件，直接引用）；
      // 图集也没有则取正文 Markdown 首图（正文图片已在步骤 2 上传为相对路径）
      if (!finalThumbnail) {
        const firstGallery = gallery.find((im) => {
          const r = resolved.get(String(im.id));
          return r != null || typeof im.id === 'number';
        });
        if (firstGallery) {
          finalThumbnail = resolved.get(String(firstGallery.id))?.filePath ?? firstGallery.file_path;
        } else {
          const m = finalContent.match(/!\[[^\]]*\]\(([^)\s]+)\)/);
          if (m && !/^https?:\/\//i.test(m[1]) && !m[1].startsWith('__pending__')) {
            finalThumbnail = m[1];
          }
        }
        if (finalThumbnail) setThumbnailPath(finalThumbnail);
      }

      // 9. 编辑已有文章，或新建时带封面/回退出封面：更新正文等字段
      if (isEdit || pendingThumbnail || pendingRemoteThumb || finalThumbnail) {
        await resourceApi.update(savedId, {
          title: title.trim(),
          description: description.trim(),
          content: finalContent.trim(),
          read_level: readLevel,
          access_password: accessPassword,
          clear_password: clearPassword || undefined,
          thumbnail_path: finalThumbnail,
          tag_ids: resolvedTagIds,
          collection_ids: collectionIds,
          category_id: categoryId,
          items: submitItems,
          author_id: isAdmin && authorId != null && authorId !== currentUserId ? authorId : undefined,
        });
      }
      return { savedId, problems };
    },
    onSuccess: (res) => {
      // prepareItems 校验失败会提前中止（错误提示已由校验函数给出）
      if (!res) return;
      const { savedId, problems } = res;
      // 分类/合集/作者的计数都随本篇变化，统一失效（单靠 ['resources'] 不会刷新导航计数）
      invalidateArticleData(queryClient);
      queryClient.invalidateQueries({ queryKey: ['resource', savedId] });
      queryClient.invalidateQueries({ queryKey: ['resource-images', savedId] });
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      // 有图片没能本地化时留在编辑页：失败项仍是「待本地化」，再点一次保存即可重试
      if (problems.length > 0) {
        setError(`已保存，但图片未能全部本地化：${problems.join('；')}`);
        return;
      }
      navigate(`/detail/${savedId}`);
    },
    onError: (e: Error) => setError(e.message || '保存失败'),
  });

  // 取数失败（如无阅读权限）时不要一直转圈
  if (isEdit && !loaded) {
    if (loadError) {
      return (
        <MessageBar intent="error">
          <MessageBarBody>{errorText(loadError) || '加载文章失败'}</MessageBarBody>
        </MessageBar>
      );
    }
    return <Spinner label="加载中..." />;
  }

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <Button appearance="subtle" icon={<ArrowLeftRegular />} onClick={() => navigate(-1)}>
          返回
        </Button>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button icon={<GlobeRegular />} onClick={() => setCollectOpen(true)}>
            网页采集
          </Button>
          <Button appearance="primary" onClick={() => saveMut.mutate()} disabled={saveMut.isPending || !title.trim()}>
            {saveMut.isPending ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>

      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      <BasicInfoCard
        values={{ title, description, content, tagIds, newTagNames }}
        onChange={(p) => {
          if (p.title !== undefined) setTitle(p.title);
          if (p.description !== undefined) setDescription(p.description);
          if (p.content !== undefined) setContent(p.content);
          if (p.tagIds !== undefined) setTagIds(p.tagIds);
          if (p.newTagNames !== undefined) setNewTagNames(p.newTagNames);
        }}
        tags={tags}
        uploadContentAsset={uploadContentAsset}
      />

      {/* 元数据：缩略图在最前，右列自上而下为 阅读权限 / 马甲 → 分类 / 访问密码 → 合集 */}
      <Card style={CARD_STYLE}>
        <div className={styles.metaGrid}>
          <div className={styles.field}>
            <Label>
              缩略图
              {pendingThumbnail ? '（保存后上传）' : pendingRemoteThumb ? '（保存后从远程下载）' : ''}
            </Label>
            <div className={styles.thumbBox}>
              {pendingThumbnail || pendingRemoteThumb || thumbnailPath ? (
                <img
                  className={styles.thumb}
                  src={
                    pendingThumbnail
                      ? convertFileSrc(pendingThumbnail)
                      : pendingRemoteThumb
                        ? pendingRemoteThumb.url
                        : assetUrl(thumbnailPath)
                  }
                  alt="缩略图"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className={styles.thumbEmpty}>无</div>
              )}
              <div className={styles.thumbActions}>
                <Button
                  appearance="outline"
                  size="small"
                  style={THUMB_ACTION_STYLE}
                  icon={<ArrowUploadRegular />}
                  onClick={uploadThumbnail}
                >
                  {pendingThumbnail || pendingRemoteThumb ? '选择' : '上传'}
                </Button>
                {(pendingThumbnail || pendingRemoteThumb || thumbnailPath) && (
                  <Button
                    appearance="subtle"
                    size="small"
                    style={THUMB_ACTION_STYLE}
                    icon={<DeleteRegular />}
                    onClick={clearThumbnail}
                  >
                    清除
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className={styles.metaFields}>
            {/* 阅读权限与马甲同属「谁能看到这篇」，并排放在最上方 */}
            <div className={styles.row}>
              <div className={styles.field}>
                <Label>阅读权限</Label>
                <Dropdown
                  value={readLevel === 0 ? '0 - 公开（无需登录）' : `${readLevel} - 需权限 ${readLevel} 及以上`}
                  selectedOptions={[String(readLevel)]}
                  onOptionSelect={(_, d) => {
                    if (d.optionValue) setReadLevel(Number(d.optionValue));
                  }}
                >
                  <Option value="0" text="0 - 公开（无需登录）">
                    0 - 公开（无需登录）
                  </Option>
                  <Option value="1" text="1 - 需权限 1 及以上">
                    1 - 需权限 1 及以上
                  </Option>
                  <Option value="2" text="2 - 需权限 2 及以上">
                    2 - 需权限 2 及以上
                  </Option>
                  <Option value="3" text="3 - 需权限 3 及以上">
                    3 - 需权限 3 及以上
                  </Option>
                  <Option value="4" text="4 - 需权限 4 及以上">
                    4 - 需权限 4 及以上
                  </Option>
                  <Option value="5" text="5 - 需权限 5（默认仅管理员）">
                    5 - 需权限 5（默认仅管理员）
                  </Option>
                </Dropdown>
              </div>
              {isAdmin && (
                <div className={styles.field}>
                  <Label>发布身份（马甲）</Label>
                  <Dropdown
                    value={
                      authorId == null
                        ? '当前账号'
                        : (() => {
                            const a = authors?.find((x) => x.id === authorId);
                            return a ? a.nickname || a.username : `用户 #${authorId}`;
                          })()
                    }
                    selectedOptions={[String(authorId ?? 'me')]}
                    onOptionSelect={(_, d) => {
                      const v = d.optionValue;
                      setAuthorId(v === 'me' ? null : Number(v));
                    }}
                  >
                    <Option value="me" text="当前账号">
                      当前账号
                    </Option>
                    {authors?.map((a) => (
                      <Option key={a.id} value={String(a.id)} text={a.nickname || a.username}>
                        {a.nickname || a.username}
                      </Option>
                    ))}
                  </Dropdown>
                </div>
              )}
            </div>

            {/* 分类与访问密码并排：两者都是单行控件，纵向各占一行会显得松散 */}
            <div className={styles.row}>
              <div className={styles.field}>
                <Label>分类</Label>
                <CategoryTreeSelect
                  categories={categoriesTree}
                  value={categoryId}
                  onChange={setCategoryId}
                  placeholder="选择分类（可选）"
                  emptyLabel="（无分类）"
                  showCount
                  style={{ width: '100%' }}
                />
              </div>

              <div className={styles.field}>
                <Label htmlFor="pwd">访问密码</Label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  {/* flex:1 + minWidth:0：输入框随列宽伸缩，且并排放按钮时不会被自身最小宽度顶出列外 */}
                  <Input
                    id="pwd"
                    type="password"
                    placeholder={hasPassword ? '已设置密码，留空则不修改' : '留空 = 不设密码'}
                    value={accessPassword}
                    onChange={(_, d) => {
                      setAccessPassword(d.value);
                      setClearPassword(false);
                    }}
                    style={{ flex: 1, minWidth: 0 }}
                  />
                  {hasPassword && (
                    <Button
                      appearance="outline"
                      style={{ flexShrink: 0 }}
                      onClick={() => {
                        setClearPassword(!clearPassword);
                        setAccessPassword('');
                      }}
                    >
                      {clearPassword ? '撤销清除' : '清除密码'}
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <div className={styles.field}>
              <Label>合集</Label>
              <PillPicker
                options={collectionOptions}
                selectedIds={collectionIds}
                onChange={setCollectionIds}
                searchPlaceholder="搜索合集：输入即过滤，点击结果即可选中"
                emptyHint="还没有合集，可先在合集页面创建"
                noMatchHint="没有匹配的合集"
              />
            </div>
          </div>
        </div>
      </Card>

      <ItemsCard
        items={items}
        sensors={sensors}
        onAdd={addItem}
        onRemove={removeItem}
        onUpdate={updateItem}
        onUploadTorrent={uploadTorrent}
        onUploadFile={uploadItemFile}
        onDragEnd={handleItemDragEnd}
      />

      <GalleryCard
        images={gallery}
        sensors={sensors}
        onUpload={uploadGallery}
        onDelete={deleteGalleryImage}
        onDragEnd={handleGalleryDragEnd}
      />

      {collectOpen && (
        <CollectDialog
          hasThumbnail={!!(thumbnailPath || pendingThumbnail || pendingRemoteThumb)}
          onClose={() => setCollectOpen(false)}
          onApply={handleCollectApply}
        />
      )}

      {/* 保存期间下载远程图片：阻塞式进度，避免边改边存 */}
      <SaveProgressDialog
        open={savingRemote}
        rows={savingRows}
        proxy={imgProgress.proxy}
        progress={imgProgress.progress}
      />
    </div>
  );
}
