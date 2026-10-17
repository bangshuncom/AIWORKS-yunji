// SQLite 连接池管理
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use std::path::Path;
use std::str::FromStr;

pub async fn create_pool(db_path: &Path) -> Result<SqlitePool, sqlx::Error> {
    // 确保父目录存在
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }

    let options = SqliteConnectOptions::from_str(&format!("sqlite:{}", db_path.display()))?
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .foreign_keys(true)
        .busy_timeout(std::time::Duration::from_secs(10))
        .synchronous(sqlx::sqlite::SqliteSynchronous::Normal);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;

    // 设置 busy_timeout pragma（双保险）
    sqlx::query("PRAGMA busy_timeout = 10000")
        .execute(&pool)
        .await?;

    Ok(pool)
}

/// 将 SQL 脚本拆成独立语句（去掉 `--` 注释，按 `;` 切分，尊重单引号字符串）。
/// sqlx 的 SQLite 驱动对含多条语句的字符串不保证逐条执行，因此必须拆分后单独 execute。
fn split_sql(script: &str) -> Vec<String> {
    let mut statements = Vec::new();
    let mut current = String::new();
    let mut in_string = false;
    let mut chars = script.chars().peekable();

    while let Some(c) = chars.next() {
        if in_string {
            current.push(c);
            if c == '\'' {
                // '' 是字符串内的转义单引号
                if chars.peek() == Some(&'\'') {
                    current.push(chars.next().unwrap());
                } else {
                    in_string = false;
                }
            }
            continue;
        }
        if c == '-' && chars.peek() == Some(&'-') {
            chars.next();
            // 丢弃直到行尾的注释内容
            while let Some(&x) = chars.peek() {
                chars.next();
                if x == '\n' {
                    break;
                }
            }
            continue;
        }
        if c == '\'' {
            in_string = true;
            current.push(c);
            continue;
        }
        if c == ';' {
            let trimmed = current.trim();
            if !trimmed.is_empty() {
                statements.push(trimmed.to_string());
            }
            current.clear();
            continue;
        }
        current.push(c);
    }
    let trimmed = current.trim();
    if !trimmed.is_empty() {
        statements.push(trimmed.to_string());
    }
    statements
}

/// 逐条执行脚本：strict=true 时任一语句失败即返回错误；false 时忽略错误（用于幂等 ALTER）
async fn exec_script(pool: &SqlitePool, script: &str, strict: bool) -> Result<(), sqlx::Error> {
    for stmt in split_sql(script) {
        let result = sqlx::query(&stmt).execute(pool).await;
        if strict {
            result?;
        }
    }
    Ok(())
}

/// 检查某列是否存在（表名来自代码内常量，直接内拼，无注入风险）
async fn column_exists(pool: &SqlitePool, table: &str, column: &str) -> Result<bool, sqlx::Error> {
    let count: i64 = sqlx::query_scalar(&format!(
        "SELECT COUNT(*) FROM pragma_table_info('{}') WHERE name = ?",
        table
    ))
    .bind(column)
    .fetch_one(pool)
    .await?;
    Ok(count > 0)
}

/// 历史数据升级：旧版本把访问密码当明文直接落库，这里补算成 argon2 哈希（幂等）。
/// 已是 PHC 哈希（形如 $argon2...）的行跳过，因此每次启动执行也无害。
async fn hash_legacy_access_passwords(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    for table in ["resources", "collections"] {
        let rows: Vec<(i64, String)> = sqlx::query_as(&format!(
            "SELECT id, access_password FROM {table} WHERE access_password <> ''"
        ))
        .fetch_all(pool)
        .await?;
        for (id, password) in rows {
            if password.starts_with('$') {
                continue;
            }
            match crate::auth::hash_access_password(&password) {
                Ok(hashed) => {
                    sqlx::query(&format!("UPDATE {table} SET access_password = ? WHERE id = ?"))
                        .bind(hashed)
                        .bind(id)
                        .execute(pool)
                        .await?;
                }
                Err(e) => {
                    tracing::warn!("升级 {table}#{id} 的访问密码失败: {}", e);
                }
            }
        }
    }
    Ok(())
}

pub async fn run_migrations(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    // 0001/0002：建表与索引（全部 IF NOT EXISTS，幂等），逐条执行，错误直接返回
    exec_script(pool, include_str!("migrations/0001_init.sql"), true).await?;
    exec_script(pool, include_str!("migrations/0002_categories.sql"), true).await?;
    // 0003/0004：旧库补列（新库 0001 已含，ALTER 会失败），逐条容错
    exec_script(
        pool,
        include_str!("migrations/0003_collection_images_dimensions.sql"),
        false,
    )
    .await?;
    exec_script(pool, include_str!("migrations/0004_users_system.sql"), false).await?;

    // 0006：资源作者列（旧库补列，新库 ALTER 幂等容错）
    exec_script(pool, include_str!("migrations/0006_resource_author.sql"), false).await?;

    // 0007：合集作者列（区分"编辑自己的合集"与"管理他人合集"）
    exec_script(pool, include_str!("migrations/0007_collection_author.sql"), false).await?;

    // 0008：合集正文内容（Markdown）
    exec_script(pool, include_str!("migrations/0008_collection_content.sql"), false).await?;

    // 0005：权限系统。ALTER 逐条容错；visibility -> read_level 的回填只在新列刚添加时执行一次，
    // 避免以后每次启动都用旧 visibility 覆盖管理员设置过的 read_level
    let read_level_already = column_exists(pool, "resources", "read_level").await?;
    exec_script(
        pool,
        include_str!("migrations/0005_permission_system.sql"),
        false,
    )
    .await?;
    if !read_level_already && column_exists(pool, "resources", "visibility").await? {
        let _ = sqlx::query(
            "UPDATE resources SET read_level = CASE WHEN visibility = 'public' THEN 0 ELSE 5 END",
        )
        .execute(pool)
        .await;
    }

    // 将最早创建的用户提升为管理员（兼容旧库升级，幂等）
    let _ = sqlx::query("UPDATE users SET is_admin = 1 WHERE id = (SELECT MIN(id) FROM users)")
        .execute(pool)
        .await;
    // 管理员权限值恒为 5（幂等）
    let _ = sqlx::query("UPDATE users SET permission_level = 5 WHERE is_admin = 1")
        .execute(pool)
        .await;
    // 0006 回填：迁移前的历史资源归给最早的用户；之后新建资源必带 user_id，此语句不再生效
    let _ = sqlx::query(
        "UPDATE resources SET user_id = (SELECT MIN(id) FROM users) \
         WHERE user_id IS NULL AND (SELECT COUNT(*) FROM users) > 0",
    )
    .execute(pool)
    .await;

    // 访问密码：把历史明文密码补算为 argon2 哈希
    hash_legacy_access_passwords(pool).await?;
    Ok(())
}
