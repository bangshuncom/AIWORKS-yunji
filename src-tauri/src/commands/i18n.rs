// 多语言命令：语言清单、字典、全局默认语言、打开语言目录
//
// 语言文件是本地资源、不含任何用户数据，因此 list_languages / get_language 对
// 所有用户（含未登录）开放；只有「设为全局默认」需要管理员。
use std::collections::HashMap;

use tauri::State;
use tauri_plugin_opener::OpenerExt;

use crate::auth::require_admin;
use crate::db::repository;
use crate::error::{AppError, CmdResult};
use crate::i18n;
use crate::state::AppState;

/// 语言清单。force=true 时重新扫描目录（用于用户新增/改动文件后点「刷新」）
#[tauri::command]
pub async fn list_languages(
    state: State<'_, AppState>,
    force: Option<bool>,
) -> CmdResult<Vec<i18n::LangInfo>> {
    if force.unwrap_or(false) {
        return Ok(refresh_cache(&state).await);
    }
    {
        let cache = state.lang_cache.read().await;
        if !cache.is_empty() {
            return Ok(cache.clone());
        }
    }
    Ok(refresh_cache(&state).await)
}

async fn refresh_cache(state: &AppState) -> Vec<i18n::LangInfo> {
    let list = i18n::scan::scan(&state.lang_dir);
    *state.lang_cache.write().await = list.clone();
    list
}

/// 取指定语言的完整字典（已按回退链合并，缺的条目已用简体中文补齐）
#[tauri::command]
pub async fn get_language(
    state: State<'_, AppState>,
    code: String,
) -> CmdResult<HashMap<String, String>> {
    Ok(i18n::dict::build_dict(&state.lang_dir, &code))
}

/// 语言目录绝对路径（设置页展示用）
#[tauri::command]
pub async fn get_lang_dir(state: State<'_, AppState>) -> CmdResult<String> {
    Ok(state.lang_dir.to_string_lossy().to_string())
}

/// 设置全局默认语言（仅管理员）。
/// 校验 code 必须是 lang 目录里真实存在且可解析的语言，避免被写入任意值。
/// 保存后同步重建系统托盘菜单文案。
#[tauri::command]
pub async fn set_ui_language(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    code: String,
) -> CmdResult<()> {
    let _user = require_admin(&state.auth).await?;
    let list = i18n::scan::scan(&state.lang_dir);
    if !list.iter().any(|l| l.code == code && l.status == "ok") {
        return Err(AppError::BadRequest(format!("语言「{code}」不可用")));
    }
    repository::settings::set(&state.db, "ui_language", &code).await?;
    // 托盘是系统级 UI，按全局语言刷新其菜单文案
    if let Some(tray) = app.tray_by_id(crate::TRAY_ID) {
        if let Ok(menu) = crate::build_tray_menu(&app, &state.lang_dir, &code) {
            let _ = tray.set_menu(Some(menu));
        }
    }
    Ok(())
}

/// 在文件管理器中打开语言目录，方便用户复制模板文件
#[tauri::command]
pub async fn open_lang_dir(app: tauri::AppHandle, state: State<'_, AppState>) -> CmdResult<()> {
    let path = state.lang_dir.to_string_lossy().to_string();
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| AppError::BadRequest(format!("打开语言目录失败：{e}")))?;
    Ok(())
}
