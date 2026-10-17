// BT 种子相关命令：文件列表缓存 + .torrent 解析 + 磁力下载
// 获取 BT 文件、查看文件列表、下载/定位均对能阅读文章的用户开放
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::auth::ensure_readable;
use crate::bencode::{self, TorrentFile as ParsedTorrentFile};
use crate::db::repository;
use crate::error::CmdResult;
use crate::magnet;
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct ResourceFile {
    pub id: i64,
    pub resource_id: i64,
    pub item_id: i64,
    pub name: String,
    pub size: i64,
    pub sort_order: i64,
}

#[derive(Debug, Deserialize)]
pub struct SaveFilesPayload {
    pub item_id: i64,
    pub files: Vec<FileEntry>,
}

#[derive(Debug, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub size: i64,
}

/// 确保当前访问者可以阅读该资源
async fn ensure_resource_readable(state: &AppState, rid: i64) -> CmdResult<()> {
    let resource = repository::resources::get(&state.db, rid).await?;
    ensure_readable(&state.auth, &resource).await
}

/// 获取资源的文件列表缓存（能阅读即可）
#[tauri::command]
pub async fn get_resource_files(
    state: State<'_, AppState>,
    rid: i64,
    item_id: Option<i64>,
) -> CmdResult<Vec<ResourceFile>> {
    ensure_resource_readable(&state, rid).await?;
    let item_id = item_id.unwrap_or(0);
    let rows = repository::torrent_files::list(&state.db, rid, item_id).await?;
    Ok(rows
        .into_iter()
        .map(|f| ResourceFile {
            id: f.id,
            resource_id: f.resource_id,
            item_id: f.item_id,
            name: f.name,
            size: f.size,
            sort_order: f.sort_order,
        })
        .collect())
}

/// 保存文件列表到缓存（能阅读该资源即可回写缓存）
#[tauri::command]
pub async fn save_resource_files(
    state: State<'_, AppState>,
    rid: i64,
    payload: SaveFilesPayload,
) -> CmdResult<()> {
    ensure_resource_readable(&state, rid).await?;
    let files: Vec<(String, i64)> = payload
        .files
        .iter()
        .map(|f| (f.name.clone(), f.size))
        .collect();
    repository::torrent_files::save(&state.db, rid, payload.item_id, &files).await?;
    Ok(())
}

/// 解析本地 .torrent 文件，返回文件列表（不写库）
/// file_path 是已上传到 storage 的相对路径；路径只能来自用户可阅读的资源
#[tauri::command]
pub async fn parse_torrent_file(
    state: State<'_, AppState>,
    file_path: String,
) -> CmdResult<Vec<ParsedTorrentFile>> {
    let storage = state.storage.get().await;
    let data = storage.read(&file_path).await.map_err(crate::error::AppError::Storage)?;
    let files = bencode::parse_torrent_files(&data);
    Ok(files)
}

/// 提交磁力获取任务（异步）：能阅读该资源即可操作
#[tauri::command]
pub async fn fetch_torrent(state: State<'_, AppState>, rid: i64, item_id: i64) -> CmdResult<()> {
    ensure_resource_readable(&state, rid).await?;
    magnet::submit(&state, rid, item_id);
    Ok(())
}

/// 查询磁力获取状态
#[tauri::command]
pub async fn get_fetch_status(rid: i64, item_id: i64) -> CmdResult<magnet::FetchStatus> {
    Ok(magnet::get_status(rid, item_id))
}

#[derive(Debug, Serialize)]
pub struct ItemFileStatus {
    pub item_id: i64,
    pub exists: bool,
}

/// 批量检查文章各条目关联文件（种子/附件）在 storage 中是否还存在。
/// 用于前端发现文件被手动删除后的"丢失"状态。能阅读该文章即可检测。
#[tauri::command]
pub async fn check_resource_files(
    state: State<'_, AppState>,
    rid: i64,
) -> CmdResult<Vec<ItemFileStatus>> {
    ensure_resource_readable(&state, rid).await?;
    let items = repository::resources::get_items_for_resource(&state.db, rid).await?;
    let storage = state.storage.get().await;
    let base = storage.upload_dir();
    let mut out = Vec::new();
    for it in items {
        if it.file_path.is_empty() {
            continue;
        }
        let exists = base.join(&it.file_path).exists();
        out.push(ItemFileStatus {
            item_id: it.id,
            exists,
        });
    }
    Ok(out)
}

/// 在文件管理器中定位到 storage 中的文件（读者下载用，不做权限限制）
#[tauri::command]
pub async fn reveal_file_in_explorer(
    state: State<'_, AppState>,
    file_path: String,
) -> CmdResult<()> {
    let storage = state.storage.get().await;
    let full = storage.upload_dir().join(&file_path);
    if !full.exists() {
        return Err(crate::error::AppError::BadRequest(format!("文件不存在: {}", file_path)));
    }
    // Windows: explorer.exe /select,"<full_path>"
    // 两个坑：
    // 1. /select, 与路径必须在同一个参数中，分开传会导致资源管理器只打开默认目录
    // 2. 存储的相对路径使用正斜杠（magnets/xxx.torrent），join 后是混合斜杠，
    //    Windows 文件 API 能识别（exists 通过），但 explorer 的 /select 解析器
    //    不接受正斜杠，定位失败会回退打开"我的文档"——必须先把 / 替换为 \
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let path_native = full.display().to_string().replace('/', r"\");
        // raw_arg 原样拼接，避免 std 因路径含空格而给整个 "/select,..." 套上引号
        std::process::Command::new("explorer.exe")
            .raw_arg(format!(r#"/select,"{}""#, path_native))
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e| crate::error::AppError::BadRequest(format!("启动资源管理器失败: {}", e)))?;
    }
    #[cfg(not(windows))]
    {
        // macOS / Linux：打开文件所在目录
        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open")
                .arg("-R")
                .arg(&full)
                .spawn()
                .map_err(|e| crate::error::AppError::BadRequest(format!("启动 Finder 失败: {}", e)))?;
        }
        #[cfg(all(unix, not(target_os = "macos")))]
        {
            std::process::Command::new("xdg-open")
                .arg(full.parent().unwrap_or(std::path::Path::new(".")))
                .spawn()
                .map_err(|e| crate::error::AppError::BadRequest(format!("启动文件管理器失败: {}", e)))?;
        }
    }
    Ok(())
}

/// 用系统默认软件打开文件（读者下载用，不做权限限制）
#[tauri::command]
pub async fn open_file_with_default(
    state: State<'_, AppState>,
    file_path: String,
) -> CmdResult<()> {
    let storage = state.storage.get().await;
    let full = storage.upload_dir().join(&file_path);
    if !full.exists() {
        return Err(crate::error::AppError::BadRequest(format!("文件不存在: {}", file_path)));
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // 同样把正斜杠归一化为反斜杠，避免 ShellExecute 解析异常
        let path_native = full.display().to_string().replace('/', r"\");
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path_native])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e| crate::error::AppError::BadRequest(format!("打开文件失败: {}", e)))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&full)
            .spawn()
            .map_err(|e| crate::error::AppError::BadRequest(format!("打开文件失败: {}", e)))?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&full)
            .spawn()
            .map_err(|e| crate::error::AppError::BadRequest(format!("打开文件失败: {}", e)))?;
    }
    Ok(())
}
