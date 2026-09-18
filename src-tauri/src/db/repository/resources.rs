// 资源 Repository：CRUD + 列表查询
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::error::AppError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Resource {
    pub id: i64,
    pub title: String,
    pub description: String,
    pub content: String,
    /// 阅读权限：0=公开（无需登录），>0 需要读者权限值 >= read_level
    pub read_level: i64,
    pub access_password: String,
    pub thumbnail_path: String,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    /// 作者用户 ID（历史数据回填为最早用户；用户被删除后仍保留）
    #[serde(default)]
    pub user_id: Option<i64>,
    // 附加关系（列表/详情时附加）
    #[serde(default)]
    pub tags: Vec<TagRef>,
    #[serde(default)]
    pub collections: Vec<CollectionRef>,
    #[serde(default)]
    pub category: Option<CategoryRef>,
    #[serde(default)]
    pub items: Vec<ResourceItem>,
    #[serde(default)]
    pub images: Vec<ImageRef>,
    /// 作者信息（用户已删除时为 None）
    #[serde(default)]
    pub author: Option<AuthorRef>,
    /// 资源包含的附件类型聚合（列表页用于显示类型徽章）
    #[serde(default)]
    pub item_types: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthorRef {
    pub id: i64,
    pub username: String,
    pub nickname: String,
    pub avatar_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagRef {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionRef {
    pub id: i64,
    pub title: String,
    pub visibility: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategoryRef {
    pub id: i64,
    pub name: String,
    pub parent_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceItem {
    pub id: i64,
    pub resource_id: i64,
    #[serde(rename = "type")]
    pub item_type: String,
    pub content: String,
    pub description: String,
    pub file_path: String,
    pub file_name: String,
    pub sort_order: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageRef {
    pub id: i64,
    pub resource_id: i64,
    pub file_path: String,
    pub sort_order: i64,
    pub width: i64,
    pub height: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ListParams {
    #[serde(default = "default_page")]
    pub page: i64,
    #[serde(default = "default_page_size")]
    pub page_size: i64,
    #[serde(default)]
    pub search: Option<String>,
    #[serde(default)]
    pub tag_id: Option<i64>,
    #[serde(default)]
    pub collection_id: Option<i64>,
    #[serde(default)]
    pub category_id: Option<i64>,
    #[serde(default)]
    pub user_id: Option<i64>,
    #[serde(default)]
    pub sort: Option<String>,
    #[serde(default)]
    pub direction: Option<String>,
    #[serde(default)]
    pub include_deleted: bool,
}

fn default_page() -> i64 { 1 }
fn default_page_size() -> i64 { 24 }

#[derive(Debug, Serialize)]
pub struct PaginatedResources {
    pub items: Vec<Resource>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

pub async fn list(pool: &SqlitePool, params: &ListParams, viewer_level: i64) -> Result<PaginatedResources, AppError> {
    let offset = (params.page - 1).max(0) * params.page_size;
    let sort = params.sort.as_deref().unwrap_or("created_at");
    let direction = if params.direction.as_deref() == Some("asc") { "ASC" } else { "DESC" };
    let sort_col = match sort {
        "updated_at" => "updated_at",
        "title" => "title",
        _ => "created_at",
    };

    // 构建 WHERE 条件
    let mut conditions: Vec<String> = Vec::new();

    if !params.include_deleted {
        conditions.push("deleted_at IS NULL".to_string());
    }
    // 阅读权限过滤：读者等级 >= 资源 read_level（管理员等级 5 可见全部）
    conditions.push(format!("read_level <= {}", viewer_level.clamp(0, 5)));
    if let Some(search) = &params.search {
        let s = search.replace('\'', "''");
        conditions.push(format!("title LIKE '%{}%'", s));
    }
    if let Some(tag_id) = params.tag_id {
        conditions.push(format!(
            "id IN (SELECT resource_id FROM resource_tags WHERE tag_id = {})", tag_id
        ));
    }
    if let Some(cid) = params.collection_id {
        conditions.push(format!(
            "id IN (SELECT resource_id FROM resource_collections WHERE collection_id = {})", cid
        ));
    }
    if let Some(cat_id) = params.category_id {
        conditions.push(format!(
            "id IN (SELECT resource_id FROM resource_categories WHERE category_id = {})", cat_id
        ));
    }
    if let Some(uid) = params.user_id {
        conditions.push(format!("user_id = {}", uid));
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    // 查询总数
    let count_sql = format!("SELECT COUNT(*) as count FROM resources {}", where_clause);
    let total: i64 = sqlx::query_scalar(&count_sql)
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    // 查询列表
    let sql = format!(
        "SELECT id, title, description, content, read_level, access_password, \
         thumbnail_path, created_at, updated_at, deleted_at, user_id \
         FROM resources {} ORDER BY {} {} LIMIT ? OFFSET ?",
        where_clause, sort_col, direction
    );

    let rows = sqlx::query_as::<_, (i64, String, String, String, i64, String, String, String, String, Option<String>, Option<i64>)>(&sql)
        .bind(params.page_size)
        .bind(offset)
        .fetch_all(pool)
        .await?;

    let mut items = Vec::new();
    for row in rows {
        let (id, title, description, content, read_level, access_password, thumbnail_path, created_at, updated_at, deleted_at, user_id) = row;
        // 附加 tags
        let tags = get_tags_for_resource(pool, id).await?;
        let collections = get_collections_for_resource(pool, id).await?;
        let category = get_category_for_resource(pool, id).await?;
        let images = get_images_for_resource(pool, id).await?;
        let author = get_author_for_resource(pool, user_id).await?;
        // 聚合附件类型（magnet/torrent → magnet_torrent，去重）
        let item_types = get_item_types_for_resource(pool, id).await?;
        items.push(Resource {
            id, title, description, content, read_level, access_password, thumbnail_path, created_at, updated_at, deleted_at, user_id,
            tags, collections, category, items: vec![], images, author, item_types,
        });
    }

    Ok(PaginatedResources { items, total, page: params.page, page_size: params.page_size })
}

pub async fn get(pool: &SqlitePool, rid: i64) -> Result<Resource, AppError> {
    let row = sqlx::query_as::<
        _,
        (i64, String, String, String, i64, String, String, String, String, Option<String>, Option<i64>),
    >(
        "SELECT id, title, description, content, read_level, access_password, \
         thumbnail_path, created_at, updated_at, deleted_at, user_id \
         FROM resources WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(rid)
    .fetch_optional(pool)
    .await?;

    let row = row.ok_or(AppError::NotFound)?;
    let (id, title, description, content, read_level, access_password, thumbnail_path, created_at, updated_at, deleted_at, user_id) = row;

    let tags = get_tags_for_resource(pool, id).await?;
    let collections = get_collections_for_resource(pool, id).await?;
    let category = get_category_for_resource(pool, id).await?;
    let items = get_items_for_resource(pool, id).await?;
    let images = get_images_for_resource(pool, id).await?;
    let author = get_author_for_resource(pool, user_id).await?;
    let item_types = get_item_types_for_resource(pool, id).await?;

    Ok(Resource {
        id, title, description, content, read_level, access_password, thumbnail_path, created_at, updated_at, deleted_at, user_id,
        tags, collections, category, items, images, author, item_types,
    })
}

pub async fn create(pool: &SqlitePool, payload: &CreateResource, user_id: i64) -> Result<i64, AppError> {
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let result = sqlx::query(
        "INSERT INTO resources (title, description, content, read_level, access_password, thumbnail_path, user_id, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&payload.title)
    .bind(&payload.description)
    .bind(&payload.content)
    .bind(payload.read_level)
    .bind(&payload.access_password)
    .bind(&payload.thumbnail_path)
    .bind(user_id)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await?;
    Ok(result.last_insert_rowid())
}

pub async fn update(pool: &SqlitePool, rid: i64, payload: &CreateResource) -> Result<(), AppError> {
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query(
        "UPDATE resources SET title=?, description=?, content=?, read_level=?, access_password=?, thumbnail_path=?, updated_at=? \
         WHERE id=? AND deleted_at IS NULL",
    )
    .bind(&payload.title)
    .bind(&payload.description)
    .bind(&payload.content)
    .bind(payload.read_level)
    .bind(&payload.access_password)
    .bind(&payload.thumbnail_path)
    .bind(&now)
    .bind(rid)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn soft_delete(pool: &SqlitePool, rid: i64) -> Result<(), AppError> {
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query("UPDATE resources SET deleted_at=? WHERE id=? AND deleted_at IS NULL")
        .bind(&now)
        .bind(rid)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn restore(pool: &SqlitePool, rid: i64) -> Result<(), AppError> {
    sqlx::query("UPDATE resources SET deleted_at=NULL WHERE id=?")
        .bind(rid)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn permanent_delete(pool: &SqlitePool, rid: i64) -> Result<(), AppError> {
    sqlx::query("DELETE FROM resources WHERE id=?")
        .bind(rid)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn list_deleted(pool: &SqlitePool) -> Result<Vec<Resource>, AppError> {
    let rows = sqlx::query_as::<
        _,
        (i64, String, String, String, i64, String, String, String, String, Option<String>, Option<i64>),
    >(
        "SELECT id, title, description, content, read_level, access_password, \
         thumbnail_path, created_at, updated_at, deleted_at, user_id \
         FROM resources WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC",
    )
    .fetch_all(pool)
    .await?;

    let mut items = Vec::new();
    for row in rows {
        let (id, title, description, content, read_level, access_password, thumbnail_path, created_at, updated_at, deleted_at, user_id) = row;
        items.push(Resource {
            id, title, description, content, read_level, access_password, thumbnail_path, created_at, updated_at, deleted_at, user_id,
            tags: vec![], collections: vec![], category: None, items: vec![], images: vec![], author: None, item_types: vec![],
        });
    }
    Ok(items)
}

/// 分页查询回收站
pub async fn list_deleted_paged(
    pool: &SqlitePool,
    limit: i64,
    offset: i64,
) -> Result<crate::db::repository::Paged<Resource>, AppError> {
    let total: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM resources WHERE deleted_at IS NOT NULL",
    )
    .fetch_one(pool)
    .await?;

    let rows = sqlx::query_as::<
        _,
        (i64, String, String, String, i64, String, String, String, String, Option<String>, Option<i64>),
    >(
        "SELECT id, title, description, content, read_level, access_password, \
         thumbnail_path, created_at, updated_at, deleted_at, user_id \
         FROM resources WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC \
         LIMIT ?1 OFFSET ?2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;

    let mut items = Vec::new();
    for row in rows {
        let (id, title, description, content, read_level, access_password, thumbnail_path, created_at, updated_at, deleted_at, user_id) = row;
        items.push(Resource {
            id, title, description, content, read_level, access_password, thumbnail_path, created_at, updated_at, deleted_at, user_id,
            tags: vec![], collections: vec![], category: None, items: vec![], images: vec![], author: None, item_types: vec![],
        });
    }
    Ok(crate::db::repository::Paged { items, total })
}

// --- 附件项 ---
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateItem {
    #[serde(rename = "type")]
    pub item_type: String,
    pub content: String,
    pub description: String,
    pub file_path: String,
    pub file_name: String,
}

pub async fn sync_items(pool: &SqlitePool, rid: i64, items: &[CreateItem]) -> Result<(), AppError> {
    // 先删除旧的（覆盖式）
    sqlx::query("DELETE FROM resource_items WHERE resource_id=?")
        .bind(rid)
        .execute(pool)
        .await?;

    for (i, item) in items.iter().enumerate() {
        sqlx::query(
            "INSERT INTO resource_items (resource_id, type, content, description, file_path, file_name, sort_order) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(rid)
        .bind(&item.item_type)
        .bind(&item.content)
        .bind(&item.description)
        .bind(&item.file_path)
        .bind(&item.file_name)
        .bind(i as i64)
        .execute(pool)
        .await?;
    }
    Ok(())
}

pub async fn get_items_for_resource(pool: &SqlitePool, rid: i64) -> Result<Vec<ResourceItem>, AppError> {
    let rows = sqlx::query_as::<
        _,
        (i64, i64, String, String, String, String, String, i64, String),
    >(
        "SELECT id, resource_id, type, content, description, file_path, file_name, sort_order, created_at \
         FROM resource_items WHERE resource_id=? ORDER BY sort_order, id",
    )
    .bind(rid)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(id, resource_id, item_type, content, description, file_path, file_name, sort_order, created_at)| ResourceItem {
            id, resource_id, item_type, content, description, file_path, file_name, sort_order, created_at,
        })
        .collect())
}

// --- 标签关联 ---
pub async fn sync_tags(pool: &SqlitePool, rid: i64, tag_ids: &[i64]) -> Result<(), AppError> {
    sqlx::query("DELETE FROM resource_tags WHERE resource_id=?")
        .bind(rid)
        .execute(pool)
        .await?;
    for &tid in tag_ids {
        sqlx::query("INSERT INTO resource_tags (resource_id, tag_id) VALUES (?, ?)")
            .bind(rid)
            .bind(tid)
            .execute(pool)
            .await?;
    }
    Ok(())
}

// --- 分类关联（一个资源只能属于一个分类） ---
pub async fn sync_category(pool: &SqlitePool, rid: i64, category_id: Option<i64>) -> Result<(), AppError> {
    // 先删除旧关联
    sqlx::query("DELETE FROM resource_categories WHERE resource_id=?")
        .bind(rid)
        .execute(pool)
        .await?;
    // 如果有新分类，插入
    if let Some(cid) = category_id {
        sqlx::query("INSERT INTO resource_categories (resource_id, category_id) VALUES (?, ?)")
            .bind(rid)
            .bind(cid)
            .execute(pool)
            .await?;
    }
    Ok(())
}

async fn get_tags_for_resource(pool: &SqlitePool, rid: i64) -> Result<Vec<TagRef>, AppError> {
    let rows = sqlx::query_as::<_, (i64, String)>(
        "SELECT t.id, t.name FROM resource_tags rt JOIN tags t ON t.id = rt.tag_id \
         WHERE rt.resource_id = ? ORDER BY t.name",
    )
    .bind(rid)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, name)| TagRef { id, name })
        .collect())
}

// --- 单个 item 查询（磁力下载用） ---
pub async fn get_item(pool: &SqlitePool, rid: i64, item_id: i64) -> Result<ResourceItem, AppError> {
    let row = sqlx::query_as::<
        _,
        (i64, i64, String, String, String, String, String, i64, String),
    >(
        "SELECT id, resource_id, type, content, description, file_path, file_name, sort_order, created_at \
         FROM resource_items WHERE id=? AND resource_id=?",
    )
    .bind(item_id)
    .bind(rid)
    .fetch_one(pool)
    .await?;

    let (id, resource_id, item_type, content, description, file_path, file_name, sort_order, created_at) = row;
    Ok(ResourceItem {
        id, resource_id, item_type, content, description, file_path, file_name, sort_order, created_at,
    })
}

/// 更新 item 的 torrent 文件路径和文件名（磁力下载完成后调用）
pub async fn update_item_torrent(
    pool: &SqlitePool,
    item_id: i64,
    file_path: &str,
    file_name: &str,
) -> Result<(), AppError> {
    sqlx::query("UPDATE resource_items SET file_path=?, file_name=? WHERE id=?")
        .bind(file_path)
        .bind(file_name)
        .bind(item_id)
        .execute(pool)
        .await?;
    Ok(())
}

async fn get_collections_for_resource(pool: &SqlitePool, rid: i64) -> Result<Vec<CollectionRef>, AppError> {
    let rows = sqlx::query_as::<_, (i64, String, String)>(
        "SELECT c.id, c.title, c.visibility FROM resource_collections rc \
         JOIN collections c ON c.id = rc.collection_id \
         WHERE rc.resource_id = ? ORDER BY rc.sort_order",
    )
    .bind(rid)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, title, visibility)| CollectionRef { id, title, visibility })
        .collect())
}

async fn get_category_for_resource(pool: &SqlitePool, rid: i64) -> Result<Option<CategoryRef>, AppError> {
    let row = sqlx::query_as::<_, (i64, String, Option<i64>)>(
        "SELECT c.id, c.name, c.parent_id FROM resource_categories rc \
         JOIN categories c ON c.id = rc.category_id \
         WHERE rc.resource_id = ?",
    )
    .bind(rid)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(id, name, parent_id)| CategoryRef { id, name, parent_id }))
}

/// 按 user_id 取作者摘要（用户已删除时返回 None）
async fn get_author_for_resource(pool: &SqlitePool, user_id: Option<i64>) -> Result<Option<AuthorRef>, AppError> {
    let Some(uid) = user_id else { return Ok(None); };
    let row = sqlx::query_as::<_, (i64, String, String, String)>(
        "SELECT id, username, nickname, avatar_path FROM users WHERE id = ?",
    )
    .bind(uid)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(id, username, nickname, avatar_path)| AuthorRef {
        id, username, nickname, avatar_path,
    }))
}

async fn get_images_for_resource(pool: &SqlitePool, rid: i64) -> Result<Vec<ImageRef>, AppError> {
    let rows = sqlx::query_as::<_, (i64, i64, String, i64, i64, i64, String)>(
        "SELECT id, resource_id, file_path, sort_order, width, height, created_at \
         FROM images WHERE resource_id=? ORDER BY sort_order, id",
    )
    .bind(rid)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, resource_id, file_path, sort_order, width, height, created_at)| ImageRef {
            id, resource_id, file_path, sort_order, width, height, created_at,
        })
        .collect())
}

/// 获取资源的附件类型聚合列表（magnet/torrent → magnet_torrent，去重）
async fn get_item_types_for_resource(pool: &SqlitePool, rid: i64) -> Result<Vec<String>, AppError> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "SELECT DISTINCT CASE \
         WHEN type IN ('magnet','torrent') THEN 'magnet_torrent' \
         ELSE type END AS item_type \
         FROM resource_items WHERE resource_id=? ORDER BY item_type",
    )
    .bind(rid)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(t,)| t).collect())
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateResource {
    pub title: String,
    pub description: String,
    pub content: String,
    #[serde(default)]
    pub read_level: i64,
    pub access_password: String,
    pub thumbnail_path: String,
    #[serde(default)]
    pub tag_ids: Vec<i64>,
    #[serde(default)]
    pub collection_ids: Vec<i64>,
    #[serde(default)]
    pub category_id: Option<i64>,
    #[serde(default)]
    pub items: Vec<CreateItem>,
    /// 管理员马甲功能：指定以其他用户身份创建/更新文章
    #[serde(default)]
    pub author_id: Option<i64>,
}

/// 批量更新资源：所有字段可选，只更新提供的字段
#[derive(Debug, Clone, Deserialize)]
pub struct BatchUpdate {
    pub ids: Vec<i64>,
    pub read_level: Option<i64>,
    pub access_password: Option<String>,
    pub category_id: Option<Option<i64>>, // Some(None) = 清除分类
    pub add_collection_id: Option<i64>,   // 将这些资源加入某合集
    pub user_id: Option<Option<i64>>,     // Some(Some) = 改作者；Some(None) = 清除作者
}

/// 批量更新资源字段（单条 SQL 更新所有行）
pub async fn batch_update(pool: &SqlitePool, payload: &BatchUpdate) -> Result<(), AppError> {
    if payload.ids.is_empty() {
        return Ok(());
    }
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    // 构建 IN (?, ?, ...) 占位符
    let placeholders: Vec<&str> = payload.ids.iter().map(|_| "?").collect();
    let in_clause = placeholders.join(",");

    // 逐字段更新（每条 SQL 一次更新所有行）
    if let Some(read_level) = payload.read_level {
        let sql = format!(
            "UPDATE resources SET read_level=?, updated_at=? WHERE id IN ({}) AND deleted_at IS NULL",
            in_clause
        );
        let mut q = sqlx::query(&sql).bind(read_level.clamp(0, 5)).bind(&now);
        for &id in &payload.ids {
            q = q.bind(id);
        }
        q.execute(pool).await?;
    }

    if let Some(ref password) = payload.access_password {
        let sql = format!(
            "UPDATE resources SET access_password=?, updated_at=? WHERE id IN ({}) AND deleted_at IS NULL",
            in_clause
        );
        let mut q = sqlx::query(&sql).bind(password).bind(&now);
        for &id in &payload.ids {
            q = q.bind(id);
        }
        q.execute(pool).await?;
    }

    // 分类：逐个 sync（需要先删再插）
    if let Some(ref cat) = payload.category_id {
        for &id in &payload.ids {
            sync_category(pool, id, *cat).await?;
        }
    }

    // 加入合集：批量 INSERT OR IGNORE
    if let Some(cid) = payload.add_collection_id {
        for &id in &payload.ids {
            sqlx::query("INSERT OR IGNORE INTO resource_collections (resource_id, collection_id, sort_order) VALUES (?, ?, 0)")
                .bind(id)
                .bind(cid)
                .execute(pool)
                .await?;
        }
    }

    // 改作者：目标用户需存在（NULL 表示清除作者）
    if let Some(ref uid) = payload.user_id {
        if let Some(new_uid) = uid {
            let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE id = ?")
                .bind(new_uid)
                .fetch_one(pool)
                .await?;
            if exists == 0 {
                return Err(AppError::BadRequest("目标作者不存在".into()));
            }
        }
        let sql = format!(
            "UPDATE resources SET user_id=?, updated_at=? WHERE id IN ({}) AND deleted_at IS NULL",
            in_clause
        );
        let mut q = sqlx::query(&sql).bind(uid).bind(&now);
        for &id in &payload.ids {
            q = q.bind(id);
        }
        q.execute(pool).await?;
    }

    Ok(())
}
