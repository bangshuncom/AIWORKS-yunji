// 权限等级 0-5：选项与文案键（管理页、用户编辑弹窗共用）
export const LEVEL_OPTIONS = [0, 1, 2, 3, 4, 5];

/** 返回等级对应的 i18n 键；0/5 为特殊文案，其余走 levels.n（带 {n} 占位符，需传 { n }） */
export const levelTextKey = (n: number) => (n === 0 ? 'levels.0' : n === 5 ? 'levels.5' : 'levels.n');
