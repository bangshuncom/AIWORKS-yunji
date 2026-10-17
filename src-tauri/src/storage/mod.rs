// 本地磁盘存储：本项目唯一的存储实现
// 目录布局固定为 <data_dir>/<local_upload_dir>，URL 前缀由设置项 local_url_prefix 决定
use bytes::Bytes;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::fs;
use tokio::sync::RwLock;

use crate::db::repository::settings;

pub struct LocalStorage {
    pub upload_dir: PathBuf,
    pub url_prefix: String,
}

impl LocalStorage {
    pub fn new(upload_dir: impl Into<PathBuf>, url_prefix: &str) -> Self {
        let upload_dir = upload_dir.into();
        // 使用同步 std::fs 在构造时确保目录存在（构造函数非 async）
        std::fs::create_dir_all(&upload_dir).ok();
        Self {
            upload_dir,
            url_prefix: url_prefix.trim_end_matches('/').to_string(),
        }
    }

    /// 校验相对路径不越权，并拼出绝对路径
    fn full_path(&self, rel_path: &str) -> anyhow::Result<PathBuf> {
        let full = self.upload_dir.join(rel_path);
        let canonical = full.canonicalize().unwrap_or_else(|_| full.clone());
        let base = self.upload_dir.canonicalize().unwrap_or_else(|_| self.upload_dir.clone());
        if !canonical.starts_with(&base) {
            anyhow::bail!("非法存储路径: {}", rel_path);
        }
        Ok(full)
    }

    /// 时间戳 + 随机数生成唯一文件名
    fn unique_name(&self, filename: &str) -> String {
        let ext = Path::new(filename)
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("dat");
        let ts = chrono::Local::now().format("%Y%m%d%H%M%S");
        let rand: u32 = rand::random();
        format!("{}_{}.{}", ts, rand, ext)
    }

    /// 保存并自动生成唯一文件名，返回相对存储路径
    pub async fn save(&self, data: Bytes, filename: &str, subdir: &str) -> anyhow::Result<String> {
        let unique = self.unique_name(filename);
        let rel = if subdir.is_empty() {
            unique.clone()
        } else {
            format!("{}/{}", subdir, unique)
        };
        let full = self.upload_dir.join(&rel);
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent).await?;
        }
        fs::write(&full, &data).await?;
        Ok(rel.replace('\\', "/"))
    }

    /// 按调用方给定的文件名保存（不自动加时间戳/随机后缀）。
    /// 若同名文件已存在，自动在文件名尾部追加 _1、_2… 区分，返回相对存储路径。
    pub async fn save_named(
        &self,
        data: Bytes,
        filename: &str,
        subdir: &str,
    ) -> anyhow::Result<String> {
        let dir = if subdir.is_empty() {
            self.upload_dir.clone()
        } else {
            self.upload_dir.join(subdir.trim_matches('/'))
        };
        fs::create_dir_all(&dir).await?;

        let stem = Path::new(filename)
            .file_stem()
            .and_then(|s| s.to_str())
            .filter(|s| !s.is_empty())
            .unwrap_or("file");
        let ext = Path::new(filename)
            .extension()
            .and_then(|s| s.to_str())
            .filter(|s| !s.is_empty())
            .unwrap_or("torrent");

        let mut candidate = format!("{}.{}", stem, ext);
        let mut n: usize = 1;
        while dir.join(&candidate).exists() {
            candidate = format!("{}_{}.{}", stem, n, ext);
            n += 1;
        }

        fs::write(dir.join(&candidate), &data).await?;

        let rel = if subdir.is_empty() {
            candidate
        } else {
            format!("{}/{}", subdir.trim_matches('/'), candidate)
        };
        Ok(rel.replace('\\', "/"))
    }

    pub async fn read(&self, path: &str) -> anyhow::Result<Bytes> {
        let full = self.full_path(path)?;
        let data = fs::read(&full).await?;
        Ok(Bytes::from(data))
    }

    /// 删除文件；不存在时返回 false
    pub async fn delete(&self, path: &str) -> anyhow::Result<bool> {
        let full = self.full_path(path)?;
        match fs::remove_file(&full).await {
            Ok(_) => Ok(true),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(e) => Err(e.into()),
        }
    }

    pub fn get_url(&self, path: &str) -> String {
        if path.is_empty() {
            return String::new();
        }
        format!("{}/{}", self.url_prefix, path)
    }

    pub fn upload_dir(&self) -> &Path {
        &self.upload_dir
    }
}

pub type StorageRef = Arc<LocalStorage>;

/// 按当前设置项构造存储；设置项变化后由 AppState::reset_storage 热替换
pub async fn get_storage(
    pool: &sqlx::SqlitePool,
    data_dir: &Path,
) -> anyhow::Result<StorageRef> {
    let upload_dir_name = settings::get(pool, "local_upload_dir")
        .await?
        .unwrap_or_else(|| "uploads".to_string());
    let url_prefix = settings::get(pool, "local_url_prefix")
        .await?
        .unwrap_or_else(|| "yunji-files".to_string());

    let upload_dir = if Path::new(&upload_dir_name).is_absolute() {
        PathBuf::from(&upload_dir_name)
    } else {
        data_dir.join(&upload_dir_name)
    };

    Ok(Arc::new(LocalStorage::new(upload_dir, &url_prefix)))
}

pub struct StorageState {
    inner: RwLock<StorageRef>,
}

impl StorageState {
    pub fn new(storage: StorageRef) -> Self {
        Self {
            inner: RwLock::new(storage),
        }
    }

    pub async fn get(&self) -> StorageRef {
        self.inner.read().await.clone()
    }

    pub async fn reset(&self, storage: StorageRef) {
        *self.inner.write().await = storage;
    }
}
