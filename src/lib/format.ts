// 格式化工具函数

export function formatTime(s: string | null | undefined): string {
  if (!s) return '';
  return s.length > 16 ? s.slice(0, 16).replace('T', ' ') : s;
}

export function relativeTime(
  s: string | null | undefined,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T'));
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return t('time.justNow');
  if (diff < 3600) return t('time.minutesAgo', { n: Math.floor(diff / 60) });
  if (diff < 86400) return t('time.hoursAgo', { n: Math.floor(diff / 3600) });
  if (diff < 2592000) return t('time.daysAgo', { n: Math.floor(diff / 86400) });
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
