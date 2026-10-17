// 采集插件管理：内置插件同步落盘、第三方插件导入
use std::path::PathBuf;
use serde::Serialize;
use tauri::State;

use crate::auth::{require_feature, FEATURE_ARTICLE_OWN};
use crate::error::{AppError, CmdResult};
use crate::state::AppState;

#[derive(Debug, Serialize)]
pub struct CollectorInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub builtin: bool,
    pub patterns: Vec<String>,
    /// 插件完整 JSON（前端运行时按此提取字段）
    pub raw: String,
}

const BUILTIN_FILES: &[(&str, &str)] = &[(
    "fitgirl.yunji.json",
    include_str!("../../resources/collectors/fitgirl.yunji.json"),
)];

fn collectors_dir(state: &AppState) -> PathBuf {
    state.data_dir.join("collectors")
}

/// 确保插件目录存在；内置插件始终以程序内嵌版本为准（升级时自动同步，用户无法通过导入覆盖）
fn ensure_collectors_dir(state: &AppState) -> Result<PathBuf, AppError> {
    let dir = collectors_dir(state);
    std::fs::create_dir_all(&dir).map_err(AppError::Io)?;
    for (name, content) in BUILTIN_FILES {
        let p = dir.join(name);
        let needs_write = match std::fs::read_to_string(&p) {
            Ok(existing) => existing != *content,
            Err(_) => true,
        };
        if needs_write {
            let _ = std::fs::write(&p, content);
        }
    }
    Ok(dir)
}

fn parse_collector(raw: &str, builtin: bool) -> Option<CollectorInfo> {
    let v: serde_json::Value = serde_json::from_str(raw).ok()?;
    let obj = v.as_object()?;
    let id = obj.get("id")?.as_str()?.to_string();
    let name = obj.get("name").and_then(|x| x.as_str()).unwrap_or(&id).to_string();
    if id.is_empty() || !obj.contains_key("fields") {
        return None;
    }
    let version = obj
        .get("version")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let description = obj
        .get("description")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let patterns = obj
        .get("urlPattern")
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|p| p.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    Some(CollectorInfo { id, name, version, description, builtin, patterns, raw: raw.to_string() })
}

/// 列出全部采集插件
#[tauri::command]
pub async fn list_collectors(state: State<'_, AppState>) -> CmdResult<Vec<CollectorInfo>> {
    let dir = ensure_collectors_dir(&state)?;
    let mut out = Vec::new();
    let entries = std::fs::read_dir(&dir).map_err(AppError::Io)?;
    for ent in entries.flatten() {
        let path = ent.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(raw) = std::fs::read_to_string(&path) else { continue };
        let builtin = BUILTIN_FILES
            .iter()
            .any(|(name, _)| path.file_name().and_then(|n| n.to_str()) == Some(*name));
        match parse_collector(&raw, builtin) {
            Some(info) => out.push(info),
            None => tracing::warn!("无法解析采集插件，已跳过: {}", path.display()),
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// 从本地文件导入第三方采集插件（文件名为 <id>.yunji.json）
#[tauri::command]
pub async fn import_collector(state: State<'_, AppState>, source_path: String) -> CmdResult<CollectorInfo> {
    require_feature(&state.db, &state.auth, FEATURE_ARTICLE_OWN).await?;
    let dir = ensure_collectors_dir(&state)?;
    let raw = std::fs::read_to_string(&source_path).map_err(AppError::Io)?;
    let info = parse_collector(&raw, false)
        .ok_or_else(|| AppError::BadRequest("插件格式无效：需要 id / name / fields 字段".into()))?;

    let safe_id: String = info
        .id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    if safe_id.is_empty() {
        return Err(AppError::BadRequest("插件 id 非法".into()));
    }
    let dest_name = format!("{}.yunji.json", safe_id);
    // 不允许覆盖内置插件
    if BUILTIN_FILES.iter().any(|(name, _)| *name == dest_name) {
        return Err(AppError::BadRequest("与内置插件 id 冲突，无法导入".into()));
    }
    std::fs::write(dir.join(&dest_name), raw).map_err(AppError::Io)?;
    Ok(info)
}
