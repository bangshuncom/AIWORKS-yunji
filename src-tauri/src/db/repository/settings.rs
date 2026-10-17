// 设置 Repository
use sqlx::SqlitePool;
use std::collections::HashMap;
use crate::error::AppError;

pub async fn get_all(pool: &SqlitePool) -> Result<HashMap<String, String>, AppError> {
    let rows = sqlx::query_as::<_, (String, String)>("SELECT key, value FROM settings")
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().collect())
}

pub async fn get(pool: &SqlitePool, key: &str) -> Result<Option<String>, AppError> {
    let row = sqlx::query_as::<_, (String,)>("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|(v,)| v))
}

pub async fn set(pool: &SqlitePool, key: &str, value: &str) -> Result<(), AppError> {
    sqlx::query("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?")
        .bind(key)
        .bind(value)
        .bind(value)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn set_many(pool: &SqlitePool, items: &HashMap<String, String>) -> Result<(), AppError> {
    for (key, value) in items {
        set(pool, key, value).await?;
    }
    Ok(())
}

/// 删除一个设置项（键不存在时也返回 Ok）
pub async fn delete(pool: &SqlitePool, key: &str) -> Result<(), AppError> {
    sqlx::query("DELETE FROM settings WHERE key = ?")
        .bind(key)
        .execute(pool)
        .await?;
    Ok(())
}
