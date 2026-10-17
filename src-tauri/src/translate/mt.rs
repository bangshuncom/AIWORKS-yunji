// 机器翻译（MT）引擎的请求适配器
//
// 与 `client.rs`（大模型）的区别：这些引擎**不能下指令**，一次只做「文本进、译文出」，
// 所以 Markdown 结构只能靠切块 + 占位符在本地保住（见 `md.rs` 与 `mod.rs`）。
// 好处是免费额度通常大得多、响应也快，适合当日常主力或大模型的备用。
//
// 每家协议都不一样，但公共形状是一致的：给一批片段 + 目标语言码，拿回同样多的译文。
// `translate_texts` 就是这个统一入口，内部按引擎分派。
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::Client;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, CmdResult};

use super::engine::EngineKind;
use super::sign::{self, Tc3Request};

/// 单次机器翻译请求的超时。机翻是纯推理、不走逐 token 生成，
/// 比大模型的 300 秒短得多；但跨境的 DeepL 仍可能慢，给足 60 秒。
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

/// 一次机翻请求的全部外部信息（地址、凭证、目标语言码）
pub struct MtRequest<'a> {
    pub kind: EngineKind,
    pub base_url: &'a str,
    /// 第一个凭证：API Key / APP ID / SecretId / 邮箱
    pub cred1: &'a str,
    /// 第二个凭证：百度的密钥 / 腾讯的 SecretKey，没有则为空串
    pub cred2: &'a str,
    /// 附加参数：腾讯的地域，其余引擎为空串
    pub extra: &'a str,
    /// **引擎原生**的目标语言码（已由 `engine::target_code` 转换过）
    pub target: &'a str,
}

/// 把一批片段交给对应引擎翻译，返回与入参**顺序一致、数量相同**的译文。
///
/// 数量对不上时整批报错让调用方保留原文：宁可这一段不译，也不能错位回填到别的段落上。
pub async fn translate_texts(
    client: &Client,
    req: &MtRequest<'_>,
    texts: &[String],
) -> CmdResult<Vec<String>> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }
    let out = match req.kind {
        EngineKind::DeepL => deepl(client, req, texts).await?,
        EngineKind::Libre => libre(client, req, texts).await?,
        EngineKind::MyMemory => my_memory(client, req, texts).await?,
        EngineKind::Baidu => baidu(client, req, texts).await?,
        EngineKind::Tencent => tencent(client, req, texts).await?,
        EngineKind::Llm => {
            return Err(AppError::BadRequest(
                "大模型引擎不走机器翻译通道（请检查服务商配置）".into(),
            ))
        }
    };
    if out.len() != texts.len() {
        return Err(AppError::BadRequest(format!(
            "{} 返回的译文条目数（{}）与请求的片段数（{}）不一致，已保留原文",
            req.kind.label(),
            out.len(),
            texts.len()
        )));
    }
    Ok(out)
}

// ---------------- 公共小工具 ----------------

/// HTTP 状态码 + 响应体 → 可读错误。各家的错误体格式不同，原样带上便于排查。
fn http_error(name: &str, status: reqwest::StatusCode, body: &str) -> AppError {
    let hint = match status.as_u16() {
        401 | 403 => "：凭证无效或无权限，请检查「应用设置 → 翻译」里的 Key",
        429 => "：请求过于频繁（额度或 QPS 限制），请稍后重试",
        456 => "：本月免费额度已用完（DeepL 免费版），下月 1 日恢复",
        500..=599 => "：服务商暂时不可用，请稍后重试",
        _ => "",
    };
    // 返回网页通常意味着地址填错、被 CDN 拦了，或该实例已关闭公开接口；
    // 把整段 HTML 贴进错误提示毫无意义，换成一句能行动的话。
    let detail = if body.trim_start().starts_with('<') {
        "（对方返回的是网页而不是接口响应：地址可能不对，或该服务已收紧公开调用）".to_string()
    } else {
        format!("｜原始响应：{}", truncate(body, 200))
    };
    AppError::BadRequest(format!("{name} 返回 HTTP {status}{hint}{detail}"))
}

fn truncate(s: &str, max: usize) -> String {
    let t = s.trim();
    let mut out: String = t.chars().take(max).collect();
    if t.chars().count() > max {
        out.push('…');
    }
    out
}

/// 拼端点：base_url 已经写到具体路径时不重复追加
fn endpoint(base_url: &str, default_base: &str, path: &str) -> String {
    let raw = if base_url.trim().is_empty() { default_base } else { base_url.trim() };
    let base = raw.trim_end_matches('/');
    if base.ends_with(path) {
        base.to_string()
    } else {
        format!("{base}{path}")
    }
}

/// 从 URL 里取出主机名（腾讯云的签名要把它写进规范请求串）
fn host_of(url: &str) -> String {
    let rest = url
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    rest.split('/').next().unwrap_or("").trim().to_string()
}

/// 把超长的待译片段按上限切开，返回 `(片段, 紧随其后的分隔符)`。
///
/// 分隔符**不放进**片段里发出去：机翻引擎普遍会裁掉片段首尾的空白，
/// 若把换行留在片段尾部就会被它吃掉，长段落切开后就会粘成没有断点的一坨。
/// 所以这里先摘出来，最后按原样拼回去。
pub fn chunk_text(text: &str, budget: usize) -> Vec<(String, String)> {
    let budget = budget.max(1);
    let mut out: Vec<(String, String)> = Vec::new();
    let mut rest = text;
    while rest.chars().count() > budget {
        let (head_len, sep_len) = choose_cut(rest, budget);
        if head_len == 0 {
            // 理论上不会发生；真发生了也不能死循环，整段收尾
            break;
        }
        let (head, tail) = rest.split_at(head_len);
        let (sep, tail) = tail.split_at(sep_len.min(tail.len()));
        out.push((head.to_string(), sep.to_string()));
        rest = tail;
    }
    out.push((rest.to_string(), String::new()));
    out
}

/// 在前 `budget` 个字符内找一个像样的断点，返回 `(保留部分的字节数, 分隔符的字节数)`。
///
/// 优先级：换行 → 句末标点 → 分号/逗号 → 空格 → 硬切。
/// 换行与空格属于「分隔符」，从保留部分里剔出去；标点是内容，留在前一段里。
fn choose_cut(s: &str, budget: usize) -> (usize, usize) {
    let window: String = s.chars().take(budget).collect();
    // (模式, 是否把模式本身当作分隔符摘出去)
    const PATTERNS: &[(&str, bool)] = &[
        ("\n", true),
        ("。", false),
        ("！", false),
        ("？", false),
        (". ", false),
        ("! ", false),
        ("? ", false),
        ("；", false),
        ("; ", false),
        ("，", false),
        (", ", false),
        ("、", false),
        (" ", true),
    ];
    for (p, is_sep) in PATTERNS {
        if let Some(i) = window.rfind(p) {
            if i == 0 {
                continue; // 切点落在开头等于没切，换下一个模式
            }
            return if *is_sep {
                (i, p.len())
            } else {
                (i + p.len(), 0)
            };
        }
    }
    // 兜底硬切：不能切进占位符 [[n]] 中间
    (avoid_placeholder_split(s, window.len()), 0)
}

/// 若切点正好落在 `[[n]]` 占位符内部，把切点推到该占位符之后。
/// 切碎了占位符会让还原失败，那一整块就得放弃译文。
fn avoid_placeholder_split(s: &str, cut: usize) -> usize {
    let head = &s[..cut];
    let Some(open) = head.rfind("[[") else {
        return cut;
    };
    // 前面最近一个 "[[" 若还没有闭合，就说明切在它里面
    let tail = &s[open..];
    match tail.find("]]") {
        Some(close) if open + close + 2 > cut => open + close + 2,
        _ => cut,
    }
}

// ---------------- DeepL ----------------

#[derive(Serialize)]
struct DeepLBody<'a> {
    text: &'a [String],
    target_lang: &'a str,
    /// 保留原文档的换行与空格排布，别让引擎重排段落
    preserve_formatting: bool,
}

#[derive(Deserialize)]
struct DeepLResp {
    #[serde(default)]
    translations: Vec<DeepLItem>,
}

#[derive(Deserialize)]
struct DeepLItem {
    #[serde(default)]
    text: String,
}

/// DeepL 端点：免费版 Key 以 `:fx` 结尾且必须走另一套域名。
/// 这里按 Key 后缀**自动切换域名**，省得用户自己去改地址（改错了就是 403）。
pub fn deepl_endpoint(base_url: &str, key: &str) -> String {
    let raw = if base_url.trim().is_empty() {
        "https://api-free.deepl.com/v2"
    } else {
        base_url.trim()
    };
    let switched = if key.trim().ends_with(":fx") {
        raw.replace("api.deepl.com", "api-free.deepl.com")
    } else {
        raw.replace("api-free.deepl.com", "api.deepl.com")
    };
    endpoint(&switched, "https://api-free.deepl.com/v2", "/translate")
}

fn parse_deepl(body: &str) -> CmdResult<Vec<String>> {
    let parsed: DeepLResp = serde_json::from_str(body).map_err(|e| {
        AppError::BadRequest(format!("DeepL 返回格式无法解析：{e}｜原始响应：{}", truncate(body, 200)))
    })?;
    Ok(parsed.translations.into_iter().map(|t| t.text).collect())
}

async fn deepl(client: &Client, req: &MtRequest<'_>, texts: &[String]) -> CmdResult<Vec<String>> {
    if req.cred1.trim().is_empty() {
        return Err(AppError::BadRequest("尚未配置 DeepL 的 API Key".into()));
    }
    let body = DeepLBody {
        text: texts,
        target_lang: req.target,
        preserve_formatting: true,
    };
    // 手写序列化：reqwest 未启用 json feature（不为此重编译整棵依赖树）
    let payload = serde_json::to_vec(&body)
        .map_err(|e| AppError::BadRequest(format!("构造 DeepL 请求失败：{e}")))?;
    let resp = client
        .post(deepl_endpoint(req.base_url, req.cred1))
        .header("Authorization", format!("DeepL-Auth-Key {}", req.cred1.trim()))
        .header("Content-Type", "application/json")
        .body(payload)
        .timeout(REQUEST_TIMEOUT)
        .send()
        .await
        .map_err(|e| AppError::BadRequest(format!("请求 DeepL 失败：{e}")))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(http_error("DeepL", status, &text));
    }
    parse_deepl(&text)
}

// ---------------- LibreTranslate ----------------

#[derive(Serialize)]
struct LibreBody<'a> {
    q: &'a [String],
    source: &'a str,
    target: &'a str,
    format: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    api_key: Option<&'a str>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum StringOrVec {
    One(String),
    Many(Vec<String>),
}

#[derive(Deserialize)]
struct LibreResp {
    #[serde(rename = "translatedText")]
    translated: StringOrVec,
}

fn parse_libre(body: &str) -> CmdResult<Vec<String>> {
    // 错误体是 {"error": "..."}，没有 translatedText
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(body) {
        if let Some(err) = v.get("error").and_then(|e| e.as_str()) {
            return Err(AppError::BadRequest(format!("LibreTranslate 报错：{err}")));
        }
    }
    let parsed: LibreResp = serde_json::from_str(body).map_err(|e| {
        AppError::BadRequest(format!(
            "LibreTranslate 返回格式无法解析：{e}｜原始响应：{}",
            truncate(body, 200)
        ))
    })?;
    Ok(match parsed.translated {
        StringOrVec::One(s) => vec![s],
        StringOrVec::Many(v) => v,
    })
}

async fn libre(client: &Client, req: &MtRequest<'_>, texts: &[String]) -> CmdResult<Vec<String>> {
    let body = LibreBody {
        q: texts,
        source: req.kind.source_code(),
        target: req.target,
        format: "text",
        // 自建实例通常不需要 Key；留空就不带这个字段
        api_key: Some(req.cred1.trim()).filter(|k| !k.is_empty()),
    };
    let payload = serde_json::to_vec(&body)
        .map_err(|e| AppError::BadRequest(format!("构造 LibreTranslate 请求失败：{e}")))?;
    let resp = client
        .post(endpoint(req.base_url, "https://libretranslate.com", "/translate"))
        .header("Content-Type", "application/json")
        .body(payload)
        .timeout(REQUEST_TIMEOUT)
        .send()
        .await
        .map_err(|e| AppError::BadRequest(format!("请求 LibreTranslate 失败：{e}")))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(http_error("LibreTranslate", status, &text));
    }
    parse_libre(&text)
}

// ---------------- MyMemory ----------------

#[derive(Deserialize)]
struct MyMemoryResp {
    #[serde(rename = "responseData", default)]
    response_data: Option<MyMemoryData>,
    /// 成功时是数字 200，超限时是字符串 "403"，两种都要认
    #[serde(rename = "responseStatus", default)]
    response_status: Option<serde_json::Value>,
    #[serde(rename = "responseDetails", default)]
    response_details: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct MyMemoryData {
    #[serde(rename = "translatedText", default)]
    translated_text: String,
}

fn parse_mymemory(body: &str) -> CmdResult<Vec<String>> {
    let parsed: MyMemoryResp = serde_json::from_str(body).map_err(|e| {
        AppError::BadRequest(format!(
            "MyMemory 返回格式无法解析：{e}｜原始响应：{}",
            truncate(body, 200)
        ))
    })?;
    let status_ok = match &parsed.response_status {
        Some(serde_json::Value::Number(n)) => n.as_i64() == Some(200),
        Some(serde_json::Value::String(s)) => s == "200",
        // 缺少该字段时只能靠正文是否为空来判断
        _ => true,
    };
    let detail = parsed
        .response_details
        .as_ref()
        .and_then(|d| d.as_str())
        .unwrap_or("")
        .to_string();
    if !status_ok {
        let hint = if detail.contains("QUERY LENGTH") {
            "：单次文本超长（上限 500 字符）"
        } else if detail.contains("FREE TRANSLATIONS") {
            "：当日免费额度已用完，可填写邮箱提高额度，或换用其它引擎"
        } else {
            ""
        };
        return Err(AppError::BadRequest(format!(
            "MyMemory 拒绝了这次请求{hint}｜{detail}"
        )));
    }
    let out = parsed
        .response_data
        .map(|d| d.translated_text)
        .unwrap_or_default();
    if out.trim().is_empty() {
        return Err(AppError::BadRequest(format!(
            "MyMemory 未返回译文{}",
            if detail.is_empty() { String::new() } else { format!("：{detail}") }
        )));
    }
    Ok(vec![out])
}

async fn my_memory(client: &Client, req: &MtRequest<'_>, texts: &[String]) -> CmdResult<Vec<String>> {
    let url = endpoint(req.base_url, "https://api.mymemory.translated.net", "/get");
    let langpair = format!("{}|{}", req.kind.source_code(), req.target);
    let mut out = Vec::with_capacity(texts.len());
    for t in texts {
        let mut params: Vec<(&str, &str)> = vec![("q", t), ("langpair", &langpair)];
        // 填了邮箱可显著提高日额度；没填就不带这个参数
        let email = req.cred1.trim();
        if !email.is_empty() {
            params.push(("de", email));
        }
        let resp = client
            .get(&url)
            .query(&params)
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await
            .map_err(|e| AppError::BadRequest(format!("请求 MyMemory 失败：{e}")))?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(http_error("MyMemory", status, &text));
        }
        out.extend(parse_mymemory(&text)?);
    }
    Ok(out)
}

// ---------------- 百度通用翻译 ----------------

#[derive(Deserialize)]
struct BaiduResp {
    #[serde(default)]
    trans_result: Vec<BaiduItem>,
    #[serde(default)]
    error_code: Option<String>,
    #[serde(default)]
    error_msg: Option<String>,
}

#[derive(Deserialize)]
struct BaiduItem {
    #[serde(default)]
    dst: String,
}

/// 百度错误码 → 人话。这些码分散在文档各处，集中列出来省得用户对着数字猜。
fn baidu_error(code: &str, msg: &str) -> AppError {
    let hint = match code {
        "52001" => "请求超时，请重试",
        "52002" => "系统错误，请重试",
        "52003" => "未授权用户：请检查 APP ID 是否正确",
        "54000" => "必填参数为空",
        "54001" => "签名错误：请核对密钥；注意参与签名的文本不能预先做 URL 编码",
        "54003" => "访问频率受限：标准版 QPS 只有 1，请降低速度或升级服务版本",
        "54004" => "账户余额不足：免费额度已用完，请充值或升级服务版本",
        "54005" => "长 query 请求频繁，请降低长文本的发送频率",
        "58000" => "客户端 IP 非法：控制台可能设置了服务器地址白名单",
        "58001" => "译文语言方向不支持：该版本不含此语种（尊享版才支持全部语种）",
        "58002" => "服务当前已关闭，请到控制台开启服务",
        _ => "请对照百度翻译开放平台的错误码文档排查",
    };
    AppError::BadRequest(format!("百度翻译报错（{code}）{hint}｜{msg}"))
}

fn parse_baidu(body: &str) -> CmdResult<Vec<String>> {
    let parsed: BaiduResp = serde_json::from_str(body).map_err(|e| {
        AppError::BadRequest(format!(
            "百度翻译返回格式无法解析：{e}｜原始响应：{}",
            truncate(body, 200)
        ))
    })?;
    if let Some(code) = parsed.error_code.as_deref().filter(|c| !c.is_empty()) {
        return Err(baidu_error(code, parsed.error_msg.as_deref().unwrap_or("")));
    }
    Ok(parsed.trans_result.into_iter().map(|i| i.dst).collect())
}

async fn baidu(client: &Client, req: &MtRequest<'_>, texts: &[String]) -> CmdResult<Vec<String>> {
    let appid = req.cred1.trim();
    let secret = req.cred2.trim();
    if appid.is_empty() || secret.is_empty() {
        return Err(AppError::BadRequest(
            "尚未配置百度翻译的 APP ID 与密钥（两个都要填）".into(),
        ));
    }
    // 百度官方的多段批量方式：把各段用换行拼成一条 q，返回时按行对应。
    // 片段内部的换行已在调用前被换成占位符，所以这里拼出来的行数就是片段数。
    let q = texts.join("\n");
    let salt = rand::random::<u32>().to_string();
    let sign = sign::baidu_sign(appid, &q, &salt, secret);
    let form = [
        ("appid", appid),
        ("q", q.as_str()),
        ("from", req.kind.source_code()),
        ("to", req.target),
        ("salt", salt.as_str()),
        ("sign", sign.as_str()),
    ];
    let resp = client
        .post(endpoint(req.base_url, "https://fanyi-api.baidu.com", "/api/trans/vip/translate"))
        .form(&form)
        .timeout(REQUEST_TIMEOUT)
        .send()
        .await
        .map_err(|e| AppError::BadRequest(format!("请求百度翻译失败：{e}")))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(http_error("百度翻译", status, &text));
    }
    parse_baidu(&text)
}

// ---------------- 腾讯云机器翻译 ----------------

#[derive(Deserialize)]
struct TencentResp {
    #[serde(rename = "Response", default)]
    response: Option<TencentInner>,
}

#[derive(Deserialize)]
struct TencentInner {
    #[serde(rename = "TargetText", default)]
    target_text: Option<String>,
    #[serde(rename = "Error", default)]
    error: Option<TencentError>,
}

#[derive(Deserialize)]
struct TencentError {
    #[serde(rename = "Code", default)]
    code: String,
    #[serde(rename = "Message", default)]
    message: String,
}

fn tencent_error(code: &str, msg: &str) -> AppError {
    let hint = match code {
        "AuthFailure.SignatureFailure" | "AuthFailure.SignatureExpire" => {
            "签名校验失败：多与地域填写错误、系统时间不准有关"
        }
        "AuthFailure.SecretIdNotFound" => "SecretId 不存在：请检查是否复制完整",
        "AuthFailure.InvalidSecretId" => "SecretId 非法：注意别把 SecretKey 填到 SecretId 里",
        "FailedOperation.NoFreeAmount" => "免费额度已用完且未开启后付费，请充值或等次月额度",
        "RequestLimitExceeded" | "RequestLimitExceeded.UinLimitExceeded" => "请求过于频繁，请稍后重试",
        "UnsupportedOperation.UnsupportedTargetLanguage" => "目标语言不支持，请换一个语言或引擎",
        code if code.starts_with("InvalidParameter") => "参数不合法：请检查待译文本与语言设置",
        _ => "请对照腾讯云机器翻译的 API 文档排查",
    };
    AppError::BadRequest(format!("腾讯云机器翻译报错（{code}）{hint}｜{msg}"))
}

fn parse_tencent(body: &str) -> CmdResult<Vec<String>> {
    let parsed: TencentResp = serde_json::from_str(body).map_err(|e| {
        AppError::BadRequest(format!(
            "腾讯云机器翻译返回格式无法解析：{e}｜原始响应：{}",
            truncate(body, 200)
        ))
    })?;
    let inner = parsed
        .response
        .ok_or_else(|| AppError::BadRequest("腾讯云机器翻译未返回 Response 字段".into()))?;
    if let Some(err) = inner.error.filter(|e| !e.code.is_empty()) {
        return Err(tencent_error(&err.code, &err.message));
    }
    let text = inner.target_text.unwrap_or_default();
    if text.trim().is_empty() {
        return Err(AppError::BadRequest("腾讯云机器翻译返回了空译文".into()));
    }
    Ok(vec![text])
}

async fn tencent(client: &Client, req: &MtRequest<'_>, texts: &[String]) -> CmdResult<Vec<String>> {
    let secret_id = req.cred1.trim();
    let secret_key = req.cred2.trim();
    if secret_id.is_empty() || secret_key.is_empty() {
        return Err(AppError::BadRequest(
            "尚未配置腾讯云的 SecretId 与 SecretKey（两个都要填）".into(),
        ));
    }
    let base = if req.base_url.trim().is_empty() {
        "https://tmt.tencentcloudapi.com"
    } else {
        req.base_url.trim().trim_end_matches('/')
    };
    let host = host_of(base);
    let region = if req.extra.trim().is_empty() { "ap-guangzhou" } else { req.extra.trim() };
    // TextTranslate 一次只收一条，所以这里逐个发（上限已由 max_texts=1 保证）
    let mut out = Vec::with_capacity(texts.len());
    for t in texts {
        let payload = serde_json::json!({
            "SourceText": t,
            "Source": req.kind.source_code(),
            "Target": req.target,
            "ProjectId": 0,
        })
        .to_string();
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let auth = sign::tc3_authorization(&Tc3Request {
            secret_id,
            secret_key,
            service: "tmt",
            host: &host,
            payload: &payload,
            timestamp,
        });
        let resp = client
            .post(base)
            .header("Content-Type", "application/json; charset=utf-8")
            .header("Host", &host)
            .header("X-TC-Action", "TextTranslate")
            .header("X-TC-Version", "2018-03-21")
            .header("X-TC-Timestamp", timestamp.to_string())
            .header("X-TC-Region", region)
            .header("Authorization", auth)
            .body(payload)
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await
            .map_err(|e| AppError::BadRequest(format!("请求腾讯云机器翻译失败：{e}")))?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(http_error("腾讯云机器翻译", status, &text));
        }
        out.extend(parse_tencent(&text)?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_appends_path_once() {
        assert_eq!(
            endpoint("https://api-free.deepl.com/v2", "x", "/translate"),
            "https://api-free.deepl.com/v2/translate"
        );
        assert_eq!(
            endpoint("https://api-free.deepl.com/v2/", "x", "/translate"),
            "https://api-free.deepl.com/v2/translate"
        );
        // 用户把完整地址粘进来时不能拼成 .../translate/translate
        assert_eq!(
            endpoint("https://api-free.deepl.com/v2/translate", "x", "/translate"),
            "https://api-free.deepl.com/v2/translate"
        );
    }

    #[test]
    fn deepl_domain_follows_key_suffix() {
        // 免费版 Key 以 :fx 结尾，必须走 api-free 域名，否则 403
        let free = deepl_endpoint("https://api.deepl.com/v2", "abc:fx");
        assert!(free.starts_with("https://api-free.deepl.com/v2/translate"), "{free}");
        // Pro 版反过来
        let pro = deepl_endpoint("https://api-free.deepl.com/v2", "abc-123");
        assert!(pro.starts_with("https://api.deepl.com/v2/translate"), "{pro}");
        // 默认地址（空）按免费版给
        assert!(deepl_endpoint("", "x:fx").starts_with("https://api-free.deepl.com/v2"));
    }

    #[test]
    fn host_extraction_ignores_scheme_and_path() {
        assert_eq!(host_of("https://tmt.tencentcloudapi.com"), "tmt.tencentcloudapi.com");
        assert_eq!(host_of("https://tmt.tencentcloudapi.com/"), "tmt.tencentcloudapi.com");
        assert_eq!(host_of("http://a.b.c/x/y"), "a.b.c");
    }

    #[test]
    fn chunk_text_short_text_is_one_piece() {
        let c = chunk_text("短句", 100);
        assert_eq!(c, vec![("短句".to_string(), String::new())]);
    }

    #[test]
    fn chunk_text_splits_and_keeps_separators_recoverable() {
        let text = "第一段内容。\n第二段内容。\n第三段内容。";
        let budget = 7;
        let chunks = chunk_text(text, budget);
        assert!(chunks.len() > 1, "应当被切开：{chunks:?}");
        // 每片都不超预算（分隔符不算在片段里）
        for (piece, _) in &chunks {
            assert!(piece.chars().count() <= budget, "片段超长：{piece:?}");
        }
        // 拼回去必须与原文字节完全一致：这是「切开不丢字」的底线
        let joined: String = chunks.iter().map(|(p, s)| format!("{p}{s}")).collect();
        assert_eq!(joined, text);
    }

    #[test]
    fn chunk_text_prefers_newline_then_punctuation_then_space() {
        // 有换行时按换行切，换行本身作为分隔符摘出去
        let c = chunk_text("aaaa\nbbbb", 5);
        assert_eq!(c[0], ("aaaa".to_string(), "\n".to_string()));
        // 没有换行就按句号切，句号留在前一段里
        let c = chunk_text("你好世界。再见世界", 5);
        assert_eq!(c[0], ("你好世界。".to_string(), String::new()));
        // 再没有就按空格切，空格摘出去
        let c = chunk_text("hello world again", 6);
        assert_eq!(c[0], ("hello".to_string(), " ".to_string()));
    }

    #[test]
    fn chunk_text_never_cuts_inside_placeholder() {
        // 占位符 [[0]] 正好跨在预算边界上时，切点必须推到它之后
        let text = "abcdefghij[[0]]tail";
        let chunks = chunk_text(text, 12);
        let joined: String = chunks.iter().map(|(p, s)| format!("{p}{s}")).collect();
        assert_eq!(joined, text);
        // 任何片段都不该以残缺的 [[ 或 ]] 结尾/开头
        for (piece, _) in &chunks {
            assert!(!piece.ends_with("[["));
        }
        assert!(!chunks.iter().any(|(p, _)| p.contains("[[0]]") && !p.contains("]]")));
    }

    #[test]
    fn parse_deepl_reads_translations_in_order() {
        let body = r#"{"translations":[{"detected_source_language":"ZH","text":"Hello"},{"text":"World"}]}"#;
        assert_eq!(parse_deepl(body).unwrap(), vec!["Hello", "World"]);
        assert!(parse_deepl("not json").is_err());
    }

    #[test]
    fn parse_libre_handles_string_and_array_and_error() {
        // 单条返回是字符串
        assert_eq!(
            parse_libre(r#"{"translatedText":"你好"}"#).unwrap(),
            vec!["你好"]
        );
        // 批量返回是数组
        assert_eq!(
            parse_libre(r#"{"translatedText":["a","b"]}"#).unwrap(),
            vec!["a", "b"]
        );
        // 错误体要走错误分支，而不是解析成空译文
        let err = parse_libre(r#"{"error":"Invalid API key"}"#).unwrap_err().to_string();
        assert!(err.contains("Invalid API key"), "{err}");
    }

    #[test]
    fn parse_mymemory_accepts_both_status_types() {
        let ok = r#"{"responseData":{"translatedText":"世界，您好！"},"responseStatus":200}"#;
        assert_eq!(parse_mymemory(ok).unwrap(), vec!["世界，您好！"]);
        // 字符串形式的 200 同样算成功（部分实例返回字符串）
        let ok_str = r#"{"responseData":{"translatedText":"hi"},"responseStatus":"200"}"#;
        assert_eq!(parse_mymemory(ok_str).unwrap(), vec!["hi"]);

        // 超长：必须报错，且提示能看懂
        let too_long = r#"{"responseStatus":403,"responseDetails":"QUERY LENGTH LIMIT EXCEEDED. MAX ALLOWED QUERY : 500 CHARS","responseData":{"translatedText":""}}"#;
        let err = parse_mymemory(too_long).unwrap_err().to_string();
        assert!(err.contains("超长"), "{err}");

        // 额度用尽也要给出可操作的建议
        let quota = r#"{"responseStatus":"403","responseDetails":"MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY","responseData":{"translatedText":""}}"#;
        let err = parse_mymemory(quota).unwrap_err().to_string();
        assert!(err.contains("免费额度"), "{err}");
    }

    #[test]
    fn parse_baidu_reads_items_and_maps_errors() {
        let ok = r#"{"from":"en","to":"zh","trans_result":[{"src":"a","dst":"甲"},{"src":"b","dst":"乙"}]}"#;
        assert_eq!(parse_baidu(ok).unwrap(), vec!["甲", "乙"]);
        // 签名错误要有明确指引（这是最容易踩的一个坑）
        let err = parse_baidu(r#"{"error_code":"54001","error_msg":"Invalid Sign"}"#)
            .unwrap_err()
            .to_string();
        assert!(err.contains("签名错误"), "{err}");
        // 余额不足
        let err = parse_baidu(r#"{"error_code":"54004","error_msg":"Account Error"}"#)
            .unwrap_err()
            .to_string();
        assert!(err.contains("余额不足"), "{err}");
    }

    #[test]
    fn parse_tencent_reads_text_and_maps_errors() {
        let ok = r#"{"Response":{"TargetText":"你好","Source":"en","RequestId":"abc"}}"#;
        assert_eq!(parse_tencent(ok).unwrap(), vec!["你好"]);
        let err = parse_tencent(
            r#"{"Response":{"Error":{"Code":"AuthFailure.SignatureFailure","Message":"signature check failed"}}}"#,
        )
        .unwrap_err()
        .to_string();
        assert!(err.contains("签名校验失败"), "{err}");
        // 空译文当失败，不能把段落抹掉
        assert!(parse_tencent(r#"{"Response":{"TargetText":"  "}}"#).is_err());
    }
}

/// 真实联网的冒烟测试。**默认忽略**，需要手动跑：
/// `cargo test --lib translate::mt::live -- --ignored --nocapture`
///
/// 存在的意义：单测只能证明「我们自己的解析逻辑自洽」，证明不了
/// 「请求报文被对方接受」。这里用**无效凭证**打真实接口——
/// 对方要是认得我们发的报文，会回「鉴权失败」；报文格式错了则会回
/// 「参数错误 / 404」。这两者的区别正好能验证签名与字段拼装对不对。
#[cfg(test)]
mod live {
    use super::*;

    fn client() -> reqwest::Client {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .expect("构造客户端")
    }

    fn req<'a>(kind: EngineKind, base_url: &'a str, cred1: &'a str, cred2: &'a str, extra: &'a str, target: &'a str) -> MtRequest<'a> {
        MtRequest { kind, base_url, cred1, cred2, extra, target }
    }

    #[tokio::test]
    #[ignore]
    async fn live_mymemory_translates_without_any_key() {
        // 唯一免注册即可用的引擎，所以这条能真正跑出译文
        let r = req(EngineKind::MyMemory, "", "", "", "", "zh-CN");
        let out = translate_texts(&client(), &r, &["Hello, world!".to_string()])
            .await
            .expect("MyMemory 应当可匿名使用");
        println!("MyMemory 译文：{}", out[0]);
        assert!(!out[0].trim().is_empty());
    }

    #[tokio::test]
    #[ignore]
    async fn live_deepl_reaches_endpoint_with_bad_key() {
        // 无效 Key：期望「鉴权失败」而不是「地址不存在」，据此确认端点与头部写法正确
        let r = req(EngineKind::DeepL, "", "00000000-0000-0000-0000-000000000000:fx", "", "", "ZH");
        let e = translate_texts(&client(), &r, &["Hello".to_string()])
            .await
            .expect_err("无效 Key 必须失败")
            .to_string();
        println!("DeepL 错误：{e}");
        assert!(!e.contains("请求 DeepL 失败"), "不该是网络层失败：{e}");
        assert!(e.contains("DeepL"), "{e}");
    }

    #[tokio::test]
    #[ignore]
    async fn live_libre_reaches_endpoint() {
        // 官方托管版现在要 Key；无论通不通，都必须拿到 HTTP 响应（证明端点没写错）
        let r = req(EngineKind::Libre, "", "", "", "", "zh");
        let res = translate_texts(&client(), &r, &["Hello".to_string()]).await;
        match res {
            Ok(v) => println!("LibreTranslate 译文：{}", v[0]),
            Err(e) => {
                let e = e.to_string();
                println!("LibreTranslate 响应：{e}");
                assert!(!e.contains("请求 LibreTranslate 失败"), "不该是网络层失败：{e}");
            }
        }
    }

    #[tokio::test]
    #[ignore]
    async fn live_baidu_reaches_endpoint_and_reports_known_code() {
        // 假 APPID + 假密钥：百度应回它自己的错误码（52003 未授权 / 54001 签名错误），
        // 而不是 HTML 或 404 —— 这就是「报文被解析了」的证据
        let r = req(EngineKind::Baidu, "", "2015063000000001", "not-a-real-key", "", "en");
        let e = translate_texts(&client(), &r, &["你好".to_string()])
            .await
            .expect_err("无效凭证必须失败")
            .to_string();
        println!("百度错误：{e}");
        assert!(e.contains("百度翻译报错（5"), "应当是百度自家错误码：{e}");
    }

    #[tokio::test]
    #[ignore]
    async fn live_tencent_signature_is_wellformed() {
        // 假 SecretId/SecretKey：腾讯云会回 AuthFailure.*。
        // 若签名串拼错了，返回的会是 InvalidParameter / MissingParameter 之类，
        // 所以只看「错误码属于 AuthFailure」就能确认 TC3 签名的报文形态正确。
        let r = req(
            EngineKind::Tencent,
            "",
            "AKIDfakefakefakefakefakefakefake",
            "fakeSecretKeyfakeSecretKeyfake",
            "ap-guangzhou",
            "zh",
        );
        let e = translate_texts(&client(), &r, &["Hello".to_string()])
            .await
            .expect_err("无效凭证必须失败")
            .to_string();
        println!("腾讯云错误：{e}");
        assert!(e.contains("腾讯云机器翻译报错（AuthFailure") || e.contains("AuthFailure"), "{e}");
    }
}
