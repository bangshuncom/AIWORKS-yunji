// 设置命令
use std::collections::HashMap;
use std::path::Path;
use tauri::State;

use crate::auth::require_admin;
use crate::db::repository;
use crate::error::{AppError, CmdResult};
use crate::state::AppState;

/// 界面类设置（对所有用户公开，仅影响显示/窗口行为）
const PUBLIC_KEYS: &[&str] = &[
    "close_to_tray",
    "logo_mode",
    "logo_image_path",
    "logo_icon_path",
    "list_page_size",
    "list_infinite_scroll",
    "ui_language",
];

#[tauri::command]
pub async fn get_public_settings(state: State<'_, AppState>) -> CmdResult<HashMap<String, String>> {
    let all = repository::settings::get_all(&state.db).await?;
    let mut public = HashMap::new();
    if let Some(v) = all.get("site_name") {
        public.insert("site_name".into(), v.clone());
    }
    // 界面设置默认值
    let defaults = [
        ("close_to_tray", "0"),
        ("logo_mode", "text"),
        ("logo_image_path", ""),
        ("logo_icon_path", ""),
        // 与前端 ResourceList 的兜底值保持一致
        ("list_page_size", "24"),
        ("list_infinite_scroll", "1"),
        // 全局默认界面语言（本地 localStorage 可覆盖），缺省简体中文
        ("ui_language", "zh-CN"),
    ];
    for key in PUBLIC_KEYS {
        let default = defaults.iter().find(|(k, _)| k == key).map(|(_, d)| *d).unwrap_or("");
        public.insert((*key).into(), all.get(*key).cloned().unwrap_or_else(|| default.into()));
    }
    // 功能权限阈值对前端公开（仅用于 UI 显隐，真正校验在后端）
    for key in [
        "perm_article_own",
        "perm_article",
        "perm_collection_own",
        "perm_collection",
        "perm_tag",
        "perm_trash",
        "perm_user",
        "perm_translate",
    ] {
        // translate 默认 0（所有登录用户可用，key 由管理员统一提供）；其余默认 5（仅管理员）
        let default = if key == "perm_translate" { "0" } else { "5" };
        public.insert(key.into(), all.get(key).cloned().unwrap_or_else(|| default.into()));
    }
    Ok(public)
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> CmdResult<HashMap<String, String>> {
    let _user = require_admin(&state.auth).await?;
    let mut all = repository::settings::get_all(&state.db).await?;
    // 翻译 API Key 不下发到前端：它由后端直接读库使用，前端任何地方都不需要明文。
    // Key 按服务商分桶存放（translate_api_key_<provider>），这里**按前缀整体剔除**，
    // 新增服务商时不必再改这行。管理员看到的是 has_api_key + 末 4 位（get_translate_config 提供）。
    all.retain(|k, _| !crate::translate::is_api_key_setting(k));
    Ok(all)
}

#[tauri::command]
pub async fn update_settings(
    state: State<'_, AppState>,
    mut settings: HashMap<String, String>,
) -> CmdResult<()> {
    let _user = require_admin(&state.auth).await?;
    // 防御：历史遗留的派生键不接受前端写入（库里本就不存在，这里只是兜底）。
    // 注意 API Key 的分桶键 `translate_api_key_<provider>` 是**允许写入**的正常设置项。
    settings.remove("translate_api_key_set");
    settings.remove("translate_api_key_tail");
    // 校验权限阈值
    for key in [
        "perm_article_own",
        "perm_article",
        "perm_collection_own",
        "perm_collection",
        "perm_tag",
        "perm_trash",
        "perm_user",
        "perm_translate",
    ] {
        if let Some(v) = settings.get(key) {
            let n: i64 = v.parse().map_err(|_| {
                crate::error::AppError::BadRequest("权限值必须为 0-5 的数字".into())
            })?;
            if !(0..=5).contains(&n) {
                return Err(crate::error::AppError::BadRequest("权限值必须为 0-5".into()));
            }
        }
    }
    // 翻译批大小：必须是数字且在允许范围内。
    // 这里拦下来是为了给管理员一句明确的报错；库里的脏数据另有 parse_batch_chars 兜底。
    if let Some(v) = settings.get("translate_batch_chars") {
        let n: usize = v
            .trim()
            .parse()
            .map_err(|_| AppError::BadRequest("「每批最大字数」必须是数字".into()))?;
        let (lo, hi) = (crate::translate::MIN_BATCH_CHARS, crate::translate::MAX_BATCH_CHARS);
        if !(lo..=hi).contains(&n) {
            return Err(AppError::BadRequest(format!(
                "「每批最大字数」需在 {lo} - {hi} 之间"
            )));
        }
    }
    // LOGO 模式校验
    if let Some(mode) = settings.get("logo_mode") {
        if !["text", "icon_text", "image"].contains(&mode.as_str()) {
            return Err(AppError::BadRequest("LOGO 模式非法".into()));
        }
    }
    // 链接打开方式校验
    if let Some(mode) = settings.get("link_open_mode") {
        if !["default", "custom"].contains(&mode.as_str()) {
            return Err(AppError::BadRequest("链接打开方式非法".into()));
        }
    }
    if let Some(p) = settings.get("browser_path") {
        let p = p.trim();
        if !p.is_empty() && !Path::new(p).is_file() {
            return Err(AppError::BadRequest("浏览器路径不存在".into()));
        }
    }
    // 代理设置校验
    if let Some(mode) = settings.get("proxy_mode") {
        if !["system", "none", "custom"].contains(&mode.as_str()) {
            return Err(AppError::BadRequest("代理模式非法".into()));
        }
    }
    if let Some(url) = settings.get("proxy_url") {
        let u = url.trim();
        if !u.is_empty() && !u.contains("://") && !u.contains(':') {
            return Err(AppError::BadRequest("代理地址格式不正确（如 127.0.0.1:7890 或 http://host:port）".into()));
        }
    }
    // 布尔开关归一化
    for key in ["close_to_tray"] {
        if let Some(v) = settings.get(key) {
            let on = matches!(v.to_lowercase().as_str(), "1" | "true" | "on" | "yes");
            settings.insert(key.into(), if on { "1".into() } else { "0".into() });
        }
    }
    repository::settings::set_many(&state.db, &settings).await?;
    // 如果存储相关设置变更，重置存储单例
    if settings.contains_key("local_upload_dir") || settings.contains_key("local_url_prefix") {
        let new_storage = crate::storage::get_storage(&state.db, &state.data_dir)
            .await
            .map_err(crate::error::AppError::Storage)?;
        state.reset_storage(new_storage).await;
    }
    // 代理设置变更：重建 HTTP 客户端
    if settings.contains_key("proxy_mode") || settings.contains_key("proxy_url") {
        crate::collector::http::apply_proxy_settings(&state).await;
    }
    Ok(())
}

/// 获取代理状态：当前模式、生效代理地址（诊断用，仅管理员）
#[tauri::command]
pub async fn get_proxy_status(
    state: State<'_, AppState>,
) -> CmdResult<HashMap<String, String>> {
    let _user = require_admin(&state.auth).await?;
    let mut out = HashMap::new();
    let mode = repository::settings::get(&state.db, "proxy_mode")
        .await?
        .unwrap_or_else(|| "system".into());
    let custom = repository::settings::get(&state.db, "proxy_url")
        .await?
        .unwrap_or_default();
    let effective = crate::collector::http::current_effective_proxy(&state).await;
    out.insert("mode".into(), mode);
    out.insert("custom_url".into(), custom);
    out.insert("effective".into(), effective.unwrap_or_else(|| "直连（无代理）".into()));
    Ok(out)
}

/// 打开外部链接（http/https）：按设置用系统默认浏览器或指定浏览器打开。
/// 所有用户可用（正文里的外链点击，不涉及敏感数据）。
#[tauri::command]
pub async fn open_external_url(state: State<'_, AppState>, url: String) -> CmdResult<()> {
    let url = url.trim();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(AppError::BadRequest("仅支持 http/https 链接".into()));
    }
    // 防命令注入：裸双引号会破坏 cmd start 的引号包裹
    if url.contains('"') {
        return Err(AppError::BadRequest("链接地址非法".into()));
    }
    let mode = repository::settings::get(&state.db, "link_open_mode")
        .await?
        .unwrap_or_else(|| "default".into());
    let browser = repository::settings::get(&state.db, "browser_path")
        .await?
        .unwrap_or_default();
    let custom = mode == "custom" && !browser.trim().is_empty();

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        if custom {
            std::process::Command::new(browser.trim())
                .arg(url)
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .spawn()
                .map_err(|e| AppError::BadRequest(format!("启动指定浏览器失败: {}", e)))?;
        } else {
            // URL 用引号包裹，避免 & 等字符被 cmd 当作命令分隔符
            std::process::Command::new("cmd")
                .raw_arg(format!("/C start \"\" \"{}\"", url))
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .spawn()
                .map_err(|e| AppError::BadRequest(format!("打开链接失败: {}", e)))?;
        }
    }
    #[cfg(not(windows))]
    {
        if custom {
            std::process::Command::new(browser.trim())
                .arg(url)
                .spawn()
                .map_err(|e| AppError::BadRequest(format!("启动指定浏览器失败: {}", e)))?;
        } else {
            #[cfg(target_os = "macos")]
            let opener = "open";
            #[cfg(all(unix, not(target_os = "macos")))]
            let opener = "xdg-open";
            std::process::Command::new(opener)
                .arg(url)
                .spawn()
                .map_err(|e| AppError::BadRequest(format!("打开链接失败: {}", e)))?;
        }
    }
    Ok(())
}

/// 返回上传根目录的绝对路径（供前端用 convertFileSrc 将其拼接为 asset URL）
#[tauri::command]
pub async fn get_upload_base_dir(state: State<'_, AppState>) -> CmdResult<String> {
    Ok(state.upload_base_dir.to_string_lossy().to_string())
}

/// 上传品牌图片（仅管理员）。
/// kind = "image"：图片 LOGO（铺满左上角）；kind = "icon"：图标+文字模式的图标。
/// 固定保存到 logo 子目录，替换并删除旧图。
#[tauri::command]
pub async fn upload_logo(
    state: State<'_, AppState>,
    file_path: String,
    kind: String,
) -> CmdResult<String> {
    let _user = require_admin(&state.auth).await?;

    let (setting_key, file_stem) = match kind.as_str() {
        "image" => ("logo_image_path", "logo"),
        "icon" => ("logo_icon_path", "icon"),
        _ => return Err(AppError::BadRequest("kind 必须为 image 或 icon".into())),
    };

    let ext = Path::new(&file_path)
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !["jpg", "jpeg", "png", "webp", "gif", "svg", "ico"].contains(&ext.as_str()) {
        return Err(AppError::BadRequest("LOGO 仅支持 jpg/png/webp/gif/svg/ico".into()));
    }

    let data = tokio::fs::read(&file_path)
        .await
        .map_err(AppError::Io)?;
    let storage = state.storage.get().await;

    // 删除旧图
    if let Some(old) = repository::settings::get(&state.db, setting_key).await? {
        if !old.is_empty() {
            let _ = storage.delete(&old).await;
        }
    }

    let saved = storage
        .save_named(
            bytes::Bytes::from(data),
            &format!("{}.{}", file_stem, ext),
            "logo",
        )
        .await
        .map_err(AppError::Storage)?;
    repository::settings::set(&state.db, setting_key, &saved).await?;
    Ok(saved)
}

/// 清除品牌图片（仅管理员）。kind = "image" | "icon"
#[tauri::command]
pub async fn clear_logo(state: State<'_, AppState>, kind: String) -> CmdResult<()> {
    let _user = require_admin(&state.auth).await?;
    let setting_key = match kind.as_str() {
        "image" => "logo_image_path",
        "icon" => "logo_icon_path",
        _ => return Err(AppError::BadRequest("kind 必须为 image 或 icon".into())),
    };
    let storage = state.storage.get().await;
    if let Some(old) = repository::settings::get(&state.db, setting_key).await? {
        if !old.is_empty() {
            let _ = storage.delete(&old).await;
        }
    }
    repository::settings::set(&state.db, setting_key, "").await?;
    Ok(())
}
