// 网页抓取：拉取单页 HTML（供前端按采集插件的选择器提取字段）
use std::time::Duration;
use serde::Serialize;
use reqwest::header::{HeaderMap, HeaderValue, USER_AGENT};

use crate::error::{AppError, CmdResult};

use super::http::{http_client, DEFAULT_UA, MAX_PAGE_BYTES};

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
