// 认证命令
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::auth::{hash_password, require_login, verify_password, UserSession};
use crate::db::repository;
use crate::error::{AppError, CmdResult};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
pub struct LoginPayload {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct UserInfo {
    pub id: i64,
    pub username: String,
    pub nickname: String,
    pub email: String,
    pub bio: String,
    pub avatar_path: String,
    pub is_admin: bool,
    pub permission_level: i64,
}

impl From<UserSession> for UserInfo {
    fn from(u: UserSession) -> Self {
        Self {
            id: u.id,
            username: u.username,
            nickname: u.nickname,
            email: u.email,
            bio: u.bio,
            avatar_path: u.avatar_path,
            is_admin: u.is_admin,
            permission_level: u.permission_level,
        }
    }
}

// --- 校验辅助 ---

fn validate_username(username: &str) -> Result<(), AppError> {
    let name = username.trim();
    if name.len() < 2 || name.len() > 32 {
        return Err(AppError::BadRequest("用户名长度需为 2-32 个字符".into()));
    }
    Ok(())
}

fn validate_password(password: &str) -> Result<(), AppError> {
    if password.len() < 6 {
        return Err(AppError::BadRequest("密码长度至少 6 位".into()));
    }
    if password.len() > 128 {
        return Err(AppError::BadRequest("密码过长".into()));
    }
    Ok(())
}

fn validate_email(email: &str) -> Result<(), AppError> {
    if email.len() > 100 || !email.contains('@') || email.trim() != email {
        return Err(AppError::BadRequest("邮箱格式不正确".into()));
    }
    Ok(())
}

// --- 登录/登出 ---

#[tauri::command]
pub async fn auth_login(
    state: State<'_, AppState>,
    payload: LoginPayload,
) -> CmdResult<UserInfo> {
    let user = repository::users::find_by_username(&state.db, &payload.username)
        .await?
        .ok_or(AppError::BadRequest("用户名或密码错误".into()))?;

    if !verify_password(&payload.password, &user.password_hash)? {
        return Err(AppError::BadRequest("用户名或密码错误".into()));
    }

    let session = UserSession {
        id: user.id,
        username: user.username.clone(),
        nickname: user.nickname.clone(),
        email: user.email.clone(),
        bio: user.bio.clone(),
        avatar_path: user.avatar_path.clone(),
        is_admin: user.is_admin,
        permission_level: user.permission_level,
        granted_resource_ids: Default::default(),
        granted_collection_ids: Default::default(),
    };

    let info = UserInfo::from(session.clone());
    state.auth.set_user(session).await;
    Ok(info)
}

#[tauri::command]
pub async fn auth_logout(state: State<'_, AppState>) -> CmdResult<()> {
    state.auth.clear().await;
    Ok(())
}

#[tauri::command]
pub async fn auth_me(state: State<'_, AppState>) -> CmdResult<Option<UserInfo>> {
    Ok(state.auth.current().await.map(UserInfo::from))
}

// --- 注册 ---

#[derive(Debug, Deserialize)]
pub struct RegisterPayload {
    pub username: String,
    pub nickname: String,
    pub email: String,
    pub password: String,
}

#[tauri::command]
pub async fn auth_register(
    state: State<'_, AppState>,
    payload: RegisterPayload,
) -> CmdResult<UserInfo> {
    let username = payload.username.trim().to_string();
    let nickname = payload.nickname.trim().to_string();
    let email = payload.email.trim().to_string();

    validate_username(&username)?;
    if nickname.is_empty() {
        return Err(AppError::BadRequest("昵称不能为空".into()));
    }
    if nickname.len() > 32 {
        return Err(AppError::BadRequest("昵称过长（最多 32 字符）".into()));
    }
    validate_email(&email)?;
    validate_password(&payload.password)?;

    if repository::users::username_exists(&state.db, &username).await? {
        return Err(AppError::BadRequest("用户名已被占用".into()));
    }
    if repository::users::email_exists(&state.db, &email).await? {
        return Err(AppError::BadRequest("邮箱已被注册".into()));
    }

    let hash = hash_password(&payload.password)?;
    let (uid, is_admin) =
        repository::users::create(&state.db, &username, &hash, &nickname, &email).await?;

    let session = UserSession {
        id: uid,
        username,
        nickname,
        email,
        bio: String::new(),
        avatar_path: String::new(),
        is_admin,
        permission_level: if is_admin { 5 } else { 0 },
        granted_resource_ids: Default::default(),
        granted_collection_ids: Default::default(),
    };
    let info = UserInfo::from(session.clone());
    state.auth.set_user(session).await;
    Ok(info)
}

// --- 个人资料 ---

#[derive(Debug, Deserialize)]
pub struct UpdateProfilePayload {
    pub nickname: String,
    pub email: String,
    pub bio: String,
}

#[tauri::command]
pub async fn auth_update_profile(
    state: State<'_, AppState>,
    payload: UpdateProfilePayload,
) -> CmdResult<UserInfo> {
    let user = require_login(&state.auth).await?;
    let nickname = payload.nickname.trim().to_string();
    let email = payload.email.trim().to_string();

    if nickname.is_empty() {
        return Err(AppError::BadRequest("昵称不能为空".into()));
    }
    if nickname.len() > 32 {
        return Err(AppError::BadRequest("昵称过长（最多 32 字符）".into()));
    }
    if !email.is_empty() {
        validate_email(&email)?;
        // 换绑邮箱时检查唯一性
        if repository::users::email_exists(&state.db, &email).await? {
            let existing = repository::users::find_by_username(&state.db, &user.username)
                .await?
                .ok_or(AppError::NotFound)?;
            if existing.email != email {
                return Err(AppError::BadRequest("邮箱已被其他账户使用".into()));
            }
        }
    }
    if payload.bio.chars().count() > 500 {
        return Err(AppError::BadRequest("简介过长（最多 500 字符）".into()));
    }

    repository::users::update_profile(&state.db, user.id, &nickname, &email, &payload.bio).await?;

    state
        .auth
        .update_user(|s| {
            s.nickname = nickname.clone();
            s.email = email.clone();
            s.bio = payload.bio.clone();
        })
        .await;

    let updated = state.auth.current().await.ok_or(AppError::Unauthorized)?;
    Ok(UserInfo::from(updated))
}

#[derive(Debug, Deserialize)]
pub struct ChangeUsernamePayload {
    pub new_username: String,
    pub password: String,
}

#[tauri::command]
pub async fn auth_change_username(
    state: State<'_, AppState>,
    payload: ChangeUsernamePayload,
) -> CmdResult<UserInfo> {
    let user = require_login(&state.auth).await?;
    let new_name = payload.new_username.trim().to_string();
    validate_username(&new_name)?;

    let db_user = repository::users::find_by_id(&state.db, user.id)
        .await?
        .ok_or(AppError::NotFound)?;
    if !verify_password(&payload.password, &db_user.password_hash)? {
        return Err(AppError::BadRequest("密码错误".into()));
    }
    if new_name == db_user.username {
        // 用户名未变化，直接返回
        return Ok(UserInfo::from(user));
    }
    if repository::users::username_exists(&state.db, &new_name).await? {
        return Err(AppError::BadRequest("用户名已被占用".into()));
    }

    repository::users::update_username(&state.db, user.id, &new_name).await?;
    state.auth.update_user(|s| s.username = new_name.clone()).await;

    let updated = state.auth.current().await.ok_or(AppError::Unauthorized)?;
    Ok(UserInfo::from(updated))
}

#[tauri::command]
pub async fn auth_upload_avatar(
    state: State<'_, AppState>,
    file_path: String,
) -> CmdResult<String> {
    let user = require_login(&state.auth).await?;
    let ext = avatar_ext_from_path(&file_path)?;
    let data = std::fs::read(&file_path).map_err(AppError::Io)?;
    save_avatar(&state, &user, data, ext).await
}

/// 前端裁剪后的头像：直接接收图片字节（PNG/JPEG/WebP/GIF）
#[tauri::command]
pub async fn auth_upload_avatar_bytes(
    state: State<'_, AppState>,
    data: Vec<u8>,
    ext: String,
) -> CmdResult<String> {
    let user = require_login(&state.auth).await?;
    let ext = valid_avatar_ext(ext.trim_start_matches('.').to_lowercase())?;
    if data.is_empty() || data.len() > 10 * 1024 * 1024 {
        return Err(AppError::BadRequest("图片为空或超过 10MB".into()));
    }
    save_avatar(&state, &user, data, ext).await
}

fn avatar_ext_from_path(file_path: &str) -> Result<String, AppError> {
    let ext = std::path::Path::new(file_path)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default();
    valid_avatar_ext(ext)
}

fn valid_avatar_ext(ext: String) -> Result<String, AppError> {
    if matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "webp" | "gif") {
        Ok(ext)
    } else {
        Err(AppError::BadRequest("仅支持 jpg/png/webp/gif 图片".into()))
    }
}

async fn save_avatar(
    state: &AppState,
    user: &UserSession,
    data: Vec<u8>,
    ext: String,
) -> CmdResult<String> {
    let storage = state.storage.get().await;
    let filename = format!("avatar_{}.{}", user.id, ext);
    let saved = storage
        .save(bytes::Bytes::from(data), &filename, "avatars")
        .await
        .map_err(AppError::Storage)?;

    // 删除旧头像文件
    if !user.avatar_path.is_empty() {
        let _ = storage.delete(&user.avatar_path).await;
    }
    repository::users::update_avatar(&state.db, user.id, &saved).await?;
    state.auth.update_user(|s| s.avatar_path = saved.clone()).await;

    Ok(saved)
}

// --- 修改密码 ---

#[derive(Debug, Deserialize)]
pub struct ChangePasswordPayload {
    pub old_password: String,
    pub new_password: String,
}

#[tauri::command]
pub async fn auth_change_password(
    state: State<'_, AppState>,
    payload: ChangePasswordPayload,
) -> CmdResult<()> {
    let user = require_login(&state.auth).await?;
    validate_password(&payload.new_password)?;

    let db_user = repository::users::find_by_id(&state.db, user.id)
        .await?
        .ok_or(AppError::NotFound)?;

    if !verify_password(&payload.old_password, &db_user.password_hash)? {
        return Err(AppError::BadRequest("旧密码错误".into()));
    }

    let new_hash = hash_password(&payload.new_password)?;
    repository::users::update_password(&state.db, user.id, &new_hash).await?;
    Ok(())
}
