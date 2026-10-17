// 数据模型类型定义

export interface Resource {
  id: number;
  title: string;
  description: string;
  content: string;
  /** 阅读权限：0=公开（无需登录），>0 需要读者权限值 >= read_level */
  read_level: number;
  /** 是否设置了访问密码（密码哈希不下发给前端） */
  has_password: boolean;
  thumbnail_path: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  user_id?: number | null;
  tags?: TagRef[];
  collections?: CollectionRef[];
  category?: CategoryRef | null;
  items?: ResourceItem[];
  images?: ImageRef[];
  /** 作者（用户已删除时为 null） */
  author?: AuthorRef | null;
  /** 资源包含的附件类型聚合（列表页显示类型徽章） */
  item_types?: string[];
}

export interface AuthorRef {
  id: number;
  username: string;
  nickname: string;
  avatar_path: string;
}

/** 作者列表项 */
export interface AuthorInfo {
  id: number;
  username: string;
  nickname: string;
  bio: string;
  avatar_path: string;
  resource_count: number;
}

export interface TagRef {
  id: number;
  name: string;
}

export interface CollectionRef {
  id: number;
  title: string;
  visibility: string;
}

export interface CategoryRef {
  id: number;
  name: string;
  parent_id: number | null;
}

export interface ResourceItem {
  id: number;
  resource_id: number;
  type: 'link' | 'direct_link' | 'magnet_torrent' | 'ed2k' | 'file';
  content: string;
  description: string;
  file_path: string;
  file_name: string;
  sort_order: number;
  created_at: string;
}

export interface ImageRef {
  id: number;
  resource_id: number;
  file_path: string;
  sort_order: number;
  width: number;
  height: number;
  created_at: string;
}

export interface Tag {
  id: number;
  name: string;
  count?: number;
}

export interface Image {
  id: number;
  file_path: string;
  sort_order: number;
  width: number;
  height: number;
  created_at: string;
}

export interface UploadResult {
  id: number;
  file_path: string;
  url: string;
  width: number;
  height: number;
}

// --- BT 种子文件列表 ---

export interface ResourceFile {
  id: number;
  resource_id: number;
  item_id: number;
  name: string;
  size: number;
  sort_order: number;
}

export interface ParsedTorrentFile {
  name: string;
  size: number;
}

export interface FetchStatus {
  status: 'idle' | 'pending' | 'running' | 'done' | 'failed';
  error: string;
  count: number;
  torrent_path: string;
}

export interface PaginatedResources {
  items: Resource[];
  total: number;
  page: number;
  page_size: number;
}

/** 通用分页返回 */
export interface Paged<T> {
  items: T[];
  total: number;
}

export interface ListParams {
  page: number;
  page_size: number;
  search?: string;
  status?: string;
  tag_id?: number;
  collection_id?: number;
  category_id?: number;
  user_id?: number;
  sort?: string;
  direction?: string;
  include_deleted?: boolean;
}

export interface CreateItem {
  type: 'link' | 'direct_link' | 'magnet_torrent' | 'ed2k' | 'file';
  content: string;
  description: string;
  file_path: string;
  file_name: string;
}

export interface CreateResource {
  title: string;
  description: string;
  content: string;
  read_level?: number;
  /** 留空 = 不改动；非空 = 设置新密码 */
  access_password: string;
  /** 显式清除访问密码 */
  clear_password?: boolean;
  thumbnail_path: string;
  tag_ids: number[];
  collection_ids: number[];
  category_id?: number | null;
  items: CreateItem[];
  author_id?: number;
}

export interface UserInfo {
  id: number;
  username: string;
  nickname: string;
  email: string;
  bio: string;
  avatar_path: string;
  is_admin: boolean;
  permission_level: number;
}

// --- 用户管理（需用户管理权限） ---

export interface AdminUser {
  id: number;
  username: string;
  nickname: string;
  email: string;
  bio: string;
  avatar_path: string;
  is_admin: boolean;
  permission_level: number;
  created_at: string;
}

export interface AdminUpdateUser {
  user_id: number;
  username: string;
  nickname: string;
  email: string;
  bio: string;
  permission_level: number;
  new_password?: string | null;
}

// --- 合集（自定义分类） ---

export interface Collection {
  id: number;
  title: string;
  description: string;
  visibility: 'public' | 'private';
  /** 是否设置了访问密码（密码哈希不下发给前端） */
  has_password: boolean;
  thumbnail_path: string;
  content: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  resource_count?: number;
  user_id?: number | null;
  /** 列表展示用封面：自有封面为空时回退首个收录文章封面 */
  cover_path?: string;
}

export interface CreateCollection {
  title: string;
  description: string;
  visibility?: string;
  /** 留空 = 不改动；非空 = 设置新密码 */
  access_password: string;
  /** 显式清除访问密码 */
  clear_password?: boolean;
  thumbnail_path: string;
  content?: string;
  author_id?: number;
}

// --- 附件类型元数据 ---

export const ITEM_TYPE_META: Record<string, { label: string; icon: string }> = {
  link: { label: '链接', icon: '🔗' },
  direct_link: { label: '直链', icon: '⬇️' },
  magnet_torrent: { label: '磁力种子', icon: '🧲' },
  ed2k: { label: 'eD2K', icon: '🔌' },
  file: { label: '附件', icon: '📁' },
};

// --- 分类（树形多级子分类） ---

export interface Category {
  id: number;
  parent_id: number | null;
  name: string;
  slug: string;
  description: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  resource_count?: number;
  children?: Category[];
}

export interface CategoryFlat {
  id: number;
  parent_id: number | null;
  name: string;
  slug: string;
  description: string;
  sort_order: number;
  level: number;
  resource_count?: number;
}

export interface CreateCategory {
  parent_id?: number | null;
  name: string;
  slug?: string;
  description?: string;
  sort_order?: number;
}
