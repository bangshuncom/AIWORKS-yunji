// 翻译命令
use std::collections::HashMap;
use std::sync::atomic::Ordering;

use serde::Serialize;
use tauri::State;

use crate::auth::{require_admin, require_feature, require_login, FEATURE_TRANSLATE};
use crate::error::{AppError, CmdResult};
use crate::state::AppState;
use crate::translate::{self, TranslateResult};

// ---- 给前端的视图结构 ----

#[derive(Serialize)]
pub struct LanguageOption {
    pub code: String,
    pub name: String,
}

/// 翻译选项（所有登录用户）：编辑页的语言下拉与按钮可用性
#[derive(Serialize)]
pub struct TranslateOptions {
    pub languages: Vec<LanguageOption>,
    /// 设置里的默认目标语言
    pub target_lang: String,
    /// 是否已配置好。未配置时前端直接禁用翻译按钮，不必等点了才报错。
    pub configured: bool,
}

/// 服务商在界面上的完整规格。前端**通用渲染**这张表：加新引擎只改后端，前端不用动。
#[derive(Serialize)]
pub struct ProviderView {
    pub id: String,
    pub name: String,
    /// 引擎协议类型（llm / deep_l / libre / my_memory / baidu / tencent）
    pub kind: translate::engine::EngineKind,
    /// 分组标签：大模型 / 机器翻译
    pub kind_label: String,
    pub base_url: String,
    pub default_model: String,
    pub note: String,
    /// 是否要填模型名（同时决定要不要显示「获取模型列表」与「每批最大字数」）
    pub uses_model: bool,
    /// 接口地址是否可编辑：机翻的域名是厂商固定的，不该让用户去填
    pub base_url_editable: bool,
    /// 第一个凭证的字段规格（标签 / 占位符 / 说明都随引擎变）
    pub cred1: translate::engine::FieldSpec,
    /// 第二个凭证（只有百度、腾讯有）
    pub cred2: Option<translate::engine::FieldSpec>,
    /// 附加参数（只有腾讯有：地域）
    pub extra: Option<translate::engine::FieldSpec>,
    /// 附加参数的默认值，切换服务商时预填
    pub extra_default: String,
}

/// 翻译配置（仅管理员）：服务商模板 + 当前值。**不含任何密钥明文。**
#[derive(Serialize)]
pub struct TranslateConfigView {
    pub providers: Vec<ProviderView>,
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub target_lang: String,
    pub has_api_key: bool,
    /// 第一个凭证的末 4 位：让管理员确认自己填的是哪一把
    pub api_key_tail: String,
    /// 第二个凭证（百度的密钥 / 腾讯的 SecretKey）是否已配置 + 末 4 位
    pub has_api_key2: bool,
    pub api_key2_tail: String,
    /// 附加参数当前值（腾讯的地域）
    pub extra: String,
    /// 每批最大字数：把一段文章切成几批发，批越大越快（仅大模型通道使用）
    pub batch_chars: usize,
    /// 允许范围与默认值一并下发，前端不必硬编码 —— 改后端常量就能同步到界面
    pub batch_chars_min: usize,
    pub batch_chars_max: usize,
    pub batch_chars_default: usize,
    /// 已存有第一个凭证的服务商 id：切换服务商时前端据此提示「已保存，留空即不修改」
    pub providers_with_key: Vec<String>,
    /// 已存有第二个凭证的服务商 id
    pub providers_with_key2: Vec<String>,
    /// 各服务商已保存的接口地址（键为 provider id）：切换时恢复自己的值而不是模板默认
    pub saved_base_urls: HashMap<String, String>,
    /// 各服务商已保存的模型名（键为 provider id）
    pub saved_models: HashMap<String, String>,
    /// 各服务商已保存的附加参数（键为 provider id）
    pub saved_extras: HashMap<String, String>,
}

/// 翻译一段 Markdown 文本（需 perm_translate 权限，默认所有登录用户）
///
/// **入参白名单**：只接受正文与目标语言。
/// 接口地址、模型名、API Key 一律由后端从设置读取——前端无权指定，
/// 否则登录用户就能把本应用当作任意 LLM 代理使用，刷掉管理员的额度。
#[tauri::command]
pub async fn translate_text(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    text: String,
    target_lang: Option<String>,
) -> CmdResult<TranslateResult> {
    require_feature(&state.db, &state.auth, FEATURE_TRANSLATE).await?;
    // 开始前清掉上一次遗留的取消标志
    state.translate_cancel.store(false, Ordering::Relaxed);
    let ctx = translate::TranslateCtx {
        pool: &state.db,
        cancel: state.translate_cancel.as_ref(),
        app: Some(&app),
    };
    translate::translate_text(&ctx, &text, target_lang.as_deref()).await
}

/// 取消正在进行的翻译。已翻好的部分会保留，剩余段落保持原文。
#[tauri::command]
pub async fn translate_cancel(state: State<'_, AppState>) -> CmdResult<()> {
    require_login(&state.auth).await?;
    state.translate_cancel.store(true, Ordering::Relaxed);
    Ok(())
}

/// 翻译选项（所有登录用户）：语言列表 + 默认目标语言 + 是否已配置
#[tauri::command]
pub async fn translate_options(state: State<'_, AppState>) -> CmdResult<TranslateOptions> {
    require_login(&state.auth).await?;
    Ok(TranslateOptions {
        languages: translate::prompt::LANGUAGES
            .iter()
            .map(|(c, n)| LanguageOption { code: (*c).to_string(), name: (*n).to_string() })
            .collect(),
        target_lang: translate::target_lang_default(&state.db).await?,
        configured: translate::is_configured(&state.db).await?,
    })
}

/// 读取翻译配置（仅管理员）。密钥只返回「是否已配置 + 末 4 位」，不下发明文。
#[tauri::command]
pub async fn get_translate_config(state: State<'_, AppState>) -> CmdResult<TranslateConfigView> {
    let _ = require_admin(&state.auth).await?;
    let db = &state.db;
    // 服务商与凭证同源：展示的「是否已配置 / 末 4 位」始终是**当前服务商**那一套
    let provider = translate::setting(db, "translate_provider").await?;
    let cred1 = translate::provider_setting_value(db, "api_key", &provider).await?;
    let cred2 = translate::provider_setting_value(db, "api_key2", &provider).await?;
    // 先读进局部变量：struct 字面量会 move 掉 provider，之后再借会用不了
    let base_url = translate::provider_setting_value(db, "base_url", &provider).await?;
    let model = translate::provider_setting_value(db, "model", &provider).await?;
    let extra = translate::provider_setting_value(db, "extra", &provider).await?;
    Ok(TranslateConfigView {
        providers: translate::client::PROVIDERS
            .iter()
            .map(|p| {
                let (cred1, cred2) = translate::engine::cred_fields(p.kind);
                ProviderView {
                    id: p.id.to_string(),
                    name: p.name.to_string(),
                    kind: p.kind,
                    kind_label: p.kind.label().to_string(),
                    base_url: p.base_url.to_string(),
                    default_model: p.default_model.to_string(),
                    note: p.note.to_string(),
                    uses_model: p.kind.uses_model(),
                    base_url_editable: p.kind.base_url_editable(),
                    cred1,
                    cred2,
                    extra: translate::engine::extra_field(p.kind),
                    extra_default: translate::engine::extra_default(p.kind).to_string(),
                }
            })
            .collect(),
        provider,
        base_url,
        model,
        target_lang: translate::target_lang_default(db).await?,
        has_api_key: !cred1.trim().is_empty(),
        api_key_tail: tail_of(&cred1),
        has_api_key2: !cred2.trim().is_empty(),
        api_key2_tail: tail_of(&cred2),
        extra,
        batch_chars: translate::parse_batch_chars(
            &translate::setting(db, "translate_batch_chars").await?,
        ),
        batch_chars_min: translate::MIN_BATCH_CHARS,
        batch_chars_max: translate::MAX_BATCH_CHARS,
        batch_chars_default: translate::DEFAULT_BATCH_CHARS,
        providers_with_key: translate::providers_with_key(db).await?,
        providers_with_key2: translate::saved_per_provider(db, "api_key2")
            .await?
            .into_keys()
            .collect(),
        saved_base_urls: translate::saved_per_provider(db, "base_url").await?,
        saved_models: translate::saved_per_provider(db, "model").await?,
        saved_extras: translate::saved_per_provider(db, "extra").await?,
    })
}

/// 取密钥末 4 位用于界面提示（空值返回空串）。只给尾号，不给明文。
fn tail_of(secret: &str) -> String {
    let chars: Vec<char> = secret.chars().collect();
    chars[chars.len().saturating_sub(4)..].iter().collect()
}

/// 测试翻译接口连通性（仅管理员）。返回一句示范译文，便于确认凭证 / 地址 / 模型是否正确。
///
/// 走的是真实翻译通道（含签名与语言码转换），所以测通了基本就等于正式翻译能通。
#[tauri::command]
pub async fn translate_test(state: State<'_, AppState>) -> CmdResult<String> {
    require_admin(&state.auth).await?;
    let cfg = translate::load_config(&state.db).await?;
    translate::test_connection(&state.db).await.map_err(|e| {
        // 失败时把「本次实际使用的接口与引擎/模型」一并回显。
        // 数据目录跟随 exe 路径，同一程序放在不同位置就是两套配置；
        // 不回显的话用户无法判断报错来自哪一份，容易误判成「这个路径连不上」。
        let detail = if cfg.kind == translate::engine::EngineKind::Llm {
            format!("本次使用的接口：{}（模型 {}）", cfg.base_url, cfg.model)
        } else {
            format!("本次使用的接口：{}（引擎：{}）", cfg.base_url, cfg.kind.label())
        };
        AppError::BadRequest(format!("{e}｜{detail}"))
    })
}

/// 拉取某服务商的可用模型列表（仅管理员），用于设置页的「模型名」下拉。
///
/// 安全边界与翻译调用一致：**地址与凭证只从库里的分桶设置读取**，
/// 前端只指定"哪个服务商"，不能借这个命令向任意地址发请求。
/// 刚改过的地址 / 凭证要先保存才能生效（前端流程会自动先落库再拉）。
#[tauri::command]
pub async fn translate_fetch_models(
    state: State<'_, AppState>,
    provider: String,
) -> CmdResult<Vec<String>> {
    require_admin(&state.auth).await?;
    let template = translate::engine::template_of(&provider);
    let kind = translate::engine::kind_of(&provider);
    let name = template.map(|t| t.name).unwrap_or("该服务商");
    // 机器翻译引擎没有「模型」这个概念，拉列表只会得到一个含糊的 404
    if !kind.uses_model() {
        return Err(AppError::BadRequest(format!(
            "{name} 是机器翻译引擎，没有「模型名」这一项，不需要拉取模型列表"
        )));
    }
    let base_url = translate::provider_setting_value(&state.db, "base_url", &provider)
        .await?
        .trim()
        .to_string();
    // 地址没存过时回落到模板默认（否则自定义之外的服务商在未保存前无法拉取）
    let base_url = if base_url.is_empty() {
        template.map(|t| t.base_url.to_string()).unwrap_or_default()
    } else {
        base_url
    };
    let api_key = translate::provider_setting_value(&state.db, "api_key", &provider).await?;
    // 没配 Key 时给出带服务商名的提示：/models 是要鉴权的接口，
    // 不提前拦的话用户容易把「没填 Key」误判成「这个服务商连不上」。
    if api_key.trim().is_empty() {
        return Err(AppError::BadRequest(format!(
            "还没有配置{name}的 API Key：拉取模型列表需要用它鉴权。\
             请先在下方填写 Key，再点「获取模型列表」（会自动保存）"
        )));
    }
    let client = crate::collector::http::http_client().await;
    translate::client::list_models(&client, &base_url, &api_key).await
}
