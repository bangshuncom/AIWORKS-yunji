// 文章（resource）增删改后的缓存失效统一入口。
//
// 为什么集中在这里：文章的归属变化会同时牵动一批「聚合数据」——分类导航的文章计数、
// 合集卡片的资源数与封面回退、作者列表的文章数等。这些查询分散在多个页面和导航栏里，
// 之前每处各写各的 invalidate，结果漏掉了 categories-tree：
// 新建 / 删除文章后，导航栏的分类计数一直停在旧值，看起来像「计数没更新」。
// 统一从这里调用，新增页面时也不会再漏。
import type { QueryClient } from '@tanstack/react-query';

/**
 * 文章增删改波及的查询键（均为前缀匹配，会一并覆盖带参数的变体）。
 * 注意 'collection' 与 'collections'、'resource' 与 'resources' 是不同前缀，需分别列出。
 */
const ARTICLE_DEPENDENT_KEYS = [
  'resources', // 文章列表（含各种筛选参数）
  'resource', // 单篇详情
  'resource-images', // 文章图片列表
  'trash', // 回收站列表
  'categories-tree', // 导航分类树：cat.resource_count 就在这里
  'categories-flat', // 分类选择器（同样带计数）
  'collection', // 单个合集详情：resource_count 与封面回退
  'collections', // 合集列表
  'authors', // 作者列表：按文章数排序与计数
  'users', // 用户管理：文章数
  'search', // 搜索对话框：分类/作者结果里也带计数
] as const;

/**
 * 在文章被新建、编辑、软删、恢复或彻底删除后调用。
 * 会失效上表全部查询，交由 React Query 按需重新拉取。
 */
export function invalidateArticleData(qc: QueryClient) {
  for (const key of ARTICLE_DEPENDENT_KEYS) {
    qc.invalidateQueries({ queryKey: [key] });
  }
}
