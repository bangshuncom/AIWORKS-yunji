// resource_files 表：BT 种子的文件列表缓存（按 item_id 独立存储）
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::error::AppError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TorrentFile {
    pub id: i64,
    pub resource_id: i64,
    pub item_id: i64,
    pub name: String,
    pub size: i64,
    pub sort_order: i64,
}

/// 查询资源的文件列表（按 item_id 过滤，item_id=0 时返回全部）
pub async fn list(
    pool: &SqlitePool,
    rid: i64,
    item_id: i64,
) -> Result<Vec<TorrentFile>, AppError> {
    let rows: Vec<(i64, i64, i64, String, i64, i64)> = if item_id > 0 {
        sqlx::query_as(
            "SELECT id, resource_id, item_id, name, size, sort_order \
             FROM resource_files WHERE resource_id=? AND item_id=? \
             ORDER BY sort_order, id",
        )
        .bind(rid)
        .bind(item_id)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as(
            "SELECT id, resource_id, item_id, name, size, sort_order \
             FROM resource_files WHERE resource_id=? \
             ORDER BY item_id, sort_order, id",
        )
        .bind(rid)
        .fetch_all(pool)
        .await?
    };

    Ok(rows
        .into_iter()
        .map(|(id, resource_id, item_id, name, size, sort_order)| TorrentFile {
            id,
            resource_id,
            item_id,
            name,
            size,
            sort_order,
        })
        .collect())
}

/// 保存文件列表（覆盖式：先删后插）
pub async fn save(
    pool: &SqlitePool,
    rid: i64,
    item_id: i64,
    files: &[(String, i64)],
) -> Result<(), AppError> {
    // 先删除旧的
    sqlx::query("DELETE FROM resource_files WHERE resource_id=? AND item_id=?")
        .bind(rid)
        .bind(item_id)
        .execute(pool)
        .await?;

    // 插入新的
    for (i, (name, size)) in files.iter().enumerate() {
        sqlx::query(
            "INSERT INTO resource_files (resource_id, item_id, name, size, sort_order) \
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(rid)
        .bind(item_id)
        .bind(name)
        .bind(*size)
        .bind(i as i64)
        .execute(pool)
        .await?;
    }

    Ok(())
}

