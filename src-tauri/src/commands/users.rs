// 用户管理命令（需要"用户管理"功能权限）
use serde::Deserialize;
use tauri::State;

use crate::auth::{hash_password, require_feature, FEATURE_USER};
use crate::db::repository;
use crate::error::{AppError, CmdResult};
use crate::state::AppState;

#[tauri::command]
pub async fn list_users(state: State<'_, AppState>) -> CmdResult<Vec<repository::users::UserItem>> {
    require_feature(&state.db, &state.auth, FEATURE_USER).await?;
    Ok(repository::users::list_all(&state.db).await?)
}

#[tauri::command]
pub async fn list_users_page(
    state: State<'_, AppState>,
    page: i64,
    page_size: i64,
    search: Option<String>,
) -> CmdResult<repository::Paged<repository::users::UserItem>> {
    require_feature(&state.db, &state.auth, FEATURE_USER).await?;
    let (page, page_size) = repository::clamp_page(page, page_size);
    Ok(repository::users::list_all_paged(
        &state.db,
        page_size,
        (page - 1) * page_size,
        search.as_deref(),
    )
    .await?)
}

/// 作者列表（公开，只返回有对当前访问者可见资源的用户）
#[tauri::command]
pub async fn list_authors(
    state: State<'_, AppState>,
) -> CmdResult<Vec<repository::users::AuthorItem>> {
    let level = crate::auth::viewer_level(&state.auth).await;
    Ok(repository::users::list_authors(&state.db, level).await?)
}

/// 作者列表（分页，公开）
#[tauri::command]
pub async fn list_authors_page(
    state: State<'_, AppState>,
    page: i64,
    page_size: i64,
    search: Option<String>,
) -> CmdResult<repository::Paged<repository::users::AuthorItem>> {
    let level = crate::auth::viewer_level(&state.auth).await;
    let (page, page_size) = repository::clamp_page(page, page_size);
    Ok(repository::users::list_authors_paged(
        &state.db,
        level,
        page_size,
        (page - 1) * page_size,
        search.as_deref(),
    )
    .await?)
}

#[derive(Debug, Deserialize)]
pub struct AdminAvatarPayload {
    pub user_id: i64,
    pub ext: String,
    /// PNG/JPEG/WebP 图片字节
    pub data: Vec<u8>,
}

/// 管理员为任意账号设置头像（前端裁剪后的字节）
#[tauri::command]
pub async fn admin_set_user_avatar(
    state: State<'_, AppState>,
    payload: AdminAvatarPayload,
) -> CmdResult<String> {
    let operator = require_feature(&state.db, &state.auth, FEATURE_USER).await?;
    let target = repository::users::find_by_id(&state.db, payload.user_id)
        .await?
        .ok_or(AppError::NotFound)?;
    // 管理员账户的头像仅管理员可改（防止用户管理者越权）
    if target.is_admin && !operator.is_admin {
        return Err(AppError::Forbidden);
    }
    let ext = payload.ext.trim_start_matches('.').to_lowercase();
    if !matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "webp" | "gif") {
        return Err(AppError::BadRequest("仅支持 jpg/png/webp/gif 图片".into()));
    }
    if payload.data.is_empty() || payload.data.len() > 10 * 1024 * 1024 {
        return Err(AppError::BadRequest("图片为空或超过 10MB".into()));
    }

    let storage = state.storage.get().await;
    let filename = format!("avatar_{}.{}", target.id, ext);
    let saved = storage
        .save(bytes::Bytes::from(payload.data), &filename, "avatars")
        .await
        .map_err(AppError::Storage)?;

    if !target.avatar_path.is_empty() {
        let _ = storage.delete(&target.avatar_path).await;
    }
    repository::users::update_avatar(&state.db, target.id, &saved).await?;
    // 改的是自己：同步当前登录会话，避免界面头像停留旧值
    if target.id == operator.id {
        let path = saved.clone();
        state.auth.update_user(|s| s.avatar_path = path).await;
    }
    Ok(saved)
}

/// 管理员创建用户
#[derive(Debug, Deserialize)]
pub struct CreateUserPayload {
    pub username: String,
    pub nickname: String,
    pub email: String,
    pub password: String,
    #[serde(default = "default_permission")]
    pub permission_level: i64,
}
fn default_permission() -> i64 { 0 }

#[tauri::command]
pub async fn create_user(
    state: State<'_, AppState>,
    payload: CreateUserPayload,
) -> CmdResult<i64> {
    require_feature(&state.db, &state.auth, FEATURE_USER).await?;
    let username = payload.username.trim().to_string();
    let nickname = payload.nickname.trim().to_string();
    let email = payload.email.trim().to_string();

    if username.len() < 2 || username.len() > 32 {
        return Err(AppError::BadRequest("用户名长度需为 2-32 个字符".into()));
    }
    if nickname.is_empty() || nickname.len() > 32 {
        return Err(AppError::BadRequest("昵称为空或过长（最多 32 字符）".into()));
    }
    if !email.is_empty() {
        if email.len() > 100 || !email.contains('@') {
            return Err(AppError::BadRequest("邮箱格式不正确".into()));
        }
    }
    if payload.password.len() < 6 || payload.password.len() > 128 {
        return Err(AppError::BadRequest("密码长度需为 6-128 位".into()));
    }
    if !(0..=5).contains(&payload.permission_level) {
        return Err(AppError::BadRequest("权限值必须为 0-5".into()));
    }

    if repository::users::username_exists(&state.db, &username).await? {
        return Err(AppError::BadRequest("用户名已被占用".into()));
    }
    if !email.is_empty() && repository::users::email_exists(&state.db, &email).await? {
        return Err(AppError::BadRequest("邮箱已被注册".into()));
    }

    let hash = hash_password(&payload.password)?;
    let total = repository::users::count(&state.db).await?;
    let is_admin = total == 0; // 首个用户自动管理员
    let result = sqlx::query(
        "INSERT INTO users (username, password_hash, nickname, email, is_admin, permission_level) \
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&username)
    .bind(&hash)
    .bind(&nickname)
    .bind(&email)
    .bind(if is_admin { 1 } else { 0 })
    .bind(if is_admin { 5 } else { payload.permission_level })
    .execute(&state.db)
    .await?;
    Ok(result.last_insert_rowid())
}

#[derive(Debug, Deserialize)]
pub struct DeleteUsersPayload {
    pub ids: Vec<i64>,
}

/// 批量删除结果：跳过的为自己/权限不足等不可删账户
#[derive(Debug, serde::Serialize)]
pub struct DeleteUsersResult {
    pub deleted: usize,
    pub skipped: usize,
}

#[tauri::command]
pub async fn delete_users(
    state: State<'_, AppState>,
    payload: DeleteUsersPayload,
) -> CmdResult<DeleteUsersResult> {
    let operator = require_feature(&state.db, &state.auth, FEATURE_USER).await?;
    let total = payload.ids.len();
    if total == 0 {
        return Ok(DeleteUsersResult { deleted: 0, skipped: 0 });
    }

    // 初始 admin：users 表中 id 最小的账户（启动引导创建，恒为管理员），拥有至高删除权
    let first_admin: i64 = sqlx::query_scalar("SELECT MIN(id) FROM users")
        .fetch_one(&state.db)
        .await?;
    let is_first_admin = operator.is_admin && operator.id == first_admin;

    // 过滤：不删自己
    let mut ids: Vec<i64> = payload.ids.into_iter().filter(|&id| id != operator.id).collect();

    // 权限规则（所有人一致）：不能删除权限值 >= 自己的账户。
    // 唯一例外：初始 admin 可删任何账户（含权限 5 与其他管理员），
    // 前端对其删除权限 5 目标时会二次确认。
    if !ids.is_empty() && !is_first_admin {
        let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT id FROM users WHERE id IN ({placeholders}) AND (is_admin = 1 OR permission_level >= {})",
            operator.permission_level
        );
        let mut q = sqlx::query_scalar::<_, i64>(&sql);
        for &id in &ids {
            q = q.bind(id);
        }
        let blocked: std::collections::HashSet<i64> = q.fetch_all(&state.db).await?.into_iter().collect();
        ids.retain(|id| !blocked.contains(id));
    }

    let skipped = total - ids.len();
    if ids.is_empty() {
        return Ok(DeleteUsersResult { deleted: 0, skipped });
    }

    // 删除用户并清理头像文件
    let avatars = repository::users::delete_many(&state.db, &ids).await?;
    let storage = state.storage.get().await;
    for path in avatars {
        let _ = storage.delete(&path).await;
    }
    Ok(DeleteUsersResult { deleted: ids.len(), skipped })
}

#[derive(Debug, Deserialize)]
pub struct ResetPasswordPayload {
    pub user_id: i64,
    pub new_password: String,
}

#[tauri::command]
pub async fn reset_user_password(
    state: State<'_, AppState>,
    payload: ResetPasswordPayload,
) -> CmdResult<()> {
    require_feature(&state.db, &state.auth, FEATURE_USER).await?;
    if !(6..=128).contains(&payload.new_password.len()) {
        return Err(AppError::BadRequest("密码长度需为 6-128 位".into()));
    }
    let exists = repository::users::find_by_id(&state.db, payload.user_id)
        .await?
        .is_some();
    if !exists {
        return Err(AppError::NotFound);
    }
    let hash = hash_password(&payload.new_password)?;
    repository::users::update_password(&state.db, payload.user_id, &hash).await?;
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct AdminUpdateUserPayload {
    pub user_id: i64,
    pub username: String,
    pub nickname: String,
    pub email: String,
    pub bio: String,
    pub permission_level: i64,
    /// 留空/不传表示不修改密码
    pub new_password: Option<String>,
}

/// 管理员编辑用户的全部信息
#[tauri::command]
pub async fn update_user(
    state: State<'_, AppState>,
    payload: AdminUpdateUserPayload,
) -> CmdResult<()> {
    let operator = require_feature(&state.db, &state.auth, FEATURE_USER).await?;

    let username = payload.username.trim();
    let nickname = payload.nickname.trim();
    let email = payload.email.trim();

    if username.len() < 2 || username.len() > 32 {
        return Err(AppError::BadRequest("用户名长度需为 2-32 个字符".into()));
    }
    if nickname.is_empty() || nickname.len() > 32 {
        return Err(AppError::BadRequest("昵称为空或过长（最多 32 字符）".into()));
    }
    if !email.is_empty() {
        if email.len() > 100 || !email.contains('@') {
            return Err(AppError::BadRequest("邮箱格式不正确".into()));
        }
    }
    if payload.bio.chars().count() > 500 {
        return Err(AppError::BadRequest("简介过长（最多 500 字符）".into()));
    }
    if let Some(pwd) = &payload.new_password {
        if !(6..=128).contains(&pwd.len()) {
            return Err(AppError::BadRequest("密码长度需为 6-128 位".into()));
        }
    }

    let target = repository::users::find_by_id(&state.db, payload.user_id)
        .await?
        .ok_or(AppError::NotFound)?;

    // 仅管理员可以编辑管理员账户（防止用户管理者越权）
    if target.is_admin && !operator.is_admin {
        return Err(AppError::Forbidden);
    }

    // 用户名唯一性（排除自身）
    if username != target.username {
        if let Some(other) = repository::users::find_by_username(&state.db, username).await? {
            if other.id != target.id {
                return Err(AppError::BadRequest("用户名已被占用".into()));
            }
        }
    }
    // 邮箱唯一性（排除自身）
    if !email.is_empty() && email != target.email {
        let dup: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM users WHERE email = ? AND id != ?",
        )
        .bind(email)
        .bind(target.id)
        .fetch_one(&state.db)
        .await?;
        if dup > 0 {
            return Err(AppError::BadRequest("邮箱已被其他账户使用".into()));
        }
    }

    if target.is_admin {
        // 管理员账户：基础信息可改，权限恒为 5
        repository::users::admin_update_admin_profile(
            &state.db,
            target.id,
            username,
            nickname,
            email,
            &payload.bio,
        )
        .await?;
    } else {
        repository::users::admin_update(
            &state.db,
            target.id,
            username,
            nickname,
            email,
            &payload.bio,
            payload.permission_level,
        )
        .await?;
    }

    if let Some(pwd) = payload.new_password {
        if !pwd.is_empty() {
            let hash = hash_password(&pwd)?;
            repository::users::update_password(&state.db, target.id, &hash).await?;
        }
    }

    // 编辑的是自己：同步当前登录会话中的资料
    if target.id == operator.id {
        let un = username.to_string();
        let nn = nickname.to_string();
        let em = email.to_string();
        let bio = payload.bio.clone();
        state.auth.update_user(|s| {
            s.username = un;
            s.nickname = nn;
            s.email = em;
            s.bio = bio;
        }).await;
    }
    Ok(())
}
