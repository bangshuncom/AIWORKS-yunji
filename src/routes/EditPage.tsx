// 编辑页：拖拽排序附件与图集、上传/删除文件
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';
import {
  Card,
  Input,
  Button,
  Label,
  Textarea,
  Dropdown,
  Option,
  Badge,
  Spinner,
  MessageBar,
  MessageBarBody,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowLeftRegular,
  DeleteRegular,
  ArrowUploadRegular,
  ReOrderDotsVerticalRegular,
  AddCircleRegular,
  GlobeRegular,
} from '@fluentui/react-icons';
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
import { MarkdownEditor } from '../components/MarkdownEditor';
import { CategoryTreeSelect } from '../components/CategoryTreeSelect';
import { CollectDialog } from '../components/CollectDialog';
import type { CollectApplyPayload } from '../components/CollectDialog';

const useStyles = makeStyles({
  container: { display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '900px' },
  toolbar: { display: 'flex', alignItems: 'center', gap: '8px' },
  field: { display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  itemBlock: {
    padding: '12px',
    borderRadius: '8px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  itemHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
  },
  thumbRow: { display: 'flex', gap: '12px', alignItems: 'center' },
  thumb: { width: '120px', height: '90px', objectFit: 'cover', borderRadius: '6px', backgroundColor: tokens.colorNeutralBackground3 },
  gallery: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  galleryItem: {
    position: 'relative',
    width: '120px',
    height: '90px',
  },
  galleryImg: { width: '100%', height: '100%', objectFit: 'cover', borderRadius: '6px', cursor: 'move' },
  galleryPending: {
    position: 'absolute',
    left: '2px',
    bottom: '2px',
    backgroundColor: 'rgba(0,0,0,0.65)',
    color: '#fff',
    fontSize: '10px',
    padding: '1px 6px',
    borderRadius: '6px',
    pointerEvents: 'none',
  },
  galleryDelete: {
    position: 'absolute',
    top: '2px',
    right: '2px',
    backgroundColor: 'rgba(0,0,0,0.6)',
    color: '#fff',
    border: 'none',
    borderRadius: '50%',
    width: '20px',
    height: '20px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
  },
  tagPills: { display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' },
});

interface EditItem extends CreateItem {
  _id: string; // 临时 ID，用于 dnd-kit
  _isNew?: boolean;
  /** 选中但尚未上传的本地文件路径，保存时才真正上传 */
  localFilePath?: string;
}

interface EditImage {
  id: number | string;
  file_path: string;
  /** 新建/未保存时选中的本地文件路径，保存时才真正上传 */
  localPath?: string;
}

const genId = () => Math.random().toString(36).slice(2, 11);

const ITEM_TYPES = [
  { value: 'link', label: '🔗 链接' },
  { value: 'ed2k', label: '🔌 eD2K' },
  { value: 'magnet_torrent', label: '🧲 磁力种子' },
  { value: 'file', label: '📁 附件文件' },
  { value: 'direct_link', label: '🔗 文件直链' },
];

// 可排序的附件项
function SortableItem({ item, children }: { item: EditItem; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item._id });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      {...attributes}
    >
      {children}
      <button
        {...listeners}
        style={{ cursor: 'grab', border: 'none', background: 'transparent', padding: '4px' }}
        title="拖动排序"
      >
        <ReOrderDotsVerticalRegular />
      </button>
    </div>
  );
}

// 可排序的图集项
function SortableImage({ img, onDelete }: { img: EditImage; onDelete: () => void }) {
  const styles = useStyles();
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: String(img.id) });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className={styles.galleryItem}
    >
      <img
        src={img.localPath ? convertFileSrc(img.localPath) : assetUrl(img.file_path)}
        className={styles.galleryImg}
        alt=""
        title={img.localPath ? '保存时上传' : ''}
        {...listeners}
      />
      {img.localPath && <span className={styles.galleryPending}>待保存</span>}
      <button className={styles.galleryDelete} onClick={onDelete}>
        ×
      </button>
    </div>
  );
}

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
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const { data: resource } = useQuery<Resource>({
    queryKey: ['resource', ridNum],
    queryFn: () => resourceApi.get(ridNum),
    enabled: isEdit,
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
      setAccessPassword(resource.access_password);
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
      setGallery(images.map((im) => ({ id: im.id, file_path: im.file_path })));
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

  // 确保资源已保存（新建模式下先保存获取 rid），返回 rid
  const ensureSaved = async (): Promise<number> => {
    if (isEdit) return ridNum;
    if (!title.trim()) {
      throw new Error('请先填写标题再上传内容');
    }
    // 新建模式：先保存资源
    const submitItems = await prepareItems();
    if (submitItems === null) throw new Error('附件校验失败');
    const resolvedTagIds = await resolveTagIds();
    const payload = {
      title: title.trim(),
      description: description.trim(),
      content: content.trim(),
      read_level: readLevel,
      access_password: accessPassword,
      thumbnail_path: thumbnailPath,
      tag_ids: resolvedTagIds,
      collection_ids: collectionIds,
      category_id: categoryId,
      items: submitItems,
      author_id: isAdmin && authorId != null && authorId !== currentUserId ? authorId : undefined,
    };
    const newId = await resourceApi.create(payload);
    // 切换到编辑模式但不刷新页面
    setCurrentRid(newId);
    setLoaded(true);
    // 更新 URL（不触发导航刷新）
    window.history.replaceState({}, '', `/edit/${newId}`);
    queryClient.invalidateQueries({ queryKey: ['resource', newId] });
    queryClient.invalidateQueries({ queryKey: ['resource-images', newId] });
    return newId;
  };

  // 选择封面：仅本地暂存预览，保存时才上传
  const uploadThumbnail = async () => {
    const filePath = await pickFile(['jpg', 'jpeg', 'png', 'webp']);
    if (!filePath) return;
    setPendingThumbnail(filePath);
  };

  const clearThumbnail = async () => {
    // 先清除本地暂存
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
    // 本地暂存图：直接从列表移除即可
    if (img.localPath) {
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
      filters:
        kind === 'image'
          ? [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }]
          : undefined,
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
    const names = newTagNames
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

  // 网页采集回填
  const handleCollectApply = async (p: CollectApplyPayload) => {
    const targetId = await ensureSaved();

    if (p.title) setTitle(p.title);
    // 游戏简介写入文章正文（已有正文时不覆盖）
    if (p.content) setContent((prev) => (prev.trim() ? prev : p.content));

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

    // 封面与图集并行下载（图床较慢，总耗时取两者较长者）
    const tasks: Promise<string | null>[] = [];

    if (p.thumbnailUrl) {
      tasks.push(
        collectorApi
          .setThumbnail(targetId, p.thumbnailUrl, p.referer)
          .then((savedPath) => {
            setThumbnailPath(savedPath);
            queryClient.invalidateQueries({ queryKey: ['resource', targetId] });
            return null;
          })
          .catch((e: Error) => `封面下载失败：${e.message}`),
      );
    }

    if (p.imageUrls.length > 0) {
      tasks.push(
        collectorApi
          .addImages(targetId, p.imageUrls, p.referer)
          .then((res) => {
            setGallery((g) => [...g, ...res.images.map((im) => ({ id: im.id, file_path: im.file_path }))]);
            queryClient.invalidateQueries({ queryKey: ['resource-images', targetId] });
            return res.failed.length > 0
              ? `${res.failed.length} 张图片下载失败：${res.failed.map((f) => f.error).join('；')}`
              : null;
          })
          .catch((e: Error) => `图集下载失败：${e.message}`),
      );
    }

    const problems = (await Promise.all(tasks)).filter((m): m is string => !!m);
    if (problems.length > 0) setError(problems.join('；'));
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

      // 3. 新建：先创建文章拿到 id（封面/图集随后上传）
      let savedId = ridNum;
      if (!isEdit) {
        savedId = await resourceApi.create({
          title: title.trim(),
          description: description.trim(),
          content: finalContent.trim(),
          read_level: readLevel,
          access_password: accessPassword,
          // 有本地待传封面时先留空，上传后由 setResourceThumbnail 写回
          thumbnail_path: pendingThumbnail ? '' : thumbnailPath,
          tag_ids: resolvedTagIds,
          collection_ids: collectionIds,
          category_id: categoryId,
          items: submitItems,
          author_id: isAdmin && authorId != null && authorId !== currentUserId ? authorId : undefined,
        });
        setCurrentRid(savedId);
      }

      // 4. 上传本地暂存的封面
      let finalThumbnail = thumbnailPath;
      if (pendingThumbnail) {
        finalThumbnail = await imageApi.setResourceThumbnail(savedId, pendingThumbnail);
        setThumbnailPath(finalThumbnail);
        setPendingThumbnail(null);
      }

      // 5. 上传本地暂存的图集图片（保留当前显示顺序），得到 临时id -> 真实id 映射
      const idMap = new Map<string, number>();
      const pending = gallery.filter((im) => im.localPath);
      const uploaded = await Promise.all(
        pending.map(async (im) => {
          const r = await imageApi.uploadResourceImage(savedId, im.localPath!);
          return { tempId: String(im.id), realId: r.id, filePath: r.file_path };
        }),
      );
      for (const u of uploaded) idMap.set(u.tempId, u.realId);
      if (uploaded.length > 0) {
        setGallery((g) =>
          g.map((im) => {
            const realId = idMap.get(String(im.id));
            return realId != null
              ? { id: realId, file_path: uploaded.find((u) => u.realId === realId)!.filePath }
              : im;
          }),
        );
      }

      // 6. 按当前顺序提交排序
      const orderedIds = gallery.map((im) =>
        im.localPath ? idMap.get(String(im.id))! : Number(im.id),
      );
      if (orderedIds.length > 0) {
        await imageApi.reorderResourceImages(savedId, orderedIds);
      }

      // 封面回退：未设置封面时，取图集第一张（不复制文件，直接引用）；
      // 图集也没有则取正文 Markdown 首图（正文图片已在步骤 2 上传为相对路径）
      if (!finalThumbnail) {
        const firstGallery = gallery.find((im) => {
          const realId = idMap.get(String(im.id));
          return realId != null || !im.localPath;
        });
        if (firstGallery) {
          // 本地刚上传的图查映射结果；已有图直接用 file_path
          const realId = idMap.get(String(firstGallery.id));
          finalThumbnail = realId != null
            ? uploaded.find((u) => u.realId === realId)!.filePath
            : firstGallery.file_path;
        } else {
          const m = finalContent.match(/!\[[^\]]*\]\(([^)\s]+)\)/);
          if (m && !/^https?:\/\//i.test(m[1]) && !m[1].startsWith('__pending__')) {
            finalThumbnail = m[1];
          }
        }
        if (finalThumbnail) setThumbnailPath(finalThumbnail);
      }

      // 7. 编辑已有文章，或新建时带封面/回退出封面：更新正文等字段
      if (isEdit || pendingThumbnail || finalThumbnail) {
        await resourceApi.update(savedId, {
          title: title.trim(),
          description: description.trim(),
          content: finalContent.trim(),
          read_level: readLevel,
          access_password: accessPassword,
          thumbnail_path: finalThumbnail,
          tag_ids: resolvedTagIds,
          collection_ids: collectionIds,
          category_id: categoryId,
          items: submitItems,
          author_id: isAdmin && authorId != null && authorId !== currentUserId ? authorId : undefined,
        });
      }
      return savedId;
    },
    onSuccess: (savedId) => {
      queryClient.invalidateQueries({ queryKey: ['resources'] });
      queryClient.invalidateQueries({ queryKey: ['resource', savedId ?? ridNum] });
      queryClient.invalidateQueries({ queryKey: ['resource-images', savedId ?? ridNum] });
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      navigate(`/detail/${savedId ?? ridNum}`);
    },
    onError: (e: Error) => setError(e.message || '保存失败'),
  });

  if (isEdit && !loaded) {
    return <Spinner label="加载中..." />;
  }

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <Button
          appearance="subtle"
          icon={<ArrowLeftRegular />}
          onClick={() => navigate(-1)}
        >
          返回
        </Button>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button icon={<GlobeRegular />} onClick={() => setCollectOpen(true)}>
            网页采集
          </Button>
          <Button
            appearance="primary"
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending || !title.trim()}
          >
            {saveMut.isPending ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>

      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      {/* 基本信息 */}
      <Card style={{ padding: '16px' }}>
        <div className={styles.field}>
          <Label htmlFor="title">标题 *</Label>
          <Input id="title" value={title} onChange={(_, d) => setTitle(d.value)} />
        </div>
        <div className={styles.field}>
          <Label htmlFor="desc">描述</Label>
          <Textarea
            id="desc"
            value={description}
            onChange={(_, d) => setDescription(d.value)}
            rows={2}
          />
        </div>
        <div className={styles.field}>
          <Label>正文（Markdown）</Label>
          <MarkdownEditor
            value={content}
            onChange={setContent}
            height={480}
            placeholder="在此输入 Markdown 正文..."
            upload={uploadContentAsset}
          />
        </div>
        <div className={styles.row}>
          <div className={styles.field}>
            <Label>阅读权限</Label>
            <Dropdown
              value={readLevel === 0 ? '0 - 公开（无需登录）' : `${readLevel} - 需权限 ${readLevel} 及以上`}
              selectedOptions={[String(readLevel)]}
              onOptionSelect={(_, d) => { if (d.optionValue) setReadLevel(Number(d.optionValue)); }}
            >
              <Option value="0" text="0 - 公开（无需登录）">0 - 公开（无需登录）</Option>
              <Option value="1" text="1 - 需权限 1 及以上">1 - 需权限 1 及以上</Option>
              <Option value="2" text="2 - 需权限 2 及以上">2 - 需权限 2 及以上</Option>
              <Option value="3" text="3 - 需权限 3 及以上">3 - 需权限 3 及以上</Option>
              <Option value="4" text="4 - 需权限 4 及以上">4 - 需权限 4 及以上</Option>
              <Option value="5" text="5 - 需权限 5（默认仅管理员）">5 - 需权限 5（默认仅管理员）</Option>
            </Dropdown>
          </div>
          {isAdmin && (
            <div className={styles.field}>
              <Label>发布身份（马甲）</Label>
              <Dropdown
                value={
                  authorId == null ? '当前账号'
                  : authors?.find((a) => a.id === authorId)
                    ? `${authors.find((a) => a.id === authorId)!.nickname || authors.find((a) => a.id === authorId)!.username}`
                    : `用户 #${authorId}`
                }
                selectedOptions={[String(authorId ?? 'me')]}
                onOptionSelect={(_, d) => {
                  const v = d.optionValue;
                  setAuthorId(v === 'me' ? null : Number(v));
                }}
              >
                <Option value="me" text="当前账号">当前账号</Option>
                {authors?.map((a) => (
                  <Option key={a.id} value={String(a.id)} text={a.nickname || a.username}>
                    {a.nickname || a.username}
                  </Option>
                ))}
              </Dropdown>
            </div>
          )}
        </div>
        <div className={styles.field}>
          <Label htmlFor="pwd">访问密码（留空则不限制）</Label>
          <Input
            id="pwd"
            type="password"
            value={accessPassword}
            onChange={(_, d) => setAccessPassword(d.value)}
          />
          <span style={{ fontSize: '12px', color: tokens.colorNeutralForeground3 }}>
            {readLevel > 0 && !accessPassword
              ? `提示：需要权限 ${readLevel} 级及以上的用户才能查看`
              : readLevel === 0 && !accessPassword
              ? '提示：公开且不设密码 = 任何人（包括未登录用户）均可访问'
              : accessPassword
              ? '已设置访问密码，凭密码可访问'
              : ''}
          </span>
        </div>
        {/* 标签 */}
        <div className={styles.field}>
          <Label>标签</Label>
          <Dropdown
            multiselect
            placeholder="选择已有标签"
            selectedOptions={tagIds.map(String)}
            onOptionSelect={(_, d) => {
              const vals = d.selectedOptions ?? [];
              setTagIds(vals.map(Number));
            }}
          >
            {tags?.map((t) => (
              <Option key={t.id} value={String(t.id)} text={`${t.name} (${t.count ?? 0})`}>
                {t.name} ({t.count ?? 0})
              </Option>
            ))}
          </Dropdown>
          <Input
            placeholder="新增标签，逗号分隔（保存时自动创建）"
            value={newTagNames}
            onChange={(_, d) => setNewTagNames(d.value)}
            style={{ marginTop: '4px' }}
          />
          {tagIds.length > 0 && (
            <div className={styles.tagPills}>
              {tagIds.map((tid) => {
                const t = tags?.find((x) => x.id === tid);
                return t ? (
                  <Badge key={tid} appearance="filled" color="informative">{t.name}</Badge>
                ) : null;
              })}
            </div>
          )}
        </div>
        {/* 合集（自定义分类） */}
        <div className={styles.field} style={{ marginBottom: 0 }}>
          <Label>合集</Label>
          <Dropdown
            multiselect
            placeholder="选择合集"
            selectedOptions={collectionIds.map(String)}
            onOptionSelect={(_, d) => {
              const vals = d.selectedOptions ?? [];
              setCollectionIds(vals.map(Number));
            }}
          >
            {collections?.map((c) => (
              <Option
                key={c.id}
                value={String(c.id)}
                text={`${c.title} (${c.resource_count ?? 0})`}
              >
                {c.title} ({c.resource_count ?? 0})
              </Option>
            ))}
          </Dropdown>
          {collectionIds.length > 0 && (
            <div className={styles.tagPills}>
              {collectionIds.map((cid) => {
                const c = collections?.find((x) => x.id === cid);
                return c ? (
                  <Badge key={cid} appearance="filled" color="brand">{c.title}</Badge>
                ) : null;
              })}
            </div>
          )}
        </div>
      </Card>

      {/* 分类（单选，树形层级下拉） */}
      <Card style={{ padding: '16px' }}>
        <Label>分类</Label>
        <div className={styles.field} style={{ marginBottom: 0 }}>
          <CategoryTreeSelect
            categories={categoriesTree}
            value={categoryId}
            onChange={setCategoryId}
            placeholder="选择分类（可选）"
            emptyLabel="（无分类）"
            showCount
            style={{ minWidth: '240px' }}
          />
        </div>
      </Card>

      {/* 缩略图 */}
      <Card style={{ padding: '16px' }}>
        <Label>缩略图{pendingThumbnail ? '（保存后上传）' : ''}</Label>
        <div className={styles.thumbRow}>
          {pendingThumbnail || thumbnailPath ? (
            <img
              className={styles.thumb}
              src={pendingThumbnail ? convertFileSrc(pendingThumbnail) : assetUrl(thumbnailPath)}
              alt="缩略图"
            />
          ) : (
            <div className={styles.thumb} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: tokens.colorNeutralForeground3 }}>
              无
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <Button appearance="outline" size="small" icon={<ArrowUploadRegular />} onClick={uploadThumbnail}>
              {pendingThumbnail ? '重新选择' : '上传'}
            </Button>
            {(pendingThumbnail || thumbnailPath) && (
              <Button appearance="subtle" size="small" icon={<DeleteRegular />} onClick={clearThumbnail}>
                清除
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* 附件项（拖拽排序） */}
      <Card style={{ padding: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
          <Label>附件项（支持多个，可拖拽排序）</Label>
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {ITEM_TYPES.map((t) => (
              <Button
                key={t.value}
                appearance="outline"
                size="small"
                icon={<AddCircleRegular />}
                onClick={() => addItem(t.value as CreateItem['type'])}
              >
                {t.label}
              </Button>
            ))}
          </div>
        </div>

        {items.length === 0 ? (
          <div style={{ padding: '16px', textAlign: 'center', color: tokens.colorNeutralForeground3 }}>
            暂无附件，点击上方按钮添加链接 / 磁力种子 / 文件等
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleItemDragEnd}>
            <SortableContext items={items.map((it) => it._id)} strategy={verticalListSortingStrategy}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {items.map((it) => (
                  <SortableItem key={it._id} item={it}>
                    <div className={styles.itemBlock}>
                      <div className={styles.itemHeader}>
                        <Badge appearance="outline">
                          {ITEM_TYPES.find((t) => t.value === it.type)?.label ?? it.type}
                        </Badge>
                        <Button
                          appearance="subtle"
                          size="small"
                          icon={<DeleteRegular />}
                          onClick={() => removeItem(it._id)}
                        />
                      </div>
                      <div className={styles.field} style={{ marginBottom: '0' }}>
                        <Label>描述</Label>
                        <Input
                          value={it.description}
                          onChange={(_, d) => updateItem(it._id, { description: d.value })}
                          placeholder="可选描述"
                        />
                      </div>
                      {it.type === 'magnet_torrent' ? (
                        <>
                          <div className={styles.field} style={{ marginBottom: '0' }}>
                            <Label>磁力链接</Label>
                            <Input
                              value={it.content}
                              onChange={(_, d) => updateItem(it._id, { content: d.value })}
                              placeholder="magnet:?xt=urn:btih:..."
                            />
                          </div>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <Button
                              size="small"
                              appearance="outline"
                              icon={<ArrowUploadRegular />}
                              onClick={() => uploadTorrent(it._id)}
                            >
                              上传种子文件
                            </Button>
                            {it.file_name && (
                              <>
                                <Badge appearance={it.localFilePath ? 'tint' : 'outline'} title={it.localFilePath ? '保存后上传' : undefined}>
                                  {it.file_name}{it.localFilePath ? ' · 待保存' : ''}
                                </Badge>
                                <Button
                                  size="small"
                                  appearance="subtle"
                                  icon={<DeleteRegular />}
                                  onClick={() => updateItem(it._id, { file_path: '', file_name: '', localFilePath: undefined })}
                                />
                              </>
                            )}
                          </div>
                        </>
                      ) : it.type === 'file' ? (
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <Button
                            size="small"
                            appearance="outline"
                            icon={<ArrowUploadRegular />}
                            onClick={() => uploadItemFile(it._id)}
                          >
                            上传文件
                          </Button>
                          {it.file_name && (
                            <>
                              <Badge appearance="outline">{it.file_name}</Badge>
                              <Button
                                size="small"
                                appearance="subtle"
                                icon={<DeleteRegular />}
                                onClick={() => updateItem(it._id, { file_path: '', file_name: '' })}
                              />
                            </>
                          )}
                        </div>
                      ) : (
                        <div className={styles.field} style={{ marginBottom: '0' }}>
                          <Label>链接</Label>
                          <Input
                            value={it.content}
                            onChange={(_, d) => updateItem(it._id, { content: d.value })}
                            placeholder={it.type === 'ed2k' ? 'ed2k://...' : 'https://...'}
                          />
                        </div>
                      )}
                    </div>
                  </SortableItem>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </Card>

      {/* 图集（拖拽排序） */}
      <Card style={{ padding: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <Label>图集</Label>
          <Button
            size="small"
            appearance="outline"
            icon={<AddCircleRegular />}
            onClick={uploadGallery}
          >
            添加图片
          </Button>
        </div>
        {gallery.length === 0 ? (
          <div style={{ padding: '16px', textAlign: 'center', color: tokens.colorNeutralForeground3 }}>
            暂无图片
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleGalleryDragEnd}>
            <SortableContext
              items={gallery.map((im) => String(im.id))}
              strategy={horizontalListSortingStrategy}
            >
              <div className={styles.gallery}>
                {gallery.map((im) => (
                  <SortableImage
                    key={im.id}
                    img={im}
                    onDelete={() => deleteGalleryImage(im)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </Card>

      {collectOpen && (
        <CollectDialog
          hasThumbnail={!!thumbnailPath}
          onClose={() => setCollectOpen(false)}
          onApply={handleCollectApply}
        />
      )}
    </div>
  );
}
