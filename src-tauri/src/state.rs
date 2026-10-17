// 应用全局状态
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use sqlx::SqlitePool;
use std::path::PathBuf;

use crate::auth::AuthState;
use crate::storage::{StorageRef, StorageState};

#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub auth: Arc<AuthState>,
    pub storage: Arc<StorageState>,
    pub data_dir: PathBuf,
    pub upload_base_dir: PathBuf,
    /// 翻译取消标志：前端点「取消」时置位，翻译流程每翻完一块检查一次
    pub translate_cancel: Arc<AtomicBool>,
}

impl AppState {
    pub fn new(db: SqlitePool, storage: StorageRef, data_dir: PathBuf) -> Self {
        let upload_base_dir = storage.upload_dir().to_path_buf();
        Self {
            db,
            auth: Arc::new(AuthState::new()),
            storage: Arc::new(StorageState::new(storage)),
            data_dir,
            upload_base_dir,
            translate_cancel: Arc::new(AtomicBool::new(false)),
        }
    }

    pub async fn reset_storage(&self, storage: StorageRef) {
        self.storage.reset(storage).await;
    }
}
