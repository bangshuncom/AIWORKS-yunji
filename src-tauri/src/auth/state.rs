// 认证状态：Tauri State 持有当前用户会话
use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug, Clone)]
pub struct UserSession {
    pub id: i64,
    pub username: String,
    pub nickname: String,
    pub email: String,
    pub bio: String,
    pub avatar_path: String,
    pub is_admin: bool,
    // 权限值 0-5；管理员恒为 5
    pub permission_level: i64,
    // 访问密码授权的资源 ID（内存缓存）
    pub granted_resource_ids: HashSet<i64>,
    // 访问密码授权的合集 ID（内存缓存）
    pub granted_collection_ids: HashSet<i64>,
}

impl UserSession {
    // 实际生效权限等级：管理员恒为最高
    pub fn effective_level(&self) -> i64 {
        if self.is_admin {
            5
        } else {
            self.permission_level.clamp(0, 5)
        }
    }
}

#[derive(Default)]
pub struct AuthState {
    pub current_user: Arc<RwLock<Option<UserSession>>>,
    /// 未登录访客凭访问密码解锁的内容（登录用户的解锁记在其会话内，切换用户即失效）
    guest_granted_resources: Arc<RwLock<HashSet<i64>>>,
    guest_granted_collections: Arc<RwLock<HashSet<i64>>>,
}

impl AuthState {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn current(&self) -> Option<UserSession> {
        self.current_user.read().await.clone()
    }

    pub async fn set_user(&self, user: UserSession) {
        *self.current_user.write().await = Some(user);
    }

    // 就地更新当前会话用户信息（资料修改后同步）
    pub async fn update_user(&self, f: impl FnOnce(&mut UserSession)) {
        if let Some(user) = self.current_user.write().await.as_mut() {
            f(user);
        }
    }

    pub async fn clear(&self) {
        *self.current_user.write().await = None;
    }

    /// 记录一次资源解锁：登录用户写入会话，未登录访客写入访客集合
    pub async fn grant_resource(&self, rid: i64) {
        let mut slot = self.current_user.write().await;
        match slot.as_mut() {
            Some(user) => {
                user.granted_resource_ids.insert(rid);
            }
            None => {
                drop(slot);
                self.guest_granted_resources.write().await.insert(rid);
            }
        }
    }

    pub async fn is_granted_resource(&self, rid: i64) -> bool {
        if self
            .current_user
            .read()
            .await
            .as_ref()
            .is_some_and(|u| u.granted_resource_ids.contains(&rid))
        {
            return true;
        }
        self.guest_granted_resources.read().await.contains(&rid)
    }

    /// 记录一次合集解锁（同上，区分登录与访客）
    pub async fn grant_collection(&self, cid: i64) {
        let mut slot = self.current_user.write().await;
        match slot.as_mut() {
            Some(user) => {
                user.granted_collection_ids.insert(cid);
            }
            None => {
                drop(slot);
                self.guest_granted_collections.write().await.insert(cid);
            }
        }
    }

    pub async fn is_granted_collection(&self, cid: i64) -> bool {
        if self
            .current_user
            .read()
            .await
            .as_ref()
            .is_some_and(|u| u.granted_collection_ids.contains(&cid))
        {
            return true;
        }
        self.guest_granted_collections.read().await.contains(&cid)
    }
}
