// 网页采集：抓取单页 HTML、采集插件管理、网络图片（封面/图集）下载落库
use std::path::Path;

use std::time::Duration;

use bytes::Bytes;
use futures_util::StreamExt;
use once_cell::sync::Lazy;
use reqwest::header::{HeaderMap, HeaderValue, RANGE, REFERER, USER_AGENT};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::task::JoinSet;

use crate::auth::{require_feature, FEATURE_ARTICLE_OWN};
use crate::db::repository;
use crate::error::{AppError, CmdResult};
use crate::state::AppState;

const DEFAULT_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const MAX_PAGE_BYTES: usize = 10 * 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 30 * 1024 * 1024;
/// 单个数据块的空闲等待：只要数据持续到达就不超时
const CHUNK_IDLE_TIMEOUT: Duration = Duration::from_secs(30);
/// 断点续传最大轮次
const MAX_RESUME_ROUNDS: u32 = 8;

/// HTTP 客户端：按代理设置构建，设置变更时重建。
/// proxy_mode = "system"（默认，跟随系统/环境变量） | "none"（直连） | "custom"（自定义地址）
static HTTP: Lazy<tokio::sync::RwLock<reqwest::Client>> = Lazy::new(|| {
    tokio::sync::RwLock::new(build_client(
        detect_proxy(),
    ))
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

async fn http_client() -> reqwest::Client {
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
fn active_proxy() -> Option<String> {
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

// ---------- 插件 ----------

#[derive(Debug, Serialize)]
pub struct CollectorInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub builtin: bool,
    pub patterns: Vec<String>,
    /// 插件完整 JSON（前端运行时按此提取字段）
    pub raw: String,
}

const BUILTIN_FILES: &[(&str, &str)] = &[(
    "fitgirl.yunji.json",
    include_str!("../../resources/collectors/fitgirl.yunji.json"),
)];

fn collectors_dir(state: &AppState) -> std::path::PathBuf {
    state.data_dir.join("collectors")
}

/// 确保插件目录存在；内置插件始终以程序内嵌版本为准（升级时自动同步，用户无法通过导入覆盖）
fn ensure_collectors_dir(state: &AppState) -> Result<std::path::PathBuf, AppError> {
    let dir = collectors_dir(state);
    std::fs::create_dir_all(&dir).map_err(AppError::Io)?;
    for (name, content) in BUILTIN_FILES {
        let p = dir.join(name);
        let needs_write = match std::fs::read_to_string(&p) {
            Ok(existing) => existing != *content,
            Err(_) => true,
        };
        if needs_write {
            let _ = std::fs::write(&p, content);
        }
    }
    Ok(dir)
}

fn parse_collector(raw: &str, builtin: bool) -> Option<CollectorInfo> {
    let v: serde_json::Value = serde_json::from_str(raw).ok()?;
    let obj = v.as_object()?;
    let id = obj.get("id")?.as_str()?.to_string();
    let name = obj.get("name").and_then(|x| x.as_str()).unwrap_or(&id).to_string();
    if id.is_empty() || !obj.contains_key("fields") {
        return None;
    }
    let version = obj
        .get("version")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let description = obj
        .get("description")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let patterns = obj
        .get("urlPattern")
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|p| p.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    Some(CollectorInfo { id, name, version, description, builtin, patterns, raw: raw.to_string() })
}

/// 列出全部采集插件
#[tauri::command]
pub async fn list_collectors(state: State<'_, AppState>) -> CmdResult<Vec<CollectorInfo>> {
    let dir = ensure_collectors_dir(&state)?;
    let mut out = Vec::new();
    let entries = std::fs::read_dir(&dir).map_err(AppError::Io)?;
    for ent in entries.flatten() {
        let path = ent.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Ok(raw) = std::fs::read_to_string(&path) else { continue };
        let builtin = BUILTIN_FILES
            .iter()
            .any(|(name, _)| path.file_name().and_then(|n| n.to_str()) == Some(*name));
        match parse_collector(&raw, builtin) {
            Some(info) => out.push(info),
            None => tracing::warn!("无法解析采集插件，已跳过: {}", path.display()),
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// 从本地文件导入第三方采集插件（文件名为 <id>.yunji.json）
#[tauri::command]
pub async fn import_collector(state: State<'_, AppState>, source_path: String) -> CmdResult<CollectorInfo> {
    require_feature(&state.db, &state.auth, FEATURE_ARTICLE_OWN).await?;
    let dir = ensure_collectors_dir(&state)?;
    let raw = std::fs::read_to_string(&source_path).map_err(AppError::Io)?;
    let info = parse_collector(&raw, false)
        .ok_or_else(|| AppError::BadRequest("插件格式无效：需要 id / name / fields 字段".into()))?;

    let safe_id: String = info
        .id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    if safe_id.is_empty() {
        return Err(AppError::BadRequest("插件 id 非法".into()));
    }
    let dest_name = format!("{}.yunji.json", safe_id);
    // 不允许覆盖内置插件
    if BUILTIN_FILES.iter().any(|(name, _)| *name == dest_name) {
        return Err(AppError::BadRequest("与内置插件 id 冲突，无法导入".into()));
    }
    std::fs::write(dir.join(&dest_name), raw).map_err(AppError::Io)?;
    Ok(info)
}

// ---------- 网页抓取 ----------

#[derive(Debug, Serialize)]
pub struct WebPage {
    pub url: String,
    /// 最终 URL（跟随重定向后）
    pub final_url: String,
    pub body: String,
}

#[tauri::command]
pub async fn fetch_webpage(url: String) -> CmdResult<WebPage> {
    let parsed = reqwest::Url::parse(&url)
        .map_err(|e| AppError::BadRequest(format!("URL 无效: {}", e)))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(AppError::BadRequest("仅支持 http/https 链接".into()));
    }

    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_str(DEFAULT_UA).unwrap());
    headers.insert("Accept", HeaderValue::from_str("text/html,application/xhtml+xml,*/*;q=0.8").unwrap());
    headers.insert("Accept-Language", HeaderValue::from_str("en-US,en;q=0.9,zh-CN;q=0.8").unwrap());

    let resp = tokio::time::timeout(
        Duration::from_secs(90),
        async {
            let client = http_client().await;
            client.get(parsed.clone()).headers(headers).send().await
        },
    )
    .await
    .map_err(|_| AppError::BadRequest("抓取超时（90 秒）".into()))?
    .map_err(|e| AppError::BadRequest(format!("抓取失败: {}", e)))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(AppError::BadRequest(format!("目标站点返回 HTTP {}", status.as_u16())));
    }
    let final_url = resp.url().to_string();
    // 限制最大体积；读取阶段也给整体超时
    let body = tokio::time::timeout(Duration::from_secs(90), resp.bytes())
        .await
        .map_err(|_| AppError::BadRequest("读取页面超时（90 秒）".into()))?
        .map_err(|e| AppError::BadRequest(format!("读取页面失败: {}", e)))?;
    if body.len() > MAX_PAGE_BYTES {
        return Err(AppError::BadRequest("页面体积超过 10MB 限制".into()));
    }
    // charset feature 开启后 text() 可按响应头编码解码；这里从字节检测 UTF-8 BOM
    let text = decode_html(&body);
    Ok(WebPage { url, final_url, body: text })
}

fn decode_html(body: &[u8]) -> String {
    if let Some(rest) = body.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(rest).into_owned();
    }
    String::from_utf8_lossy(body).into_owned()
}

// ---------- 图片下载 ----------

/// 实时下载进度（前端采集弹窗订阅 collector-progress 事件）
#[derive(Debug, Clone, Serialize)]
struct ProgressPayload {
    /// "cover" | "image"
    kind: &'static str,
    /// 图集内序号（封面固定 0）
    index: usize,
    /// 该类任务总数（封面 1）
    total_tasks: usize,
    /// 已写字节
    done: u64,
    /// 总字节（服务器提供时）
    size: Option<u64>,
    /// 断点续传轮次（0 起）
    round: u32,
    /// 当前生效的代理（None=直连，用于诊断"浏览器快/采集慢"）
    proxy: Option<String>,
}

fn emit_progress(app: &AppHandle, p: ProgressPayload) {
    let _ = app.emit("collector-progress", p);
}

#[derive(Debug, Serialize, Default)]
pub struct CollectedImage {
    pub id: i64,
    pub file_path: String,
    pub url: String,
    pub width: i64,
    pub height: i64,
}

#[derive(Debug, Serialize, Default)]
pub struct CollectImagesResult {
    pub images: Vec<CollectedImage>,
    pub failed: Vec<FailedUrl>,
}

#[derive(Debug, Serialize, Default)]
pub struct FailedUrl {
    pub url: String,
    pub error: String,
}

/// 流式下载 + Range 断点续传：
/// 部分国外图床速度极慢且连接会被中途掐断，一次性 bytes() 会丢掉已收数据。
/// 这里按 chunk 累积，单块 30 秒无数据才判定本轮失败，随后用 Range 从断点继续。
/// `on_progress(done, total, round)` 用于实时进度展示（内部约 250ms 节流）。
async fn fetch_image_bytes(
    url: &str,
    referer: &str,
    max_bytes: u64,
    on_progress: &mut (dyn FnMut(u64, Option<u64>, u32) + Send),
) -> Result<Bytes, String> {
    let mut buf: Vec<u8> = Vec::new();
    let mut allow_range = true;
    let mut last_err = String::new();
    let mut last_emit = std::time::Instant::now();

    for round in 0..MAX_RESUME_ROUNDS {
        let mut headers = HeaderMap::new();
        headers.insert(USER_AGENT, HeaderValue::from_str(DEFAULT_UA).unwrap());
        // 关键：声明自己是页面嵌图请求。图床（如 imageban）对 Accept: text/html 的
        // 地址栏导航会 302 跳转到展示网页，对 image/* 才直出图片字节
        headers.insert(
            reqwest::header::ACCEPT,
            HeaderValue::from_static("image/avif,image/webp,image/png,image/*,*/*;q=0.8"),
        );
        // 图片本身不压缩；identity 保证 Range 续传的字节语义不被传输编码干扰
        headers.insert(
            reqwest::header::ACCEPT_ENCODING,
            HeaderValue::from_static("identity"),
        );
        if !referer.is_empty() {
            if let Ok(v) = HeaderValue::from_str(referer) {
                headers.insert(REFERER, v);
            }
        }
        if allow_range && !buf.is_empty() {
            if let Ok(v) = HeaderValue::from_str(&format!("bytes={}-", buf.len())) {
                headers.insert(RANGE, v);
            }
        }

        let client = http_client().await;
        let resp = client
            .get(url)
            .headers(headers)
            .send()
            .await
            .map_err(|e| format!("请求失败: {e}"))?;
        let status = resp.status();
        if !status.is_success() {
            return Err(format!("HTTP {}", status.as_u16()));
        }
        let ctype = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_lowercase();
        if !ctype.is_empty() && !ctype.starts_with("image/") {
            return Err(format!("不是图片（{ctype}）"));
        }
        let partial = status.as_u16() == 206;
        if !partial && !buf.is_empty() {
            // 服务器忽略 Range：只能整份重下，后续不再尝试续传
            buf.clear();
            allow_range = false;
        }
        // 体积预检：200 看 Content-Length，206 看 Content-Range 的总长
        let total_size = declared_total_length(&resp, partial);
        if let Some(total) = total_size {
            if total > max_bytes {
                return Err("超过 30MB 限制".into());
            }
        }

        let mut stream = resp.bytes_stream();
        let mut done = false;
        // 拿到响应头立即反馈一次：前端立刻能看到代理状态/续传轮次/总体积
        on_progress(buf.len() as u64, total_size, round);
        let outcome: Result<(), String> = async {
            loop {
                match tokio::time::timeout(CHUNK_IDLE_TIMEOUT, stream.next()).await {
                    Ok(Some(Ok(chunk))) => {
                        if buf.len() as u64 + chunk.len() as u64 > max_bytes {
                            return Err("超过 30MB 限制".into());
                        }
                        buf.extend_from_slice(&chunk);
                        if last_emit.elapsed() >= Duration::from_millis(250) {
                            on_progress(buf.len() as u64, total_size, round);
                            last_emit = std::time::Instant::now();
                        }
                    }
                    Ok(Some(Err(e))) => {
                        return Err(format!("连接中断（已下载 {} 字节）: {e}", buf.len()))
                    }
                    Ok(None) => {
                        done = true;
                        return Ok(());
                    }
                    Err(_) => {
                        return Err(format!("下载停滞超过 30 秒（已下载 {} 字节），尝试续传", buf.len()))
                    }
                }
            }
        }
        .await;
        // 每轮结束补发一次，保证续传边界处 UI 也有反馈
        on_progress(buf.len() as u64, total_size, round);

        if outcome.is_ok() && done {
            break;
        }
        if let Err(e) = outcome {
            last_err = e;
        }
        if round == MAX_RESUME_ROUNDS - 1 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    if buf.is_empty() {
        return Err(if last_err.is_empty() {
            "下载失败".to_string()
        } else {
            last_err
        });
    }
    Ok(Bytes::from(buf))
}

/// 从响应头推算资源总字节数（用于超限预检）
fn declared_total_length(resp: &reqwest::Response, partial: bool) -> Option<u64> {
    if partial {
        // Content-Range: bytes 0-1023/86358
        let cr = resp
            .headers()
            .get(reqwest::header::CONTENT_RANGE)?
            .to_str()
            .ok()?;
        cr.rsplit('/').next()?.parse().ok()
    } else {
        resp.content_length()
    }
}

/// 下载并校验单张图片：能被 image crate 解码（天然排除视频/HTML 假图）
/// 返回 (字节, 扩展名, 宽, 高)
async fn download_image_bytes(
    url: &str,
    referer: &str,
    on_progress: &mut (dyn FnMut(u64, Option<u64>, u32) + Send),
) -> Result<(Bytes, &'static str, i64, i64), String> {
    let bytes = fetch_image_bytes(url, referer, MAX_IMAGE_BYTES, on_progress).await?;
    // 解码校验：视频/错误页在此被拒绝，同时拿到尺寸
    let img = image::load_from_memory(&bytes).map_err(|e| format!("图片解码失败: {e}"))?;
    let (w, h) = (img.width() as i64, img.height() as i64);
    let ext = match image::guess_format(&bytes) {
        Ok(image::ImageFormat::Jpeg) => "jpg",
        Ok(image::ImageFormat::Png) => "png",
        Ok(image::ImageFormat::Gif) => "gif",
        Ok(image::ImageFormat::WebP) => "webp",
        Ok(image::ImageFormat::Bmp) => "bmp",
        _ => ext_from_url(url).unwrap_or("jpg"),
    };
    Ok((bytes, ext, w, h))
}

fn ext_from_url(url: &str) -> Option<&'static str> {
    let path = reqwest::Url::parse(url).ok()?.path().to_lowercase();
    for ext in ["jpg", "jpeg", "png", "webp", "gif", "bmp"] {
        if path.ends_with(&format!(".{ext}")) {
            return Some(if ext == "jpeg" { "jpg" } else { ext });
        }
    }
    None
}

/// 由 URL 生成安全文件名（保留原名，去查询串/非法字符；无扩展名时补 jpg）
fn filename_from_url(url: &str, ext: &str) -> String {
    let parsed = reqwest::Url::parse(url).ok();
    let base = parsed
        .as_ref()
        .and_then(|u| Path::new(u.path()).file_name())
        .and_then(|n| n.to_str())
        .unwrap_or("image")
        .to_string();
    let stem: String = base
        .split('.')
        .next()
        .unwrap_or("image")
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .take(60)
        .collect();
    let stem = if stem.is_empty() { "image".to_string() } else { stem };
    format!("{stem}.{ext}")
}

/// 采集封面：下载网络图并设为文章缩略图（覆盖旧图）
#[tauri::command]
pub async fn collector_set_thumbnail(
    app: AppHandle,
    state: State<'_, AppState>,
    rid: i64,
    url: String,
    referer: String,
) -> CmdResult<String> {
    require_feature(&state.db, &state.auth, FEATURE_ARTICLE_OWN).await?;
    let storage = state.storage.get().await;

    let app_cb = app.clone();
    let mut on_progress = |done: u64, size: Option<u64>, round: u32| {
        emit_progress(
            &app_cb,
            ProgressPayload {
                kind: "cover",
                index: 0,
                total_tasks: 1,
                done,
                size,
                round,
                proxy: active_proxy(),
            },
        );
    };
    // 立即推一次：前端马上能看到是否走了代理
    on_progress(0, None, 0);
    let (bytes, ext, _, _) = download_image_bytes(&url, &referer, &mut on_progress)
        .await
        .map_err(AppError::BadRequest)?;
    let filename = filename_from_url(&url, &ext);
    let saved = storage
        .save(bytes, &filename, "thumbnails")
        .await
        .map_err(AppError::Storage)?;

    let old = repository::resources::get(&state.db, rid).await.ok();
    let old_path = old.as_ref().map(|r| r.thumbnail_path.clone()).unwrap_or_default();

    sqlx::query("UPDATE resources SET thumbnail_path=?, updated_at=datetime('now','localtime') WHERE id=?")
        .bind(&saved)
        .bind(rid)
        .execute(&state.db)
        .await
        .map_err(AppError::Db)?;

    if !old_path.is_empty() {
        let _ = storage.delete(&old_path).await;
    }
    Ok(saved)
}

/// 编辑器粘贴图片本地化：下载远程图片 URL，存入 content 目录，
/// 返回存储相对路径（前端用它替换 markdown 中的远程链接）
#[tauri::command]
pub async fn download_remote_image(
    state: State<'_, AppState>,
    url: String,
    referer: String,
) -> CmdResult<String> {
    require_feature(&state.db, &state.auth, FEATURE_ARTICLE_OWN).await?;
    let storage = state.storage.get().await;

    let mut noop_progress = |_: u64, _: Option<u64>, _: u32| {};
    let (bytes, ext, _, _) = download_image_bytes(&url, &referer, &mut noop_progress)
        .await
        .map_err(AppError::BadRequest)?;
    let filename = filename_from_url(&url, &ext);
    let saved = storage
        .save(bytes, &filename, "content")
        .await
        .map_err(AppError::Storage)?;
    Ok(saved)
}

/// 采集图集：并发下载（上限 6），校验图片后加入文章图集
#[tauri::command]
pub async fn collector_add_images(
    app: AppHandle,
    state: State<'_, AppState>,
    rid: i64,
    urls: Vec<String>,
    referer: String,
) -> CmdResult<CollectImagesResult> {
    require_feature(&state.db, &state.auth, FEATURE_ARTICLE_OWN).await?;
    let storage = state.storage.get().await;
    let task_total = urls.len();

    let mut set: JoinSet<(usize, String, Result<(Bytes, &'static str, i64, i64), String>)> =
        JoinSet::new();
    for (i, u) in urls.iter().enumerate() {
        let url = u.clone();
        let referer = referer.clone();
        let app_task = app.clone();
        set.spawn(async move {
            let mut on_progress = move |done: u64, size: Option<u64>, round: u32| {
                emit_progress(
                    &app_task,
                    ProgressPayload {
                        kind: "image",
                        index: i,
                        total_tasks: task_total,
                        done,
                        size,
                        round,
                        proxy: active_proxy(),
                    },
                );
            };
            let r = download_image_bytes(&url, &referer, &mut on_progress)
                .await
                .map(|(b, e, w, h)| (b, e, w, h));
            (i, url, r)
        });
        if set.len() >= 6 {
            let _ = set.join_next().await;
        }
    }

    // 按原始顺序收集
    let mut downloaded: Vec<(usize, String, Bytes, &'static str, i64, i64)> = Vec::new();
    let mut failed: Vec<FailedUrl> = Vec::new();
    while let Some(joined) = set.join_next().await {
        if let Ok((i, url, Ok((bytes, ext, w, h)))) = joined {
            downloaded.push((i, url, bytes, ext, w, h));
        } else if let Ok((_, url, Err(e))) = joined {
            failed.push(FailedUrl { url, error: e });
        }
    }
    downloaded.sort_by_key(|(i, _, _, _, _, _)| *i);

    let mut images = Vec::new();
    for (_, url, bytes, ext, w, h) in downloaded {
        let filename = filename_from_url(&url, &ext);
        match storage.save(bytes, &filename, "gallery").await {
            Ok(path) => {
                match repository::images::add_to_resource(&state.db, rid, &path, w, h).await {
                    Ok(id) => {
                        let local_url = storage.get_url(&path);
                        images.push(CollectedImage { id, file_path: path, url: local_url, width: w, height: h });
                    }
                    Err(e) => failed.push(FailedUrl { url, error: format!("入库失败: {e}") }),
                }
            }
            Err(e) => failed.push(FailedUrl { url, error: format!("保存失败: {e}") }),
        }
    }

    Ok(CollectImagesResult { images, failed })
}
