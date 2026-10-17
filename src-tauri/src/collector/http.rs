// 采集模块的 HTTP 基础设施：客户端构建、代理解析（系统 / 环境变量 / 自定义）
use std::time::Duration;

use once_cell::sync::Lazy;
use tauri::State;

use crate::db::repository;
use crate::state::AppState;

pub(crate) const DEFAULT_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
pub(crate) const MAX_PAGE_BYTES: usize = 10 * 1024 * 1024;
pub(crate) const MAX_IMAGE_BYTES: u64 = 30 * 1024 * 1024;
/// 单个数据块的空闲等待：只要数据持续到达就不超时
pub(crate) const CHUNK_IDLE_TIMEOUT: Duration = Duration::from_secs(30);
/// 断点续传最大轮次
pub(crate) const MAX_RESUME_ROUNDS: u32 = 8;

/// HTTP 客户端：按代理设置构建，设置变更时重建。
/// proxy_mode = "system"（默认，跟随系统/环境变量） | "none"（直连） | "custom"（自定义地址）
pub(crate) static HTTP: Lazy<tokio::sync::RwLock<reqwest::Client>> = Lazy::new(|| {
    tokio::sync::RwLock::new(build_client(detect_proxy()))
});

/// 本次进程实际使用的代理地址（供进度事件展示/诊断）
static DETECTED_PROXY: once_cell::sync::OnceCell<Option<String>> = once_cell::sync::OnceCell::new();

fn build_client(proxy_url: Option<String>) -> reqwest::Client {
    let mut builder = reqwest::Client::builder()
        // 只限制连接阶段；慢网络下图床可能数百秒持续低速传数据，
        // body 总时长由各调用方按空闲超时自行控制
        .connect_timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::limited(5));
    if let Some(ref p) = proxy_url {
        if let Ok(proxy) = reqwest::Proxy::all(p) {
            builder = builder.proxy(proxy);
        }
    }
    let _ = DETECTED_PROXY.set(proxy_url);
    builder.build().expect("reqwest client")
}

pub(crate) async fn http_client() -> reqwest::Client {
    HTTP.read().await.clone()
}

/// 按代理模式解析出代理地址（custom 模式下读数据库设置）
async fn resolve_proxy_from_state(state: &State<'_, AppState>) -> Option<String> {
    let mode = repository::settings::get(&state.db, "proxy_mode")
        .await
        .ok()
        .flatten()
        .unwrap_or_else(|| "system".into());
    match mode.as_str() {
        "none" => None,
        "custom" => repository::settings::get(&state.db, "proxy_url")
            .await
            .ok()
            .flatten()
            .filter(|u| !u.trim().is_empty())
            .map(|u| if u.contains("://") { u } else { format!("http://{u}") }),
        _ => detect_proxy(),
    }
}

/// 应用代理设置（设置变更后调用）：重建 HTTP 客户端
pub async fn apply_proxy_settings(state: &State<'_, AppState>) {
    let proxy = resolve_proxy_from_state(state).await;
    let mut client = HTTP.write().await;
    *client = build_client(proxy);
}

/// 当前设置下实际生效的代理地址（诊断展示用）
pub async fn current_effective_proxy(state: &State<'_, AppState>) -> Option<String> {
    resolve_proxy_from_state(state).await
}

/// 当前生效的代理（探测前返回 None）
pub(crate) fn active_proxy() -> Option<String> {
    DETECTED_PROXY.get().cloned().flatten()
}

/// 代理解析：环境变量优先，其次读取 Windows 系统代理（与浏览器行为一致）
fn detect_proxy() -> Option<String> {
    for k in ["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"] {
        if let Ok(v) = std::env::var(k) {
            let v = v.trim();
            if !v.is_empty() {
                return Some(if v.contains("://") {
                    v.to_string()
                } else {
                    format!("http://{v}")
                });
            }
        }
    }
    windows_system_proxy()
}

/// 解析 WinINET ProxyServer 字段：
/// "127.0.0.1:7890" 或 "http=h:p;https=h2:p2"（优先取 https= 段）
fn parse_wininet_proxy(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    let mut fallback: Option<String> = None;
    for part in raw.split(';') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if let Some(v) = part.strip_prefix("https=") {
            return Some(normalize_proxy(v));
        }
        if let Some(v) = part.strip_prefix("http=") {
            if fallback.is_none() {
                fallback = Some(v.to_string());
            }
        } else if !part.contains('=') && fallback.is_none() {
            fallback = Some(part.to_string());
        }
    }
    fallback.as_deref().map(normalize_proxy)
}

fn normalize_proxy(v: &str) -> String {
    if v.contains("://") {
        v.to_string()
    } else {
        format!("http://{v}")
    }
}

#[cfg(windows)]
fn windows_system_proxy() -> Option<String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Internet Settings")
        .ok()?;
    let enabled: u32 = key.get_value("ProxyEnable").ok()?;
    if enabled == 0 {
        return None;
    }
    let server: String = key.get_value("ProxyServer").ok()?;
    parse_wininet_proxy(&server)
}

#[cfg(not(windows))]
fn windows_system_proxy() -> Option<String> {
    None
}

#[cfg(test)]
mod proxy_tests {
    use super::parse_wininet_proxy;

    #[test]
    fn wininet_proxy_formats() {
        assert_eq!(
            parse_wininet_proxy("127.0.0.1:7890").as_deref(),
            Some("http://127.0.0.1:7890")
        );
        assert_eq!(
            parse_wininet_proxy("http=127.0.0.1:7890;https=127.0.0.1:7891").as_deref(),
            Some("http://127.0.0.1:7891")
        );
        assert_eq!(parse_wininet_proxy("").as_deref(), None);
    }
}
