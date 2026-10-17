// Tauri invoke 封装：所有后端命令调用的统一入口
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import type {
  AdminUser,
  AuthorInfo,
  Category,
  CategoryFlat,
  Collection,
  CreateCategory,
  CreateCollection,
  CreateResource,
  FetchStatus,
  Image,
  ListParams,
  PaginatedResources,
  Paged,
  ParsedTorrentFile,
  Resource,
  ResourceFile,
  Tag,
  UploadResult,
  UserInfo,
} from '../types/models';

// --- Auth ---
export const authApi = {
  login: (username: string, password: string) => invoke<UserInfo>('auth_login', { payload: { username, password } }),
  register: (username: string, nickname: string, email: string, password: string) =>
    invoke<UserInfo>('auth_register', { payload: { username, nickname, email, password } }),
  logout: () => invoke<void>('auth_logout'),
  me: () => invoke<UserInfo | null>('auth_me'),
  updateProfile: (nickname: string, email: string, bio: string) =>
    invoke<UserInfo>('auth_update_profile', { payload: { nickname, email, bio } }),
  changeUsername: (newUsername: string, password: string) =>
    invoke<UserInfo>('auth_change_username', { payload: { new_username: newUsername, password } }),
  uploadAvatar: (filePath: string) => invoke<string>('auth_upload_avatar', { filePath }),
  uploadAvatarBytes: (data: ArrayBuffer | Uint8Array, ext: string) =>
    invoke<string>('auth_upload_avatar_bytes', {
      data: Array.from(data instanceof Uint8Array ? data : new Uint8Array(data)),
      ext,
    }),
  changePassword: (oldPassword: string, newPassword: string) =>
    invoke<void>('auth_change_password', { payload: { old_password: oldPassword, new_password: newPassword } }),
};

// --- Users（用户管理，需用户管理权限） ---
export const userApi = {
  list: () => invoke<AdminUser[]>('list_users'),
  listPage: (page: number, pageSize: number, search?: string) =>
    invoke<Paged<AdminUser>>('list_users_page', { page, pageSize, search: search || null }),
  create: (payload: {
    username: string;
    nickname: string;
    email: string;
    password: string;
    permission_level?: number;
  }) => invoke<number>('create_user', { payload }),
  deleteMany: (ids: number[]) => invoke<{ deleted: number; skipped: number }>('delete_users', { payload: { ids } }),
  resetPassword: (userId: number, newPassword: string) =>
    invoke<void>('reset_user_password', { payload: { user_id: userId, new_password: newPassword } }),
  update: (payload: import('../types/models').AdminUpdateUser) => invoke<void>('update_user', { payload }),
  setAvatar: (userId: number, data: ArrayBuffer | Uint8Array, ext: string) =>
    invoke<string>('admin_set_user_avatar', {
      payload: {
        user_id: userId,
        ext,
        data: Array.from(data instanceof Uint8Array ? data : new Uint8Array(data)),
      },
    }),
};

// --- Authors（作者列表，公开） ---
export const authorApi = {
  list: () => invoke<AuthorInfo[]>('list_authors'),
  listPage: (page: number, pageSize: number, search?: string) =>
    invoke<Paged<AuthorInfo>>('list_authors_page', { page, pageSize, search: search || null }),
};

// --- Resources ---
export const resourceApi = {
  list: (params: ListParams) => invoke<PaginatedResources>('list_resources', { params }),
  get: (rid: number) => invoke<Resource>('get_resource', { rid }),
  create: (payload: CreateResource) => invoke<number>('create_resource', { payload }),
  update: (rid: number, payload: CreateResource) => invoke<void>('update_resource', { rid, payload }),
  delete: (rid: number) => invoke<void>('delete_resource', { rid }),
  restore: (rid: number) => invoke<void>('restore_resource', { rid }),
  permanentDelete: (rid: number) => invoke<void>('permanent_delete_resource', { rid }),
  listTrash: () => invoke<Resource[]>('list_trash_resources'),
  listTrashPage: (page: number, pageSize: number) =>
    invoke<Paged<Resource>>('list_trash_resources_page', { page, pageSize }),
  checkAccess: (rid: number, password: string) =>
    invoke<boolean>('check_resource_access', { rid, payload: { password } }),
  uploadFile: (filePath: string, subdir: string) => invoke<string>('upload_resource_file', { filePath, subdir }),
  batchUpdate: (payload: {
    ids: number[];
    read_level?: number;
    access_password?: string;
    category_id?: number | null;
    add_collection_id?: number;
    user_id?: number | null;
  }) => invoke<void>('batch_update_resources', { payload }),
};

// --- Images ---
export const imageApi = {
  listResourceImages: (rid: number) => invoke<Image[]>('list_resource_images', { rid }),
  uploadResourceImage: (rid: number, filePath: string) =>
    invoke<UploadResult>('upload_resource_image', { rid, filePath }),
  deleteResourceImage: (imgId: number) => invoke<void>('delete_resource_image', { imgId }),
  reorderResourceImages: (rid: number, imageIds: number[]) =>
    invoke<void>('reorder_resource_images', { rid, imageIds }),
  setResourceThumbnail: (rid: number, filePath: string) =>
    invoke<string>('set_resource_thumbnail', { rid, payload: { file_path: filePath } }),
  clearResourceThumbnail: (rid: number) => invoke<void>('clear_resource_thumbnail', { rid }),
  listCollectionImages: (cid: number) => invoke<Image[]>('list_collection_images', { cid }),
  uploadCollectionImage: (cid: number, filePath: string) =>
    invoke<UploadResult>('upload_collection_image', { cid, filePath }),
  deleteCollectionImage: (imgId: number) => invoke<void>('delete_collection_image', { imgId }),
  reorderCollectionImages: (cid: number, imageIds: number[]) =>
    invoke<void>('reorder_collection_images', { cid, imageIds }),
};

// --- Tags ---
export const tagApi = {
  list: () => invoke<Tag[]>('list_tags'),
  listPage: (page: number, pageSize: number, search?: string) =>
    invoke<Paged<Tag>>('list_tags_page', { page, pageSize, search: search || null }),
  create: (name: string) => invoke<number>('create_tag', { name }),
  rename: (tagId: number, name: string) => invoke<void>('rename_tag', { tagId, name }),
  delete: (tagId: number) => invoke<void>('delete_tag', { tagId }),
  merge: (sourceIds: number[], targetId: number) => invoke<void>('merge_tags', { sourceIds, targetId }),
};

// --- Collections (自定义分类) ---
export const collectionApi = {
  list: () => invoke<Collection[]>('list_collections'),
  listPage: (page: number, pageSize: number, search?: string) =>
    invoke<Paged<Collection>>('list_collections_page', { page, pageSize, search: search || null }),
  get: (cid: number) => invoke<Collection>('get_collection', { cid }),
  checkAccess: (cid: number, password: string) =>
    invoke<boolean>('check_collection_access', { cid, payload: { password } }),
  create: (payload: CreateCollection) => invoke<number>('create_collection', { payload }),
  update: (cid: number, payload: CreateCollection) => invoke<void>('update_collection', { cid, payload }),
  delete: (cid: number) => invoke<void>('delete_collection', { cid }),
  restore: (cid: number) => invoke<void>('restore_collection', { cid }),
  permanentDelete: (cid: number) => invoke<void>('permanent_delete_collection', { cid }),
  syncResources: (cid: number, resourceIds: number[]) =>
    invoke<void>('sync_collection_resources', { cid, resourceIds }),
};

// --- Categories (树形分类) ---
export const categoryApi = {
  listTree: () => invoke<Category[]>('list_categories'),
  listFlat: () => invoke<CategoryFlat[]>('list_categories_flat'),
  create: (payload: CreateCategory) => invoke<number>('create_category', { payload }),
  update: (cid: number, payload: CreateCategory) => invoke<void>('update_category', { cid, payload }),
  delete: (cid: number) => invoke<void>('delete_category', { cid }),
  restore: (cid: number) => invoke<void>('restore_category', { cid }),
  permanentDelete: (cid: number) => invoke<void>('permanent_delete_category', { cid }),
  saveOrder: (items: { id: number; parent_id: number | null; sort_order: number }[]) =>
    invoke<void>('save_category_order', { items }),
};

// --- Settings ---
export const settingsApi = {
  getPublic: () => invoke<Record<string, string>>('get_public_settings'),
  get: () => invoke<Record<string, string>>('get_settings'),
  update: (settings: Record<string, string>) => invoke<void>('update_settings', { settings }),
  getUploadBaseDir: () => invoke<string>('get_upload_base_dir'),
  uploadLogo: (filePath: string, kind: 'image' | 'icon') => invoke<string>('upload_logo', { filePath, kind }),
  clearLogo: (kind: 'image' | 'icon') => invoke<void>('clear_logo', { kind }),
  /** 代理状态：mode/system/none/custom + effective 生效地址 */
  getProxyStatus: () => invoke<{ mode: string; custom_url: string; effective: string }>('get_proxy_status'),
  /** 按设置用系统默认/指定浏览器打开外部链接 */
  openExternalUrl: (url: string) => invoke<void>('open_external_url', { url }),
};

// --- 翻译（OpenAI 兼容接口；接口地址/模型/Key 由管理员统一维护） ---
export interface LanguageOption {
  code: string;
  name: string;
}

export interface TranslateOptions {
  languages: LanguageOption[];
  target_lang: string;
  /** 管理员是否已配置好。false 时前端直接禁用翻译按钮 */
  configured: boolean;
}

/** 一个界面输入框的规格：标签、占位符、说明都由后端按引擎下发，前端只负责渲染 */
export interface TranslateFieldSpec {
  label: string;
  placeholder: string;
  hint: string;
}

export interface TranslateProvider {
  id: string;
  name: string;
  /** 引擎协议类型：llm / deep_l / libre / my_memory / baidu / tencent */
  kind: string;
  /** 分组标签：大模型 / 机器翻译 */
  kind_label: string;
  base_url: string;
  default_model: string;
  note: string;
  /** 是否需要填模型名（同时决定是否显示「获取模型列表」与「每批最大字数」） */
  uses_model: boolean;
  /** 接口地址是否可编辑：机翻域名固定，不露输入框 */
  base_url_editable: boolean;
  cred1: TranslateFieldSpec;
  /** 第二个凭证：只有百度（密钥）与腾讯（SecretKey）有 */
  cred2: TranslateFieldSpec | null;
  /** 附加参数：只有腾讯有（地域） */
  extra: TranslateFieldSpec | null;
  extra_default: string;
}

/** 管理员可见的翻译配置。注意：**不含任何密钥明文**，只有是否已配置与末 4 位 */
export interface TranslateConfig {
  providers: TranslateProvider[];
  provider: string;
  base_url: string;
  model: string;
  target_lang: string;
  has_api_key: boolean;
  api_key_tail: string;
  /** 第二个凭证是否已配置 + 末 4 位 */
  has_api_key2: boolean;
  api_key2_tail: string;
  /** 附加参数当前值（腾讯的地域） */
  extra: string;
  /** 每批最大字数：把一篇文章切成几批发给模型，批越大越省往返次数（仅大模型） */
  batch_chars: number;
  /** 允许范围与默认值由后端下发，避免前后端各写一份常量 */
  batch_chars_min: number;
  batch_chars_max: number;
  batch_chars_default: number;
  /** 已存有第一个凭证的服务商 id：切换服务商时据此提示「已保存」，不必重新粘贴 */
  providers_with_key: string[];
  /** 已存有第二个凭证的服务商 id */
  providers_with_key2: string[];
  /** 各服务商已保存的接口地址（键为 provider id）：切换时恢复自己的值而不是模板默认 */
  saved_base_urls: Record<string, string>;
  /** 各服务商已保存的模型名（键为 provider id） */
  saved_models: Record<string, string>;
  /** 各服务商已保存的附加参数（键为 provider id） */
  saved_extras: Record<string, string>;
}

export interface TranslateResult {
  text: string;
  /** 未能翻译的块数（这些块保留了原文） */
  failed_blocks: number;
  error: string | null;
  /** 是否被用户中途取消（已翻好的部分仍然在 text 里） */
  cancelled: boolean;
}

export const translateApi = {
  /** 翻译一段 Markdown。模型与接口地址由后端决定，前端无权指定 */
  text: (text: string, targetLang?: string) =>
    invoke<TranslateResult>('translate_text', { text, targetLang: targetLang ?? null }),
  /** 取消进行中的翻译（已翻好的部分会保留） */
  cancel: () => invoke<void>('translate_cancel'),
  /** 语言列表 + 默认目标语言 + 是否已配置（所有登录用户） */
  options: () => invoke<TranslateOptions>('translate_options'),
  /** 翻译配置（仅管理员） */
  config: () => invoke<TranslateConfig>('get_translate_config'),
  /** 测试连通性（仅管理员），返回示范译文 */
  test: () => invoke<string>('translate_test'),
  /**
   * 拉取某服务商的可用模型列表（仅管理员）。
   * 地址与 Key 由后端从库里的分桶设置读取，前端只指定"哪个服务商"。
   */
  fetchModels: (provider: string) => invoke<string[]>('translate_fetch_models', { provider }),
};

// --- Torrent / BT 种子文件列表 ---
export const torrentApi = {
  getFiles: (rid: number, itemId?: number) =>
    invoke<ResourceFile[]>('get_resource_files', { rid, itemId: itemId ?? 0 }),
  saveFiles: (rid: number, itemId: number, files: ParsedTorrentFile[]) =>
    invoke<void>('save_resource_files', { rid, payload: { item_id: itemId, files } }),
  parseTorrentFile: (filePath: string) => invoke<ParsedTorrentFile[]>('parse_torrent_file', { filePath }),
  fetchTorrent: (rid: number, itemId: number) => invoke<void>('fetch_torrent', { rid, itemId }),
  getFetchStatus: (rid: number, itemId: number) => invoke<FetchStatus>('get_fetch_status', { rid, itemId }),
  checkFiles: (rid: number) => invoke<{ item_id: number; exists: boolean }[]>('check_resource_files', { rid }),
  revealFile: (filePath: string) => invoke<void>('reveal_file_in_explorer', { filePath }),
  openFile: (filePath: string) => invoke<void>('open_file_with_default', { filePath }),
};

// --- 网页采集 ---
export interface CollectorInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  builtin: boolean;
  patterns: string[];
  raw: string;
}

export interface WebPage {
  url: string;
  final_url: string;
  body: string;
}

export interface CollectedImage {
  id: number;
  file_path: string;
  url: string;
  /** 原始远程地址，用于把下载结果映射回「待本地化」占位项 */
  source_url: string;
  width: number;
  height: number;
}

export interface CollectImagesResult {
  images: CollectedImage[];
  failed: { url: string; error: string }[];
}

export const collectorApi = {
  fetch: (url: string) => invoke<WebPage>('fetch_webpage', { url }),
  list: () => invoke<CollectorInfo[]>('list_collectors'),
  importPlugin: (sourcePath: string) => invoke<CollectorInfo>('import_collector', { sourcePath }),
  setThumbnail: (rid: number, url: string, referer: string) =>
    invoke<string>('collector_set_thumbnail', { rid, url, referer }),
  addImages: (rid: number, urls: string[], referer: string) =>
    invoke<CollectImagesResult>('collector_add_images', { rid, urls, referer }),
  /** 编辑器粘贴图片本地化：下载远程图片存入 content 目录，返回相对路径 */
  downloadImage: (url: string, referer: string) => invoke<string>('download_remote_image', { url, referer }),
};

// --- 资源 URL 解析（asset 协议）---
// 后端返回的 file_path 是相对路径（如 "gallery/xxx.jpg"），
// 需要拼接 upload_base_dir 后用 convertFileSrc 转为 asset URL。
let _uploadBaseDir: string | null = null;

export async function initAssetBaseDir(): Promise<string> {
  if (_uploadBaseDir !== null) return _uploadBaseDir;
  try {
    _uploadBaseDir = await settingsApi.getUploadBaseDir();
  } catch {
    _uploadBaseDir = '';
  }
  return _uploadBaseDir;
}

export function joinPath(base: string, rel: string): string {
  if (!rel) return base;
  const left = base.replace(/[/\\]+$/, '');
  const right = rel.replace(/^[/\\]+/, '');
  return `${left}/${right}`.replace(/\\/g, '/');
}

/**
 * 将后端存储的相对路径转换为可在 <img src> 中使用的 asset URL。
 * 需要先调用 initAssetBaseDir() 完成初始化（main.tsx 中已调用）。
 */
export function assetUrl(relPath: string): string {
  if (!relPath) return '';
  if (/^https?:\/\//i.test(relPath) || /^asset:/i.test(relPath)) return relPath;
  const base = _uploadBaseDir ?? '';
  if (!base) return '';
  return convertFileSrc(joinPath(base, relPath));
}

// --- Markdown 正文中的本地附件路径重写 ---
// 正文中插入的图片/附件以存储相对路径（如 content/xxx.png）保存，
// 渲染时需转换为 asset URL 才能显示/打开。
const ASSET_DEST_RE = /^(thumbnails|gallery|content|files|torrents|magnets|avatars)\//i;

// --- 编辑期本地暂存资源 ---
// 选择文件后不立即上传，markdown 中插入 __pending__/<token>/file 占位符，
// 预览时映射回本地文件；文章保存时才真正上传并把占位符替换为存储相对路径。
const pendingAssets = new Map<string, string>(); // token -> 本地绝对路径
const PENDING_RE = /^__pending__\/([^/]+)\//i;

export function registerPendingAsset(localPath: string): string {
  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  pendingAssets.set(token, localPath);
  // 固定后缀，避免原始文件名中的空格/特殊字符破坏 markdown 语法
  return `__pending__/${token}/file`;
}

export function listPendingAssets(): [string, string][] {
  return Array.from(pendingAssets.entries());
}

export function clearPendingAsset(token: string): void {
  pendingAssets.delete(token);
}

/** 若是 __pending__ 占位符则解析为本地 asset URL，否则返回 null */
function resolvePending(url: string): string | null {
  const m = PENDING_RE.exec(url);
  if (!m) return null;
  const local = pendingAssets.get(m[1]);
  return local ? convertFileSrc(local) : null;
}

/**
 * 重写 md2html 产出的 HTML 中的本地资源引用。
 * - editor：img/a 全部转 asset URL（Vditor 预览用）
 * - view：img 转 asset URL；本地文件 <a> 改为 data-asset，由 MarkdownView 点击时调系统默认程序打开
 */
export function rewriteAssetHtml(html: string, mode: 'editor' | 'view'): string {
  return html.replace(/<(img|a)\b([^>]*)>/gi, (_whole, tag: string, attrs: string) => {
    const isImg = tag.toLowerCase() === 'img';
    const replaced = attrs.replace(/\b(src|href)\s*=\s*(["'])(.*?)\2/gi, (m, attr: string, q: string, url: string) => {
      // 编辑期本地暂存资源：编辑器预览映射回本地文件
      if (mode === 'editor') {
        const pending = resolvePending(url);
        if (pending) return `${attr}=${q}${pending}${q}`;
      }
      if (!ASSET_DEST_RE.test(url)) return m;
      if (isImg || mode === 'editor') return `${attr}=${q}${assetUrl(url)}${q}`;
      return `href=${q}#${q} data-asset=${q}${url}${q}`;
    });
    return `<${tag}${replaced}>`;
  });
}

/** Vditor preview.parse 钩子：直接重写已渲染 DOM（IR 模式的行内图片走这里） */
export function rewriteAssetDom(root: HTMLElement): void {
  root.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || '';
    const pending = resolvePending(src);
    if (pending) {
      img.setAttribute('src', pending);
    } else if (ASSET_DEST_RE.test(src)) {
      img.setAttribute('src', assetUrl(src));
    }
  });
  root.querySelectorAll<HTMLAnchorElement>('a').forEach((a) => {
    const href = a.getAttribute('href') || '';
    const pending = resolvePending(href);
    if (pending) {
      a.setAttribute('href', pending);
    } else if (ASSET_DEST_RE.test(href)) {
      a.setAttribute('href', assetUrl(href));
    }
  });
}

// --- 多语言（i18n）---
export interface LanguageInfo {
  code: string;
  name: string;
  nativeName: string;
  isSeed: boolean;
  total: number;
  missing: number;
  coverage: number;
  status: string;
  error?: string | null;
  warning?: string | null;
  path: string;
}

export const i18nApi = {
  /** 语言清单；force=true 时重新扫描 lang 目录（新增/改动了文件后） */
  list: (force = false) => invoke<LanguageInfo[]>('list_languages', { force }),
  /** 指定语言的完整字典（已按回退链合并，缺的条目用简体中文补齐） */
  getDict: (code: string) => invoke<Record<string, string>>('get_language', { code }),
  /** 语言目录绝对路径（设置页展示用） */
  getLangDir: () => invoke<string>('get_lang_dir'),
  /** 设置全局默认语言（仅管理员） */
  setUiLanguage: (code: string) => invoke<void>('set_ui_language', { code }),
  /** 在文件管理器中打开语言目录 */
  openFolder: () => invoke<void>('open_lang_dir'),
};

// --- 附件清理（设置页，仅管理员） ---
export interface OrphanFile {
  path: string;
  name: string;
  category: 'thumbnail' | 'gallery' | 'content' | 'file' | 'torrent' | 'magnet' | 'avatar' | 'logo' | 'other';
  size: number;
  modified: number;
  is_image: boolean;
}

export interface DeleteOrphanResult {
  deleted: string[];
  failed: { path: string; error: string }[];
}

export const cleanupApi = {
  scan: () => invoke<{ files: OrphanFile[]; total_size: number }>('scan_orphan_files'),
  deleteFiles: (paths: string[]) => invoke<DeleteOrphanResult>('delete_orphan_files', { paths }),
};
