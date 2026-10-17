// OpenAI 兼容的翻译请求客户端
//
// 智谱 / DeepSeek / 硅基流动 / 火山方舟 / 阿里百炼 / 百度千帆 / Kimi 乃至本地 Ollama
// 全都实现 OpenAI 的 /chat/completions 协议，所以这里**只有一份实现**。
// 设置里的「服务商」只是一个 base_url 预填模板，不改变代码路径。
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, CmdResult};

/// 单次翻译请求超时。
///
/// 给得比较宽松：翻译是纯生成任务，一批几百上千字要逐 token 吐出来，
/// 免费模型更慢。这个值同时也是「每批字数」能开多大的天花板——
/// 批再大也没用，模型没生成完就被这里掐断了。
const REQUEST_TIMEOUT: Duration = Duration::from_secs(300);

// 服务商模板表移到 `engine`（那里同时定义了协议类型与界面字段规格），
// 这里 re-export 一次，让既有的 `translate::client::PROVIDERS` 引用继续保持可用。
pub use super::engine::PROVIDERS;

#[derive(Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: Vec<ChatMessage<'a>>,
    /// 翻译要可复现，温度取低值
    temperature: f32,
    stream: bool,
}

#[derive(Serialize)]
struct ChatMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct ChatResponse {
    #[serde(default)]
    choices: Vec<ChatChoice>,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: ChatChoiceMessage,
    /// "stop" = 正常结束；"length" = 撞到输出上限被截断（必须检测，否则半句译文会污染正文）
    #[serde(default)]
    finish_reason: Option<String>,
}

#[derive(Deserialize)]
struct ChatChoiceMessage {
    /// 部分实现在某些情况下会返回 null，用 Option 兜住
    content: Option<String>,
}

/// 归一化 base_url → chat/completions 端点。
/// 兼容用户填 `https://x/v1`、`https://x/v1/`，或直接填到 `.../chat/completions`。
fn chat_endpoint(base_url: &str) -> String {
    let b = base_url.trim().trim_end_matches('/');
    if b.ends_with("/chat/completions") {
        b.to_string()
    } else {
        format!("{b}/chat/completions")
    }
}

/// 归一化 base_url → models 端点（模型列表），拼接规则与 `chat_endpoint` 同源
fn models_endpoint(base_url: &str) -> String {
    let mut b = base_url.trim().trim_end_matches('/').to_string();
    if b.ends_with("/chat/completions") {
        b.truncate(b.len() - "/chat/completions".len());
    }
    format!("{b}/models")
}

/// 拉取 OpenAI 兼容的模型列表（GET /models）。
///
/// 模型名靠手抄很容易抄错（`deepseek-flash` 就是这么混进来的），
/// 服务商自己维护的列表才是权威来源。个别服务商没有该接口（返回 404），
/// 调用方应降级为手填，而不是卡死。
pub async fn list_models(
    client: &reqwest::Client,
    base_url: &str,
    api_key: &str,
) -> CmdResult<Vec<String>> {
    if base_url.trim().is_empty() {
        return Err(AppError::BadRequest(
            "尚未配置翻译接口地址，请先保存设置再获取模型列表".into(),
        ));
    }
    if api_key.trim().is_empty() {
        return Err(AppError::BadRequest(
            "尚未配置 API Key，请先保存 Key 再获取模型列表".into(),
        ));
    }
    // 列表是个轻量请求，不用聊天生成那种 300 秒长超时
    let resp = client
        .get(models_endpoint(base_url))
        .header("Authorization", format!("Bearer {}", api_key.trim()))
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|e| AppError::BadRequest(format!("请求模型列表失败：{e}")))?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        let mut msg = format!("HTTP {status}：{}", truncate(&text, 200));
        if status.as_u16() == 404 {
            msg.push_str("（该服务商可能不提供模型列表接口，请手动填写模型名）");
        }
        return Err(AppError::BadRequest(msg));
    }
    parse_models(&text)
}

/// 解析 /models 的响应体（`{"data":[{"id":"..."}]}`），按字母序去重。
/// 缺 `data` 字段按空列表处理——有些服务商只返回兼容子集，别因此整个失败。
fn parse_models(raw: &str) -> CmdResult<Vec<String>> {
    #[derive(serde::Deserialize)]
    struct Entry {
        id: String,
    }
    #[derive(serde::Deserialize)]
    struct Resp {
        #[serde(default)]
        data: Vec<Entry>,
    }
    let parsed: Resp = serde_json::from_str(raw).map_err(|e| {
        AppError::BadRequest(format!(
            "模型列表返回格式无法解析：{e}（原文：{}）",
            truncate(raw, 200)
        ))
    })?;
    let mut ids: Vec<String> = parsed.data.into_iter().map(|m| m.id).collect();
    ids.sort();
    ids.dedup();
    Ok(ids)
}

/// 调用翻译接口时的错误。
///
/// 分两类是**为了让批量翻译知道值不值得降级**：
/// 撞到输出上限时，把这一批拆成单段重发是有意义的；
/// 而网络、鉴权、地址错误重发多少遍都一样，只会白等。
#[derive(Debug)]
pub enum ChatError {
    /// 输出撞上长度上限，译文只有半截（拆短重发有意义）
    Truncated(String),
    /// 其它：网络、HTTP 状态、响应格式、空内容（重发无意义）
    Fatal(String),
}

impl std::fmt::Display for ChatError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ChatError::Truncated(m) | ChatError::Fatal(m) => f.write_str(m),
        }
    }
}

impl From<ChatError> for AppError {
    fn from(e: ChatError) -> Self {
        AppError::BadRequest(e.to_string())
    }
}

/// 调一次 OpenAI 兼容的 chat/completions，返回助手回复的纯文本
pub async fn chat_completion(
    client: &reqwest::Client,
    base_url: &str,
    api_key: &str,
    model: &str,
    system: &str,
    user: &str,
) -> Result<String, ChatError> {
    if base_url.trim().is_empty() {
        return Err(ChatError::Fatal("未配置翻译接口地址".into()));
    }
    if model.trim().is_empty() {
        return Err(ChatError::Fatal("未配置翻译模型名".into()));
    }
    let body = ChatRequest {
        model,
        messages: vec![
            ChatMessage { role: "system", content: system },
            ChatMessage { role: "user", content: user },
        ],
        temperature: 0.2,
        stream: false,
    };
    // 手动序列化：reqwest 未启用 json feature（只有采集在用 reqwest，不为此重编译依赖树）
    let payload = serde_json::to_vec(&body)
        .map_err(|e| ChatError::Fatal(format!("构造翻译请求失败：{e}")))?;
    let resp = client
        .post(chat_endpoint(base_url))
        .header("Authorization", format!("Bearer {}", api_key.trim()))
        .header("Content-Type", "application/json")
        .timeout(REQUEST_TIMEOUT)
        .body(payload)
        .send()
        .await
        .map_err(|e| ChatError::Fatal(format!("请求翻译接口失败：{e}")))?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(ChatError::Fatal(http_error_message(status.as_u16(), &text)));
    }
    let parsed: ChatResponse = serde_json::from_str(&text).map_err(|e| {
        ChatError::Fatal(format!(
            "翻译接口返回格式无法解析：{e}（原文：{}）",
            truncate(&text, 200)
        ))
    })?;
    let choice = parsed
        .choices
        .into_iter()
        .next()
        .ok_or_else(|| ChatError::Fatal("翻译接口未返回任何结果".into()))?;
    // 撞到输出上限 = 译文只有半截。标记成 Truncated，让批量翻译把这一批拆成单段重发。
    if choice.finish_reason.as_deref() == Some("length") {
        return Err(ChatError::Truncated(
            "译文超出模型的单次输出长度上限：请在「应用设置 → 翻译」把「每批最大字数」调小\
             （或换一个最大输出更大的模型）；若是单段本身过长，请把该段正文拆短后再翻译。"
                .into(),
        ));
    }
    let out = choice.message.content.unwrap_or_default().trim().to_string();
    if out.is_empty() {
        return Err(ChatError::Fatal("翻译接口未返回译文内容".into()));
    }
    Ok(out)
}

/// 把 HTTP 错误翻译成管理员能直接照做的提示
fn http_error_message(status: u16, body: &str) -> String {
    let hint = match status {
        400 => "请求被服务端拒绝：通常是模型名不存在或参数不受支持，请检查「应用设置 → 翻译」的模型名",
        401 | 403 => "API Key 无效或无权限，请让管理员检查「应用设置 → 翻译」",
        // DeepSeek 等预付费平台欠费时返回 402，提示语与「网络不通」极易混淆，这里必须说清
        402 => "账户余额不足或未开通付费：请到该服务商控制台充值，或改用免费模型（如智谱 GLM-4-Flash）",
        404 => "接口地址或模型名不存在，请检查「应用设置 → 翻译」",
        429 => "请求过于频繁（免费额度限流），请稍后重试",
        500..=599 => "翻译服务暂时不可用，请稍后重试",
        _ => "翻译请求被拒绝",
    };
    format!("{hint}（HTTP {status}）：{}", truncate(body, 200))
}

/// 截断长文本用于错误提示（按字符而非字节，避免切碎 UTF-8）
fn truncate(s: &str, max: usize) -> String {
    let t = s.trim();
    if t.chars().count() <= max {
        t.to_string()
    } else {
        format!("{}…", t.chars().take(max).collect::<String>())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::translate::engine::EngineKind;

    #[test]
    fn models_endpoint_variants() {
        assert_eq!(
            models_endpoint("https://api.deepseek.com/v1"),
            "https://api.deepseek.com/v1/models"
        );
        // 尾斜杠与已填到 chat 端点的写法都要能拼对
        assert_eq!(
            models_endpoint("https://open.bigmodel.cn/api/paas/v4/"),
            "https://open.bigmodel.cn/api/paas/v4/models"
        );
        assert_eq!(models_endpoint("https://x/v1/chat/completions"), "https://x/v1/models");
    }

    #[test]
    fn parse_models_sorts_dedups_and_tolerates_missing_data() {
        let raw = r#"{"object":"list","data":[{"id":"b"},{"id":"a"},{"id":"b"}]}"#;
        assert_eq!(parse_models(raw).unwrap(), vec!["a".to_string(), "b".to_string()]);
        // 缺 data 字段 = 空列表，而不是整个失败
        assert!(parse_models("{}").unwrap().is_empty());
        // 结构完全不对才报错（让调用方看到原始响应片段）
        let err = parse_models("not json").unwrap_err().to_string();
        assert!(err.contains("无法解析"));
    }

    #[test]
    fn endpoint_normalization() {
        assert_eq!(
            chat_endpoint("https://api.deepseek.com/v1"),
            "https://api.deepseek.com/v1/chat/completions"
        );
        assert_eq!(
            chat_endpoint("https://open.bigmodel.cn/api/paas/v4/"),
            "https://open.bigmodel.cn/api/paas/v4/chat/completions"
        );
        // 已经填到完整端点时不重复拼接
        assert_eq!(
            chat_endpoint("https://x/v1/chat/completions"),
            "https://x/v1/chat/completions"
        );
    }

    #[test]
    fn truncate_by_chars() {
        assert_eq!(truncate("abc", 5), "abc");
        assert_eq!(truncate("abcdefg", 3), "abc…");
        // 中文按字符截断，不会切碎
        assert_eq!(truncate("你好世界啊", 2), "你好…");
    }

    #[test]
    fn http_hints_are_actionable() {
        // 402 = 欠费。这条提示必须点名「余额」，否则会被误当成网络不通。
        let m = http_error_message(402, r#"{"error":{"message":"Insufficient Balance"}}"#);
        assert!(m.contains("余额不足"), "{m}");
        assert!(m.contains("402"));
        // 401 / 400 / 429 也要各自给出可照做的提示
        assert!(http_error_message(401, "").contains("API Key"));
        assert!(http_error_message(400, "").contains("模型名"));
        assert!(http_error_message(429, "").contains("限流"));
        // 未知状态码兜底，且始终带上原始响应体便于排查
        let m = http_error_message(418, "teapot");
        assert!(m.contains("翻译请求被拒绝") && m.contains("teapot"));
    }

    /// 模板是给用户"填上就能用"的起点，字段缺一不可；
    /// 同时防止手滑把某个 id 写重（下拉会串项）。
    #[test]
    fn provider_templates_are_sane() {
        let mut ids: Vec<&str> = PROVIDERS.iter().map(|p| p.id).collect();
        let n = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), n, "服务商 id 不能重复");
        assert!(PROVIDERS.iter().any(|p| p.id == "custom"), "必须保留自定义项");
        for p in PROVIDERS {
            assert!(!p.name.is_empty(), "{} 缺少显示名", p.id);
            assert!(!p.note.is_empty(), "{} 缺少提示语", p.id);
            if p.id == "custom" {
                // 自定义项由用户填，留空是有意的
                continue;
            }
            assert!(p.base_url.starts_with("https://"), "{} 的 base_url 必须是 https", p.id);
            // 只有大模型服务商走 chat/completions 协议，也才需要默认模型名；
            // 机器翻译那几家是另一条通道（见 translate::engine / translate::mt）
            if p.kind != EngineKind::Llm {
                continue;
            }
            assert!(!p.default_model.is_empty(), "{} 缺少默认模型名", p.id);
            // 接口地址能正常拼出端点，说明没写成完整端点或漏了路径
            assert!(
                chat_endpoint(p.base_url).ends_with("/chat/completions"),
                "{} 的 base_url 无法拼出端点",
                p.id
            );
        }
    }
}
