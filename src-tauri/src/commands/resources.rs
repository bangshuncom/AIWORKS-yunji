// 资源命令
use tauri::State;

use crate::auth::{
    ensure_readable, require_feature, viewer_level, FEATURE_ARTICLE, FEATURE_ARTICLE_OWN,
    FEATURE_TRASH,
};
use crate::db::repository;
use crate::error::{AppError, CmdResult};
use crate::state::AppState;

pub use repository::resources::{
    BatchUpdate, CreateItem, CreateResource, ListParams, PaginatedResources, Resource,
};

/// 选择文章写操作的权限：作者本人用「文章(自己)」，他人用「文章(管理)」
async fn require_article_write(
    state: &AppState,
    resource_user_id: Option<i64>,
) -> Result<crate::auth::UserSession, AppError> {
    let user = crate::auth::require_login(&state.auth).await?;
    let is_own = resource_user_id.map(|uid| uid == user.id).unwrap_or(false);
    let key = if is_own {
        FEATURE_ARTICLE_OWN
    } else {
        FEATURE_ARTICLE
    };
    require_feature(&state.db, &state.auth, key).await
}

/// 为「只上传了种子、没有填磁力链接」的磁力种子项，从种子文件反推磁力链接。
/// info_hash = SHA1(info 字典)，另附带 dn（种子名）和 tr（tracker）。
/// 读取/解析失败时保持原样，不阻断文章保存。
async fn fill_magnets_from_torrents(state: &AppState, items: &mut [CreateItem]) {
    let storage = state.storage.get().await;
    for item in items.iter_mut() {
        if item.item_type != "magnet_torrent" {
            continue;
        }
        if !item.content.trim().is_empty() || item.file_path.is_empty() {
            continue;
        }
        match storage.read(&item.file_path).await {
            Ok(data) => {
                if let Some(magnet) = crate::bencode::build_magnet_link(&data) {
                    item.content = magnet;
                }
            }
            Err(e) => {
                tracing::warn!("读取种子文件生成磁力链接失败 {}: {}", item.file_path, e);
            }
        }
    }
}

#[tauri::command]
pub async fn list_resources(
    state: State<'_, AppState>,
    params: ListParams,
) -> CmdResult<PaginatedResources> {
    // 按读者权限等级过滤（未登录=0，管理员=5）
    let level = viewer_level(&state.auth).await;
    let result = repository::resources::list(&state.db, &params, level).await?;
    Ok(result)
}

#[tauri::command]
pub async fn get_resource(
    state: State<'_, AppState>,
    rid: i64,
) -> CmdResult<Resource> {
    let resource = repository::resources::get(&state.db, rid).await?;
    // 阅读权限检查：等级不足且未通过访问密码解锁时拒绝
    ensure_readable(&state.auth, &resource).await?;
    Ok(resource)
}

#[tauri::command]
pub async fn create_resource(
    state: State<'_, AppState>,
    mut payload: CreateResource,
) -> CmdResult<i64> {
    // 新建文章属于作者本人，用「文章(自己)」权限
    let operator = require_feature(&state.db, &state.auth, FEATURE_ARTICLE_OWN).await?;
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
    if payload.title.trim().is_empty() {
        return Err(AppError::BadRequest("标题不能为空".into()));
    }
    payload.title = payload.title.trim().to_string();
    // 上传了种子但没填磁力链接：保存时自动反推
    fill_magnets_from_torrents(&state, &mut payload.items).await;
    let rid = repository::resources::create(&state.db, &payload, author_id).await?;
    // 同步附件项
    if !payload.items.is_empty() {
        repository::resources::sync_items(&state.db, rid, &payload.items).await?;
    }
    // 同步标签
    if !payload.tag_ids.is_empty() {
        repository::resources::sync_tags(&state.db, rid, &payload.tag_ids).await?;
    }
    // 同步合集（一个资源可属于多个合集）
    repository::collections::sync_resource_collections(&state.db, rid, &payload.collection_ids).await?;
    // 同步分类（一个资源一个分类）
    repository::resources::sync_category(&state.db, rid, payload.category_id).await?;
    Ok(rid)
}

#[tauri::command]
pub async fn update_resource(
    state: State<'_, AppState>,
    rid: i64,
    mut payload: CreateResource,
) -> CmdResult<()> {
    let existing = repository::resources::get(&state.db, rid).await?;
    let _user = require_article_write(&state, existing.user_id).await?;
    // 管理员马甲：编辑时可改作者
    if let Some(aid) = payload.author_id {
        let operator = crate::auth::require_login(&state.auth).await?;
        let target = repository::users::find_by_id(&state.db, aid).await?
            .ok_or(AppError::BadRequest("指定的作者不存在".into()))?;
        if !operator.is_admin && target.id != operator.id {
            return Err(AppError::Forbidden);
        }
        sqlx::query("UPDATE resources SET user_id=? WHERE id=? AND deleted_at IS NULL")
            .bind(target.id)
            .bind(rid)
            .execute(&state.db)
            .await?;
    }
    if payload.title.trim().is_empty() {
        return Err(AppError::BadRequest("标题不能为空".into()));
    }
    payload.title = payload.title.trim().to_string();
    // 上传了种子但没填磁力链接：保存时自动反推
    fill_magnets_from_torrents(&state, &mut payload.items).await;
    repository::resources::update(&state.db, rid, &payload).await?;
    repository::resources::sync_items(&state.db, rid, &payload.items).await?;
    repository::resources::sync_tags(&state.db, rid, &payload.tag_ids).await?;
    // 同步合集（一个资源可属于多个合集）
    repository::collections::sync_resource_collections(&state.db, rid, &payload.collection_ids).await?;
    repository::resources::sync_category(&state.db, rid, payload.category_id).await?;
    Ok(())
}

#[tauri::command]
pub async fn batch_update_resources(
    state: State<'_, AppState>,
    payload: BatchUpdate,
) -> CmdResult<()> {
    // 批量操作视为管理行为，用「文章(管理)」权限
    require_feature(&state.db, &state.auth, FEATURE_ARTICLE).await?;
    repository::resources::batch_update(&state.db, &payload).await?;
    Ok(())
}

#[tauri::command]
pub async fn delete_resource(
    state: State<'_, AppState>,
    rid: i64,
) -> CmdResult<()> {
    let existing = repository::resources::get(&state.db, rid).await?;
    let _user = require_article_write(&state, existing.user_id).await?;
    repository::resources::soft_delete(&state.db, rid).await?;
    Ok(())
}

#[tauri::command]
pub async fn restore_resource(
    state: State<'_, AppState>,
    rid: i64,
) -> CmdResult<()> {
    require_feature(&state.db, &state.auth, FEATURE_TRASH).await?;
    repository::resources::restore(&state.db, rid).await?;
    Ok(())
}

#[tauri::command]
pub async fn permanent_delete_resource(
    state: State<'_, AppState>,
    rid: i64,
) -> CmdResult<()> {
    require_feature(&state.db, &state.auth, FEATURE_TRASH).await?;
    // 清理关联文件
    let storage = state.storage.get().await;
    let resource = repository::resources::get(&state.db, rid).await.ok();
    if let Some(r) = &resource {
        if !r.thumbnail_path.is_empty() {
            let _ = storage.delete(&r.thumbnail_path).await;
        }
        for item in &r.items {
            if !item.file_path.is_empty() {
                let _ = storage.delete(&item.file_path).await;
            }
        }
        for img in &r.images {
            let _ = storage.delete(&img.file_path).await;
        }
    }
    repository::resources::permanent_delete(&state.db, rid).await?;
    Ok(())
}

#[tauri::command]
pub async fn list_trash_resources(
    state: State<'_, AppState>,
) -> CmdResult<Vec<Resource>> {
    require_feature(&state.db, &state.auth, FEATURE_TRASH).await?;
    Ok(repository::resources::list_deleted(&state.db).await?)
}

#[tauri::command]
pub async fn list_trash_resources_page(
    state: State<'_, AppState>,
    page: i64,
    page_size: i64,
) -> CmdResult<repository::Paged<Resource>> {
    require_feature(&state.db, &state.auth, FEATURE_TRASH).await?;
    let (page, page_size) = repository::clamp_page(page, page_size);
    Ok(repository::resources::list_deleted_paged(
        &state.db,
        page_size,
        (page - 1) * page_size,
    )
    .await?)
}

#[derive(Debug, serde::Deserialize)]
pub struct AccessPayload {
    pub password: String,
}

#[tauri::command]
pub async fn check_resource_access(
    state: State<'_, AppState>,
    rid: i64,
    payload: AccessPayload,
) -> CmdResult<bool> {
    let resource = repository::resources::get(&state.db, rid).await?;
    if resource.access_password.is_empty() {
        return Ok(true);
    }
    let ok = verify_password(&payload.password, &resource.access_password)?;
    if ok {
        state.auth.grant_resource(rid).await;
    }
    Ok(ok)
}

/// 上传资源附件文件（torrent / 普通文件），返回相对存储路径。
/// 附件文件在 sync_items 时与 resource 绑定，因此本命令不依赖 rid。
#[tauri::command]
pub async fn upload_resource_file(
    state: State<'_, AppState>,
    file_path: String,
    subdir: String,
) -> CmdResult<String> {
    // 附件上传服务于文章编辑，用「文章(自己)」权限
    require_feature(&state.db, &state.auth, FEATURE_ARTICLE_OWN).await?;
    let storage = state.storage.get().await;

    let data = std::fs::read(&file_path).map_err(crate::error::AppError::Io)?;
    let bytes = bytes::Bytes::from(data);
    let filename = std::path::Path::new(&file_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("file");
    // 直接上传的 BT 种子保留原始文件名（重名追加 _N）；其他附件沿用时间戳命名
    let is_torrent = subdir == "torrents"
        || std::path::Path::new(filename)
            .extension()
            .and_then(|s| s.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("torrent"));
    let saved = if is_torrent {
        storage.save_named(bytes, filename, &subdir).await
    } else {
        storage.save(bytes, filename, &subdir).await
    }
    .map_err(crate::error::AppError::Storage)?;
    Ok(saved)
}

fn verify_password(password: &str, hash: &str) -> Result<bool, AppError> {
    crate::auth::verify_password(password, hash)
}
