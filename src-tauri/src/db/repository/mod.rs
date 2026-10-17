pub mod categories;
pub mod collections;
pub mod images;
pub mod resources;
pub mod settings;
pub mod tags;
pub mod torrent_files;
pub mod users;

use serde::Serialize;

/// 分页查询统一返回结构
#[derive(Debug, Serialize)]
pub struct Paged<T> {
    pub items: Vec<T>,
    pub total: i64,
}

/// 归一化分页参数：page 从 1 开始，page_size 限制在 1..=100
pub fn clamp_page(page: i64, page_size: i64) -> (i64, i64) {
    let page = page.max(1);
    let page_size = page_size.clamp(1, 100);
    (page, page_size)
}

/// 仓储层测试用的内存库工具：建表 + 造数据。
#[cfg(test)]
pub(crate) mod testkit {
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
    use std::str::FromStr;

    /// 每次调用都是一个全新的空库（跑过真实迁移脚本）。
    /// 必须限制单连接：SQLite 的内存库是按连接隔离的，多连接会各自拿到一个空库。
    pub async fn memory_pool() -> SqlitePool {
        let options = SqliteConnectOptions::from_str("sqlite::memory:")
            .expect("内存库连接串")
            .foreign_keys(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .expect("创建内存库");
        crate::db::pool::run_migrations(&pool)
            .await
            .expect("建表");
        pool
    }

    pub async fn insert_resource(pool: &SqlitePool, title: &str) -> i64 {
        sqlx::query("INSERT INTO resources (title) VALUES (?)")
            .bind(title)
            .execute(pool)
            .await
            .expect("插入文章")
            .last_insert_rowid()
    }

    pub async fn insert_category(pool: &SqlitePool, name: &str) -> i64 {
        sqlx::query("INSERT INTO categories (name) VALUES (?)")
            .bind(name)
            .execute(pool)
            .await
            .expect("插入分类")
            .last_insert_rowid()
    }

    pub async fn insert_collection(pool: &SqlitePool, title: &str) -> i64 {
        sqlx::query("INSERT INTO collections (title) VALUES (?)")
            .bind(title)
            .execute(pool)
            .await
            .expect("插入合集")
            .last_insert_rowid()
    }

    /// 把文章挂到分类（一篇只有一个分类，表主键就是 resource_id）
    pub async fn attach_category(pool: &SqlitePool, rid: i64, cid: i64) {
        sqlx::query("INSERT INTO resource_categories (resource_id, category_id) VALUES (?, ?)")
            .bind(rid)
            .bind(cid)
            .execute(pool)
            .await
            .expect("挂分类");
    }

    pub async fn attach_collection(pool: &SqlitePool, rid: i64, cid: i64) {
        sqlx::query("INSERT INTO resource_collections (resource_id, collection_id) VALUES (?, ?)")
            .bind(rid)
            .bind(cid)
            .execute(pool)
            .await
            .expect("挂合集");
    }

    /// 移入回收站（软删）
    pub async fn soft_delete_resource(pool: &SqlitePool, rid: i64) {
        sqlx::query("UPDATE resources SET deleted_at = datetime('now') WHERE id = ?")
            .bind(rid)
            .execute(pool)
            .await
            .expect("软删");
    }

    pub async fn restore_resource(pool: &SqlitePool, rid: i64) {
        sqlx::query("UPDATE resources SET deleted_at = NULL WHERE id = ?")
            .bind(rid)
            .execute(pool)
            .await
            .expect("恢复");
    }

    /// 彻底删除（外键 CASCADE 会连带清掉关联行）
    pub async fn hard_delete_resource(pool: &SqlitePool, rid: i64) {
        sqlx::query("DELETE FROM resources WHERE id = ?")
            .bind(rid)
            .execute(pool)
            .await
            .expect("硬删");
    }

    /// 设置文章缩略图（合集封面回退逻辑会读它）
    pub async fn set_thumbnail(pool: &SqlitePool, rid: i64, path: &str) {
        sqlx::query("UPDATE resources SET thumbnail_path = ? WHERE id = ?")
            .bind(path)
            .bind(rid)
            .execute(pool)
            .await
            .expect("设置缩略图");
    }

    /// 关联行总数（不看文章是否软删）——用来证明「软删保留了关联行」，
    /// 这也正是分类/合集计数必须 Join resources 的原因。
    pub async fn category_relation_rows(pool: &SqlitePool) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM resource_categories")
            .fetch_one(pool)
            .await
            .expect("数关联行")
    }
}

