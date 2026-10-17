// 统一对话框：全部走 Tauri 原生弹窗，取代散落各页面的 window.confirm / window.alert
import { ask, message } from '@tauri-apps/plugin-dialog';
import { tOutside } from '../i18n';

/** 危险操作二次确认（删除 / 彻底删除 / 覆盖等不可恢复操作） */
export async function confirmDanger(text: string, title = tOutside('dialog.confirmTitle')): Promise<boolean> {
  return await ask(text, { title, kind: 'warning' });
}

/** 普通二次确认 */
export async function confirmInfo(text: string, title = tOutside('dialog.confirm')): Promise<boolean> {
  return await ask(text, { title, kind: 'info' });
}

/** 提示信息 */
export async function notify(text: string, title = tOutside('dialog.notice')): Promise<void> {
  await message(text, { title, kind: 'info' });
}

/** 错误提示 */
export async function notifyError(text: string, title = tOutside('dialog.failed')): Promise<void> {
  await message(text, { title, kind: 'error' });
}
