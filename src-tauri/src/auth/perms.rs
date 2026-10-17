// 功能权限与阅读权限
//
// 功能权限（管理操作）：settings 中的 perm_* 阈值（0-5，默认 5），
//   管理员恒通过；其他用户需 permission_level >= 阈值；阈值 0 = 任何登录用户。
// 阅读权限（资源）：resources.read_level，0 = 公开（无需登录）；>0 需读者等级 >= read_level。
// 阅读权限（合集）：collections.visibility（public / private），私有仅本人、管理员可见。
// 两者都可叠加访问密码：一旦设置，除作者本人与管理员外，所有人都必须凭密码解锁。
use sqlx::SqlitePool;

use crate::db::repository;
use crate::error::{AppError, CmdResult};
use crate::auth::state::{AuthState, UserSession};

/// 功能权限设置键
/// 文章/合集拆分为两个维度：
///   - *_own：新建、编辑、删除「自己的」内容
///   - 无后缀（manage）：管理「他人的」内容（编辑/删除/批量操作）
pub const FEATURE_ARTICLE_OWN: &str = "perm_article_own";
pub const FEATURE_ARTICLE: &str = "perm_article";
pub const FEATURE_COLLECTION_OWN: &str = "perm_collection_own";
pub const FEATURE_COLLECTION: &str = "perm_collection";
pub const FEATURE_TAG: &str = "perm_tag";
pub const FEATURE_TRASH: &str = "perm_trash";
pub const FEATURE_USER: &str = "perm_user";
/// 使用翻译功能（阈值 0 = 所有登录用户；默认 0，因为 key 由管理员统一提供）
pub const FEATURE_TRANSLATE: &str = "perm_translate";

/// 合集可见性：公开（任何人可访问）
pub const VISIBILITY_PUBLIC: &str = "public";

/// 当前访问者的阅读等级：未登录 = 0
pub async fn viewer_level(auth: &AuthState) -> i64 {
    auth.current().await.map(|u| u.effective_level()).unwrap_or(0)
}

/// 读取某功能的权限阈值（默认 5，即仅管理员）
async fn feature_threshold(pool: &SqlitePool, key: &str) -> Result<i64, AppError> {
    let raw = repository::settings::get(pool, key).await?;
    Ok(match raw.as_deref() {
        Some(v) => v.parse::<i64>().unwrap_or(5).clamp(0, 5),
        None => 5,
    })
}

/// 要求当前用户满足某功能权限，返回其会话
pub async fn require_feature(
    pool: &SqlitePool,
    auth: &AuthState,
    key: &str,
) -> Result<UserSession, AppError> {
    let user = crate::auth::require_login(auth).await?;
    if user.is_admin {
        return Ok(user);
    }
    let threshold = feature_threshold(pool, key).await?;
    if user.effective_level() >= threshold {
        Ok(user)
    } else {
        Err(AppError::Forbidden)
    }
}

/// 门禁第一段：作者本人与管理员恒放行（否则作者会被自己设的密码挡在门外）
fn is_owner_or_admin(session: Option<&UserSession>, owner_id: Option<i64>) -> bool {
    session.is_some_and(|s| s.is_admin || owner_id == Some(s.id))
}

/// 门禁第二段：设了访问密码就必须已凭密码解锁。
/// Some = 已由密码判定出结果；None = 未设密码，交给内容自身的规则继续判定
fn password_gate(locked: bool, granted: bool) -> Option<CmdResult<()>> {
    if !locked {
        return None;
    }
    Some(if granted {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    })
}

/// 确保当前访问者可以阅读指定资源，否则 Forbidden
///
/// 判定顺序：作者/管理员 → 访问密码 → 阅读等级（未登录 = 0）
pub async fn ensure_readable(
    auth: &AuthState,
    resource: &repository::resources::Resource,
) -> CmdResult<()> {
    let session = auth.current().await;
    if is_owner_or_admin(session.as_ref(), resource.user_id) {
        return Ok(());
    }
    if let Some(result) = password_gate(
        !resource.access_password.is_empty(),
        auth.is_granted_resource(resource.id).await,
    ) {
        return result;
    }
    // 未设密码：阅读等级足够即可（未登录 = 0）
    let level = session.as_ref().map(|s| s.effective_level()).unwrap_or(0);
    if level >= resource.read_level {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

/// 确保当前访问者可以阅读指定合集，否则 Forbidden
///
/// 判定顺序与资源一致，只是把末位的「阅读等级」换成「公开 / 私有」
pub async fn ensure_collection_readable(
    auth: &AuthState,
    collection: &repository::collections::Collection,
) -> CmdResult<()> {
    let session = auth.current().await;
    if is_owner_or_admin(session.as_ref(), collection.user_id) {
        return Ok(());
    }
    if let Some(result) = password_gate(
        !collection.access_password.is_empty(),
        auth.is_granted_collection(collection.id).await,
    ) {
        return result;
    }
    // 未设密码：只有公开合集可读
    if collection.visibility == VISIBILITY_PUBLIC {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}
