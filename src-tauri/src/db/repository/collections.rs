// 合集 Repository
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use crate::error::AppError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Collection {
    pub id: i64,
    pub title: String,
    pub description: String,
    pub visibility: String,
    pub access_password: String,
    pub thumbnail_path: String,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    #[serde(default)]
    pub resource_count: i64,
    #[serde(default)]
    pub user_id: Option<i64>,
    /// 列表展示用封面：自有封面为空时回退到首个收录文章的封面（不复制文件）
    #[serde(default)]
    pub cover_path: String,
}

/// 首个收录文章的封面子查询（按 sort_order 排序，未删除优先）
const FIRST_COVER_SUB: &str = "COALESCE( \
 (SELECT r.thumbnail_path FROM resource_collections rc \
  JOIN resources r ON r.id = rc.resource_id AND r.deleted_at IS NULL \
  WHERE rc.collection_id = c.id AND r.thumbnail_path != '' \
  ORDER BY rc.sort_order ASC, r.created_at ASC LIMIT 1), '')";

pub async fn list(pool: &SqlitePool) -> Result<Vec<Collection>, AppError> {
    let rows = sqlx::query_as::<
        _,
        (i64, String, String, String, String, String, String, String, String, Option<String>, i64, Option<i64>, String),
    >(
        &format!(
            "SELECT c.id, c.title, c.description, c.visibility, c.access_password, c.thumbnail_path, \
             c.content, c.created_at, c.updated_at, c.deleted_at, \
             (SELECT COUNT(*) FROM resource_collections rc WHERE rc.collection_id = c.id) as resource_count, \
             c.user_id, \
             COALESCE(NULLIF(c.thumbnail_path, ''), {FIRST_COVER_SUB}) as cover_path \
             FROM collections c WHERE c.deleted_at IS NULL ORDER BY c.created_at DESC",
        ),
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(
            |(id, title, description, visibility, access_password, thumbnail_path, content, created_at, updated_at, deleted_at, resource_count, user_id, cover_path)| {
                Collection {
                    id, title, description, visibility, access_password, thumbnail_path,
                    content, created_at, updated_at, deleted_at, resource_count, user_id, cover_path,
                }
            },
        )
        .collect())
}

/// 分页查询合集（可选按标题模糊搜索）
pub async fn list_paged(
    pool: &SqlitePool,
    limit: i64,
    offset: i64,
    search: Option<&str>,
) -> Result<crate::db::repository::Paged<Collection>, AppError> {
    let like = search
        .filter(|s| !s.trim().is_empty())
        .map(|s| format!("%{}%", s.trim()));

    let total: i64 = if like.is_some() {
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM collections WHERE deleted_at IS NULL AND title LIKE ?1",
        )
        .bind(like.as_deref().unwrap_or("%"))
        .fetch_one(pool)
        .await?
    } else {
        sqlx::query_scalar("SELECT COUNT(*) FROM collections WHERE deleted_at IS NULL")
            .fetch_one(pool)
            .await?
    };

    let base = &format!(
        "SELECT c.id, c.title, c.description, c.visibility, c.access_password, c.thumbnail_path, \
         c.content, c.created_at, c.updated_at, c.deleted_at, \
         (SELECT COUNT(*) FROM resource_collections rc WHERE rc.collection_id = c.id) as resource_count, \
         c.user_id, \
         COALESCE(NULLIF(c.thumbnail_path, ''), {FIRST_COVER_SUB}) as cover_path \
         FROM collections c WHERE c.deleted_at IS NULL",
    );
    let sql = if like.is_some() {
        format!("{base} AND c.title LIKE ?1 ORDER BY c.created_at DESC LIMIT ?2 OFFSET ?3")
    } else {
        format!("{base} ORDER BY c.created_at DESC LIMIT ?1 OFFSET ?2")
    };

    let mut query = sqlx::query_as::<
        _,
        (i64, String, String, String, String, String, String, String, String, Option<String>, i64, Option<i64>, String),
    >(&sql);
    if let Some(l) = &like {
        query = query.bind(l);
    }
    query = query.bind(limit).bind(offset);
    let rows = query.fetch_all(pool).await?;

    Ok(crate::db::repository::Paged {
        items: rows
            .into_iter()
            .map(
                |(id, title, description, visibility, access_password, thumbnail_path, content, created_at, updated_at, deleted_at, resource_count, user_id, cover_path)| {
                    Collection {
                        id, title, description, visibility, access_password, thumbnail_path,
                        content, created_at, updated_at, deleted_at, resource_count, user_id, cover_path,
                    }
                },
            )
            .collect(),
        total,
    })
}

pub async fn get(pool: &SqlitePool, cid: i64) -> Result<Collection, AppError> {
    let row = sqlx::query_as::<
        _,
        (i64, String, String, String, String, String, String, String, String, Option<String>, i64, Option<i64>, String),
    >(
        &format!(
            "SELECT c.id, c.title, c.description, c.visibility, c.access_password, c.thumbnail_path, \
             c.content, c.created_at, c.updated_at, c.deleted_at, \
             (SELECT COUNT(*) FROM resource_collections rc WHERE rc.collection_id = c.id) as resource_count, \
             c.user_id, \
             COALESCE(NULLIF(c.thumbnail_path, ''), {FIRST_COVER_SUB}) as cover_path \
             FROM collections c WHERE c.id = ? AND c.deleted_at IS NULL",
        ),
    )
    .bind(cid)
    .fetch_optional(pool)
    .await?;

    let row = row.ok_or(AppError::NotFound)?;
    let (id, title, description, visibility, access_password, thumbnail_path, content, created_at, updated_at, deleted_at, resource_count, user_id, cover_path) = row;

    Ok(Collection {
        id, title, description, visibility, access_password, thumbnail_path,
        content, created_at, updated_at, deleted_at, resource_count, user_id, cover_path,
    })
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateCollection {
    pub title: String,
    pub description: String,
    pub visibility: Option<String>,
    pub access_password: String,
    pub thumbnail_path: String,
    #[serde(default)]
    pub content: String,
    /// 管理员马甲功能：指定以其他用户身份创建合集
    #[serde(default)]
    pub author_id: Option<i64>,
}

pub async fn create(pool: &SqlitePool, payload: &CreateCollection, user_id: i64) -> Result<i64, AppError> {
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let result = sqlx::query(
        "INSERT INTO collections (title, description, visibility, access_password, thumbnail_path, content, user_id, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&payload.title)
    .bind(&payload.description)
    .bind(payload.visibility.as_deref().unwrap_or("private"))
    .bind(&payload.access_password)
    .bind(&payload.thumbnail_path)
    .bind(&payload.content)
    .bind(user_id)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await?;
    Ok(result.last_insert_rowid())
}

pub async fn update(pool: &SqlitePool, cid: i64, payload: &CreateCollection) -> Result<(), AppError> {
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query(
        "UPDATE collections SET title=?, description=?, visibility=?, access_password=?, thumbnail_path=?, content=?, updated_at=? \
         WHERE id=? AND deleted_at IS NULL",
    )
    .bind(&payload.title)
    .bind(&payload.description)
    .bind(payload.visibility.as_deref().unwrap_or("private"))
    .bind(&payload.access_password)
    .bind(&payload.thumbnail_path)
    .bind(&payload.content)
    .bind(&now)
    .bind(cid)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn soft_delete(pool: &SqlitePool, cid: i64) -> Result<(), AppError> {
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query("UPDATE collections SET deleted_at=? WHERE id=? AND deleted_at IS NULL")
        .bind(&now)
        .bind(cid)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn restore(pool: &SqlitePool, cid: i64) -> Result<(), AppError> {
    sqlx::query("UPDATE collections SET deleted_at=NULL WHERE id=?")
        .bind(cid)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn permanent_delete(pool: &SqlitePool, cid: i64) -> Result<(), AppError> {
    sqlx::query("DELETE FROM collections WHERE id=?")
        .bind(cid)
        .execute(pool)
        .await?;
    Ok(())
}

// --- 资源-合集关联 ---

pub async fn sync_resources(pool: &SqlitePool, cid: i64, resource_ids: &[i64]) -> Result<(), AppError> {
    sqlx::query("DELETE FROM resource_collections WHERE collection_id=?")
        .bind(cid)
        .execute(pool)
        .await?;
    for (i, &rid) in resource_ids.iter().enumerate() {
        sqlx::query("INSERT OR IGNORE INTO resource_collections (resource_id, collection_id, sort_order) VALUES (?, ?, ?)")
            .bind(rid)
            .bind(cid)
            .bind(i as i64)
            .execute(pool)
            .await?;
    }
    Ok(())
}

pub async fn list_resource_ids(pool: &SqlitePool, cid: i64) -> Result<Vec<i64>, AppError> {
    let rows: Vec<(i64,)> = sqlx::query_as(
        "SELECT resource_id FROM resource_collections WHERE collection_id=? ORDER BY sort_order",
    )
    .bind(cid)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(id,)| id).collect())
}

/// 为资源同步合集关联（以资源的视角：该资源属于哪些合集）
pub async fn sync_resource_collections(
    pool: &SqlitePool,
    rid: i64,
    collection_ids: &[i64],
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM resource_collections WHERE resource_id=?")
        .bind(rid)
        .execute(pool)
        .await?;
    for (i, &cid) in collection_ids.iter().enumerate() {
        sqlx::query("INSERT OR IGNORE INTO resource_collections (resource_id, collection_id, sort_order) VALUES (?, ?, ?)")
            .bind(rid)
            .bind(cid)
            .bind(i as i64)
            .execute(pool)
            .await?;
    }
    Ok(())
}
