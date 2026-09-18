// 合集命令
use tauri::State;

use crate::auth::{require_feature, FEATURE_COLLECTION, FEATURE_COLLECTION_OWN};
use crate::db::repository;
use crate::error::{AppError, CmdResult};
use crate::state::AppState;

pub use repository::collections::{Collection, CreateCollection};

/// 选择合集写操作的权限：作者本人用「合集(自己)」，他人用「合集(管理)」
async fn require_collection_write(
    state: &AppState,
    collection_user_id: Option<i64>,
) -> Result<crate::auth::UserSession, AppError> {
    let user = crate::auth::require_login(&state.auth).await?;
    let is_own = collection_user_id.map(|uid| uid == user.id).unwrap_or(false);
    let key = if is_own {
        FEATURE_COLLECTION_OWN
    } else {
        FEATURE_COLLECTION
    };
    require_feature(&state.db, &state.auth, key).await
}

#[tauri::command]
pub async fn list_collections(state: State<'_, AppState>) -> CmdResult<Vec<Collection>> {
    Ok(repository::collections::list(&state.db).await?)
}

#[tauri::command]
pub async fn list_collections_page(
    state: State<'_, AppState>,
    page: i64,
    page_size: i64,
    search: Option<String>,
) -> CmdResult<repository::Paged<Collection>> {
    let (page, page_size) = repository::clamp_page(page, page_size);
    Ok(repository::collections::list_paged(
        &state.db,
        page_size,
        (page - 1) * page_size,
        search.as_deref(),
    )
    .await?)
}

#[tauri::command]
pub async fn get_collection(state: State<'_, AppState>, cid: i64) -> CmdResult<Collection> {
    Ok(repository::collections::get(&state.db, cid).await?)
}

/// 合集正文中的首个本地图片相对路径（如 content/xxx.jpg），用作封面回退
fn first_image_in_content(content: &str) -> Option<String> {
    for line in content.lines() {
        for m in line.match_indices("![") {
            let rest = &line[m.0 + 2..];
            if let Some(close) = rest.find("](") {
                let after = &rest[close + 2..];
                if let Some(end) = after.find(')') {
                    let url = after[..end].trim();
                    if !url.is_empty()
                        && !url.starts_with("http://")
                        && !url.starts_with("https://")
                        && !url.starts_with("data:")
                        && !url.contains("__pending__")
                    {
                        return Some(url.to_string());
                    }
                }
            }
        }
    }
    None
}

/// 合集封面回退：未设置封面时取正文首图（直接引用路径，不复制文件）
fn fallback_cover(payload: &CreateCollection) -> String {
    if !payload.thumbnail_path.trim().is_empty() {
        return payload.thumbnail_path.clone();
    }
    first_image_in_content(&payload.content).unwrap_or_default()
}

#[tauri::command]
pub async fn create_collection(
    state: State<'_, AppState>,
    mut payload: CreateCollection,
) -> CmdResult<i64> {
    // 新建合集属于作者本人，用「合集(自己)」权限
    let operator = require_feature(&state.db, &state.auth, FEATURE_COLLECTION_OWN).await?;
    // 管理员马甲：指定以其他用户身份创建
    let author_id = if let Some(aid) = payload.author_id {
        let target = repository::users::find_by_id(&state.db, aid).await?
            .ok_or(AppError::BadRequest("指定的作者不存在".into()))?;
        if !operator.is_admin && target.id != operator.id {
            return Err(AppError::Forbidden);
        }
        target.id
    } else {
        operator.id
    };
    payload.thumbnail_path = fallback_cover(&payload);
    Ok(repository::collections::create(&state.db, &payload, author_id).await?)
}

#[tauri::command]
pub async fn update_collection(
    state: State<'_, AppState>,
    cid: i64,
    mut payload: CreateCollection,
) -> CmdResult<()> {
    let col = repository::collections::get(&state.db, cid).await?;
    let operator = require_collection_write(&state, col.user_id).await?;
    // 管理员马甲：编辑时可改作者
    if let Some(aid) = payload.author_id {
        let target = repository::users::find_by_id(&state.db, aid).await?
            .ok_or(AppError::BadRequest("指定的作者不存在".into()))?;
        if !operator.is_admin && target.id != operator.id {
            return Err(AppError::Forbidden);
        }
        sqlx::query("UPDATE collections SET user_id=? WHERE id=?")
            .bind(target.id)
            .bind(cid)
            .execute(&state.db)
            .await?;
    }
    // 封面回退：清空封面时取正文首图（引用，不复制）
    payload.thumbnail_path = fallback_cover(&payload);
    repository::collections::update(&state.db, cid, &payload).await?;
    Ok(())
}

#[tauri::command]
pub async fn delete_collection(state: State<'_, AppState>, cid: i64) -> CmdResult<()> {
    let col = repository::collections::get(&state.db, cid).await?;
    let _user = require_collection_write(&state, col.user_id).await?;
    repository::collections::soft_delete(&state.db, cid).await?;
    Ok(())
}

#[tauri::command]
pub async fn restore_collection(state: State<'_, AppState>, cid: i64) -> CmdResult<()> {
    let col = repository::collections::get(&state.db, cid).await?;
    let _user = require_collection_write(&state, col.user_id).await?;
    repository::collections::restore(&state.db, cid).await?;
    Ok(())
}

#[tauri::command]
pub async fn permanent_delete_collection(
    state: State<'_, AppState>,
    cid: i64,
) -> CmdResult<()> {
    let col = repository::collections::get(&state.db, cid).await?;
    let _user = require_collection_write(&state, col.user_id).await?;
    // 清理缩略图
    let storage = state.storage.get().await;
    if !col.thumbnail_path.is_empty() {
        let _ = storage.delete(&col.thumbnail_path).await;
    }
    repository::collections::permanent_delete(&state.db, cid).await?;
    Ok(())
}

#[tauri::command]
pub async fn sync_collection_resources(
    state: State<'_, AppState>,
    cid: i64,
    resource_ids: Vec<i64>,
) -> CmdResult<()> {
    let col = repository::collections::get(&state.db, cid).await?;
    let _user = require_collection_write(&state, col.user_id).await?;
    repository::collections::sync_resources(&state.db, cid, &resource_ids).await?;
    Ok(())
}

#[tauri::command]
pub async fn list_collection_resource_ids(
    state: State<'_, AppState>,
    cid: i64,
) -> CmdResult<Vec<i64>> {
    Ok(repository::collections::list_resource_ids(&state.db, cid).await?)
}
