// 后端命令错误的读取与分类
// Tauri v2 的 invoke 抛出的可能是字符串、Error，或带 message 字段的对象，统一取出文案

/** 取出错误信息（兼容多种形态） */
export function errorText(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object') {
    const msg = (e as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  return '';
}

/** 是否为「无权访问」（阅读权限不足 / 未通过访问密码解锁） */
export function isForbidden(e: unknown): boolean {
  return errorText(e).includes('无权访问');
}
