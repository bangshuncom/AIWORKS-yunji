// 权限等级 0-5：选项与文案（管理页、用户编辑弹窗共用）
export const LEVEL_OPTIONS = [0, 1, 2, 3, 4, 5];

export const levelText = (n: number) =>
  n === 0 ? '0 - 所有登录用户' : n === 5 ? '5 - 仅管理员' : `权限 ${n} 级及以上`;
