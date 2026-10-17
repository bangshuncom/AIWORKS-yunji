// 文章列表分页设置的读取与钳制。
// 设置页（写）与 ResourceList（读）共用同一套规则，避免两处各写一份导致不一致。
// DEFAULT_PAGE_SIZE 需与后端 settings.rs 里 list_page_size 的默认值保持一致。

export const DEFAULT_PAGE_SIZE = 24;
export const MIN_PAGE_SIZE = 1;
export const MAX_PAGE_SIZE = 200;

/**
 * 把设置里的字符串转成合法的每页条数。
 * 非数字 → 默认值；越界 → 钳制到边界；小数 → 向下取整。
 */
export function clampPageSize(raw: string | undefined | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || raw === null || raw === undefined || String(raw).trim() === '') {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(MAX_PAGE_SIZE, Math.max(MIN_PAGE_SIZE, Math.floor(n)));
}
