// 网络图片下载：流式接收 + Range 断点续传 + 解码校验，落库为封面 / 图集 / 正文图片
use std::path::Path;
use std::time::Duration;

use bytes::Bytes;
use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, RANGE, REFERER, USER_AGENT};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::task::JoinSet;

use crate::auth::{require_feature, FEATURE_ARTICLE_OWN};
use crate::db::repository;
use crate::error::{AppError, CmdResult};
use crate::state::AppState;

use super::http::{
    active_proxy, http_client, CHUNK_IDLE_TIMEOUT, DEFAULT_UA, MAX_IMAGE_BYTES, MAX_RESUME_ROUNDS,
};

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
    /// 原始远程地址；前端据此把下载结果映射回「待本地化」占位项
    pub source_url: String,
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
                        images.push(CollectedImage {
                            id,
                            file_path: path,
                            url: local_url,
                            source_url: url,
                            width: w,
                            height: h,
                        });
                    }
                    Err(e) => failed.push(FailedUrl { url, error: format!("入库失败: {e}") }),
                }
            }
            Err(e) => failed.push(FailedUrl { url, error: format!("保存失败: {e}") }),
        }
    }

    Ok(CollectImagesResult { images, failed })
}
