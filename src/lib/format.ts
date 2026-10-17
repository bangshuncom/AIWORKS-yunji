// 格式化工具函数

export function formatTime(s: string | null | undefined): string {
  if (!s) return '';
  return s.length > 16 ? s.slice(0, 16).replace('T', ' ') : s;
}

export function relativeTime(s: string | null | undefined): string {
  if (!s) return '';
  const t = new Date(s.replace(' ', 'T'));
  const diff = (Date.now() - t.getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
  if (diff < 2592000) return Math.floor(diff / 86400) + '天前';
  return formatTime(s);
}

/** compact=true 时省略数值与单位之间的空格，用于进度条等紧凑排版 */
export function formatBytes(bytes: number, compact = false): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = parseFloat((bytes / Math.pow(k, i)).toFixed(2));
  return compact ? `${value}${sizes[i]}` : `${value} ${sizes[i]}`;
}
