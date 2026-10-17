// 翻译模块：统一入口
//
// 两条通道，按服务商的引擎类型分派（见 `engine.rs`）：
//   · 大模型（OpenAI 兼容）：可下指令，用段落标记协议合并多段，Markdown 结构保得最好；
//   · 机器翻译（DeepL / LibreTranslate / MyMemory / 百度 / 腾讯云）：不能下指令，
//     靠本地切块 + 占位符保结构，免费额度通常大得多。
// 两条通道对上层是同一个 `translate_text`，失败隔离与进度语义完全一致。
//
// 设计要点（安全相关，改动前请先读）：
//   · 接口地址 / 模型名 / 密钥 **只从服务端设置读取**，前端无权指定。
//     否则任何登录用户都能把本应用当作任意代理使用，刷掉管理员的额度。
//   · 密钥存于 settings 表，而该表只有 `get_settings`（管理员专属）能整表读出，
//     普通用户走的 `get_public_settings` 是白名单制——**不要把密钥键加进白名单**。
//     密钥按服务商分桶存放（`translate_api_key_<provider>` / `translate_api_key2_<provider>`），
//     下发前一律按前缀剔除。
pub mod client;
pub mod engine;
pub mod md;
pub mod mt;
pub mod prompt;
pub mod sign;

use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use sqlx::SqlitePool;
use tauri::Emitter;

use crate::db::repository;
use crate::error::{AppError, CmdResult};

/// 单次翻译的字符上限（后端兜底；前端正常按段提交，远小于此值）
pub const MAX_TEXT_CHARS: usize = 20_000;

/// 翻译过程中的运行时上下文
pub struct TranslateCtx<'a> {
    pub pool: &'a SqlitePool,
    /// 取消标志：每翻完一块检查一次
    pub cancel: &'a AtomicBool,
    /// 用于推送进度事件（None 则不推，便于测试）
    pub app: Option<&'a tauri::AppHandle>,
}

/// 进度事件负载（事件名 translate-progress）
#[derive(Clone, Serialize)]
struct TranslateProgress {
    done: usize,
    total: usize,
}

/// 翻译配置（管理员在「应用设置 → 翻译」里维护）
///
/// 机翻引擎与大模型的字段并不一一对应：机翻没有模型名，反而可能要第二个凭证。
/// 这里统一按引擎归一化，调用方只需看 `kind`。
pub struct TranslateConfig {
    pub kind: engine::EngineKind,
    pub base_url: String,
    /// 第一个凭证：API Key / APP ID / SecretId / 邮箱
    pub cred1: String,
    /// 第二个凭证：百度的密钥 / 腾讯的 SecretKey；其余引擎为空串
    pub cred2: String,
    /// 附加参数：腾讯的地域；其余引擎为空串
    pub extra: String,
    /// 大模型专用：模型名
    pub model: String,
    /// 应用内语言码（zh / zh-Hant / ja …）
    pub target_lang: String,
    /// 引擎原生语言码（已按引擎转换，如日语的 jp / ja / JA）
    pub target_code: String,
    /// 语言中文名，大模型的提示词里要用
    pub target_name: String,
    /// 每批最大字数（仅大模型通道使用，见 `DEFAULT_BATCH_CHARS` 的说明）
    pub batch_chars: usize,
}

/// 一条通道跑完的结果
struct PassOutcome {
    /// 按块下标记录译文；None = 没翻成（失败或没来得及），拼装时回退原文
    translated: Vec<Option<String>>,
    /// 失败的块数
    failed: usize,
    /// 第一条错误信息，供前端提示
    error: Option<String>,
    cancelled: bool,
}

/// 一次翻译的结果
#[derive(Serialize)]
pub struct TranslateResult {
    pub text: String,
    /// 未能翻译的块数（这些块保留了原文）
    pub failed_blocks: usize,
    /// 第一条错误信息，供前端提示
    pub error: Option<String>,
    /// 是否被用户中途取消（已翻好的部分仍然返回）
    pub cancelled: bool,
}

/// 翻译 API Key 的设置键前缀：**每个服务商各存一把**。
///
/// 原先只有一把全局 key，换个服务商就得把 key 重新粘一遍，切回来还要再粘一次。
/// 现在按服务商分桶存放，切换时只要这个桶里有值就直接可用，无需重输。
pub const API_KEY_PREFIX: &str = "translate_api_key_";

/// provider 为空（老数据或尚未初始化）时归入的桶名，
/// 避免键名退化成一个光秃秃的 `translate_api_key_`
const PROVIDER_DEFAULT_BUCKET: &str = "default";

/// 旧版遗留的全局 Key 键名，只用于一次性迁移，见 `migrate_legacy_settings_to_provider`
pub const LEGACY_API_KEY: &str = "translate_api_key";

/// 服务商维度的设置键：`translate_<item>_<provider>`。
///
/// Key、接口地址、模型名都按服务商分桶（切换服务商不丢各自的配置）；
/// provider 为空时归入 `default` 桶。前端保存时拼的键名必须与这里一致。
pub fn provider_setting(item: &str, provider: &str) -> String {
    let p = provider.trim();
    format!(
        "translate_{item}_{}",
        if p.is_empty() { PROVIDER_DEFAULT_BUCKET } else { p }
    )
}

/// 某个服务商对应的 API Key 设置键
pub fn api_key_setting(provider: &str) -> String {
    provider_setting("api_key", provider)
}

/// 存放密钥的设置键前缀。下发设置给前端前**必须**逐个剔除，
/// 漏掉任何一个就是把明文密钥交给前端。
///
/// `translate_api_key_<p>` 是第一个凭证（API Key / APP ID / SecretId / 邮箱），
/// `translate_api_key2_<p>` 是第二个凭证（百度的密钥 / 腾讯的 SecretKey）。
/// 注意两者不是「前缀包含」关系（`key2_` 不等于 `key_`），所以必须列全。
const SECRET_PREFIXES: [&str; 2] = [API_KEY_PREFIX, "translate_api_key2_"];

/// 是否是「存放密钥的键」（含旧版遗留键）。
pub fn is_api_key_setting(key: &str) -> bool {
    key == LEGACY_API_KEY || SECRET_PREFIXES.iter().any(|p| key.starts_with(p))
}

/// 读取服务商维度的设置：先读该服务商的桶，桶为空时回落到旧的全局键。
///
/// 回落是给「迁移没跑成 / 手改数据库」兜底——迁移**保留全局键不清除**，
/// 所以即使迁移没执行，读到的仍是升级前的旧值，行为与旧版一致。
/// （Key 例外：迁移成功后旧键已删，回落自然落空，属于防御性冗余。）
pub async fn provider_setting_value(
    pool: &SqlitePool,
    item: &str,
    provider: &str,
) -> CmdResult<String> {
    let bucketed = setting(pool, &provider_setting(item, provider)).await?;
    if !bucketed.trim().is_empty() {
        return Ok(bucketed);
    }
    setting(pool, &format!("translate_{item}")).await
}

/// 已按服务商保存的某项设置（键为 provider id，值为空的桶不算）。
///
/// 前端切换服务商时据此恢复该服务商自己的值；没有的才回落到模板默认。
pub async fn saved_per_provider(
    pool: &SqlitePool,
    item: &str,
) -> CmdResult<std::collections::HashMap<String, String>> {
    let all = repository::settings::get_all(pool).await?;
    let prefix = format!("translate_{item}_");
    Ok(all
        .into_iter()
        .filter(|(k, v)| k.starts_with(&prefix) && !v.trim().is_empty())
        .map(|(k, v)| (k[prefix.len()..].to_string(), v))
        .collect())
}

/// 已存有 Key 的服务商 id 列表（值为空的桶不算）。
/// 前端切到某个服务商时据此提示「已保存，留空即不修改」。
pub async fn providers_with_key(pool: &SqlitePool) -> CmdResult<Vec<String>> {
    let mut ids: Vec<String> = saved_per_provider(pool, "api_key").await?.into_keys().collect();
    ids.sort();
    Ok(ids)
}

/// 把旧版的全局设置（Key / 接口地址 / 模型名）迁到「当前选中的服务商」名下。幂等。
///
/// 少了这一步，升级后分桶读取会读不到旧值，用户会以为配置丢了。
/// Key 迁移后**删除旧键**（明文敏感，少一条读取路径）；
/// base_url / model 保留全局键——读取侧桶空时会回落全局键，保留它们能让
/// 「迁移失败」的场景也维持旧行为。
pub async fn migrate_legacy_settings_to_provider(pool: &SqlitePool) -> CmdResult<()> {
    let provider = setting(pool, "translate_provider").await?;
    // 1) Key：搬迁并清掉旧键
    let legacy_key = setting(pool, LEGACY_API_KEY).await?;
    if !legacy_key.trim().is_empty() {
        let target = api_key_setting(&provider);
        // 目标桶已有值时不覆盖：用户可能已经在新界面里填过了
        if setting(pool, &target).await?.trim().is_empty() {
            repository::settings::set(pool, &target, legacy_key.trim()).await?;
        }
        repository::settings::delete(pool, LEGACY_API_KEY).await?;
    }
    // 2) 接口地址 / 模型名：固化到当前服务商的桶（全局键保留作读取回落）
    for item in ["base_url", "model"] {
        let legacy = setting(pool, &format!("translate_{item}")).await?;
        if legacy.trim().is_empty() {
            continue;
        }
        let target = provider_setting(item, &provider);
        if setting(pool, &target).await?.trim().is_empty() {
            repository::settings::set(pool, &target, legacy.trim()).await?;
        }
    }
    Ok(())
}

/// 读取单个翻译设置项（缺省为空串）
pub async fn setting(pool: &SqlitePool, key: &str) -> CmdResult<String> {
    Ok(crate::db::repository::settings::get(pool, key)
        .await?
        .unwrap_or_default())
}

/// 默认目标语言（未设置时回落简体中文）
pub async fn target_lang_default(pool: &SqlitePool) -> CmdResult<String> {
    let v = setting(pool, "translate_target_lang").await?;
    Ok(if v.trim().is_empty() { "zh".to_string() } else { v })
}

/// 配置是否完整（用于前端提前禁用按钮，而不是点了才报错）
///
/// 直接复用 `load_config` 的校验结果：两边各写一套判断，迟早会走偏
/// （比如新加的引擎只在一处补了判断）。
pub async fn is_configured(pool: &SqlitePool) -> CmdResult<bool> {
    Ok(load_config(pool).await.is_ok())
}

/// 读取并校验翻译配置。
///
/// 校验是**按引擎**做的：不同引擎要求的字段不同（机翻没有模型名，
/// 百度/腾讯要两个凭证，MyMemory 什么都不用填就能用）。
pub async fn load_config(pool: &SqlitePool) -> CmdResult<TranslateConfig> {
    let provider = setting(pool, "translate_provider").await?;
    let kind = engine::kind_of(&provider);
    let template = engine::template_of(&provider);
    let name = template.map(|t| t.name).unwrap_or("自定义服务商");

    // 接口地址：桶里有就用桶里的，否则回落到模板默认。
    // 这一步回落是**必须**的而不是锦上添花：机翻的域名是厂商固定的，
    // 界面上根本不露输入框，用户不可能去填它。
    let saved_base = provider_setting_value(pool, "base_url", &provider).await?;
    let base_url = if saved_base.trim().is_empty() {
        template.map(|t| t.base_url.to_string()).unwrap_or_default()
    } else {
        saved_base
    };
    // 其余字段都按服务商分桶取
    let cred1 = provider_setting_value(pool, "api_key", &provider).await?;
    let cred2 = provider_setting_value(pool, "api_key2", &provider).await?;
    let extra = provider_setting_value(pool, "extra", &provider).await?;
    let model = provider_setting_value(pool, "model", &provider).await?;
    let target_lang = target_lang_default(pool).await?;
    let batch_chars = parse_batch_chars(&setting(pool, "translate_batch_chars").await?);

    // 缺什么就说什么，别只丢一句「未配置」让用户挨个字段猜
    let missing = |what: &str| {
        AppError::BadRequest(format!(
            "{name} 还缺少「{what}」：请让管理员在「应用设置 → 翻译」中填写"
        ))
    };
    if base_url.trim().is_empty() {
        return Err(AppError::BadRequest(
            "尚未配置翻译接口地址：请让管理员在「应用设置 → 翻译」中填写".into(),
        ));
    }
    let (first, second) = engine::cred_fields(kind);
    match kind {
        engine::EngineKind::Llm => {
            if cred1.trim().is_empty() {
                return Err(missing(first.label));
            }
            if model.trim().is_empty() {
                return Err(missing("模型名"));
            }
        }
        engine::EngineKind::DeepL => {
            if cred1.trim().is_empty() {
                return Err(missing("API Key"));
            }
        }
        // 自建 LibreTranslate 通常不鉴权，Key 留空也放行
        engine::EngineKind::Libre => {}
        // MyMemory 匿名即可用（填邮箱只是提高额度）
        engine::EngineKind::MyMemory => {}
        engine::EngineKind::Baidu | engine::EngineKind::Tencent => {
            if cred1.trim().is_empty() {
                return Err(missing(first.label));
            }
            if cred2.trim().is_empty() {
                return Err(missing(second.map(|f| f.label).unwrap_or("密钥")));
            }
        }
    }
    Ok(TranslateConfig {
        kind,
        base_url,
        cred1,
        cred2,
        extra,
        model,
        target_code: engine::target_code(kind, &target_lang),
        target_name: prompt::language_name(&target_lang),
        target_lang,
        batch_chars,
    })
}

/// 连通性自检（管理员）：拿一句样品跑一次**真实**翻译，返回译文。
///
/// 刻意走与大流程完全相同的通道（含签名、语言码转换、引擎分派），
/// 这样「测试通过」才真的意味着正式翻译也能通。返回译文而不是布尔值，
/// 是为了让管理员一眼看出「通了，但翻出来不对」这种情况（多半是语言码填错）。
pub async fn test_connection(pool: &SqlitePool) -> CmdResult<String> {
    let cfg = load_config(pool).await?;
    let client = crate::collector::http::http_client().await;
    let sample = "Hello, world!";
    match cfg.kind {
        engine::EngineKind::Llm => {
            let system = prompt::system_prompt(&cfg.target_name, false);
            client::chat_completion(
                &client,
                &cfg.base_url,
                &cfg.cred1,
                &cfg.model,
                &system,
                sample,
            )
            .await
            .map_err(|e| AppError::BadRequest(e.to_string()))
        }
        _ => {
            let req = mt::MtRequest {
                kind: cfg.kind,
                base_url: &cfg.base_url,
                cred1: &cfg.cred1,
                cred2: &cfg.cred2,
                extra: &cfg.extra,
                target: &cfg.target_code,
            };
            let out = mt::translate_texts(&client, &req, &[sample.to_string()]).await?;
            out.into_iter()
                .next()
                .filter(|t| !t.trim().is_empty())
                .ok_or_else(|| AppError::BadRequest("服务商未返回任何译文".into()))
        }
    }
}

/// 每批默认翻译的字符数（管理员可在「翻译设置」里按自己的模型调整）。
///
/// 批越大越快：一次请求能覆盖更多段落，省掉的是每段的网络往返与首 token 延迟。
/// 但不可能无限大，有两个东西会先撞上来：
///   ① 模型单次输出上限——译文与原文长度同量级，中译英还会更长，输出超限就被截断；
///   ② 请求超时（见 `client::REQUEST_TIMEOUT`）——批太大模型生成不完，整批白等。
/// 默认取 2000 是"未知模型"下的安全值：连最大输出只有 4K 的老模型也翻得动。
pub const DEFAULT_BATCH_CHARS: usize = 2_000;
/// 下限：再小就等于逐段发请求，失去合并的意义
pub const MIN_BATCH_CHARS: usize = 200;
/// 上限：留给「输出上限大且生成快」的模型，再大基本只会撞超时
pub const MAX_BATCH_CHARS: usize = 20_000;
/// 一批最多包含的段落数：段落太碎时（比如一堆短列表项）光靠字符数会拼得过长
const BATCH_MAX_BLOCKS: usize = 6;

/// 把设置里存的批大小解析成可用值：空值或非数字回落默认值，越界钳制到范围内。
///
/// 这里刻意不报错：设置可能是手改数据库写坏的，翻译不该因此整个用不了。
pub fn parse_batch_chars(raw: &str) -> usize {
    raw.trim()
        .parse::<usize>()
        .map(|n| n.clamp(MIN_BATCH_CHARS, MAX_BATCH_CHARS))
        .unwrap_or(DEFAULT_BATCH_CHARS)
}

/// 把可译块按预算分组，元素是 `blocks` 的下标（组内保持原文顺序）。
///
/// 不可译块（代码块、空行）不参与分组，但也不打断分组——它们夹在批内两段之间，
/// 最后按原文顺序回填即可，结构无损。
fn build_batches(blocks: &[md::Block], max_chars: usize) -> Vec<Vec<usize>> {
    let max_chars = max_chars.clamp(MIN_BATCH_CHARS, MAX_BATCH_CHARS);
    let mut out: Vec<Vec<usize>> = Vec::new();
    let mut cur: Vec<usize> = Vec::new();
    let mut chars = 0usize;
    for (i, b) in blocks.iter().enumerate() {
        if b.kind != md::BlockKind::Translatable || b.text.trim().is_empty() {
            continue;
        }
        let n = b.text.chars().count();
        // 单块自己就超预算时让它独占一批（等价于旧的逐段行为），不会卡在这儿
        let full = !cur.is_empty() && (chars + n > max_chars || cur.len() >= BATCH_MAX_BLOCKS);
        if full {
            out.push(std::mem::take(&mut cur));
            chars = 0;
        }
        cur.push(i);
        chars += n;
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// 一批翻译的落地结果
struct BatchPieces {
    /// 与批内顺序一致的 (块下标, 译文)；None 表示该段失败，调用方回退原文
    pieces: Vec<(usize, Option<String>)>,
    /// 需要上报给用户的第一条错误
    error: Option<String>,
}

/// 翻译单块，返回**占位符已还原**的译文；失败返回可读的错误信息。
async fn translate_one(
    client: &reqwest::Client,
    cfg: &TranslateConfig,
    target: &str,
    src: &str,
) -> Result<String, String> {
    let protected = md::protect(src);
    let system = prompt::system_prompt(target, !protected.parts.is_empty());
    let translated = client::chat_completion(
        client,
        &cfg.base_url,
        &cfg.cred1,
        &cfg.model,
        &system,
        protected.text.trim_end(),
    )
    .await
    .map_err(|e| e.to_string())?;
    // 原文非空而译文为空 = 模型漏译。当失败处理，绝不能把正文段落抹掉。
    if translated.trim().is_empty() && !src.trim().is_empty() {
        return Err("模型返回了空译文，已保留原文".into());
    }
    if !md::placeholders_match(&translated, &md::placeholder_ids(&protected.text)) {
        return Err("部分段落的结构标记被模型改写，已保留原文".into());
    }
    Ok(md::restore(&translated, &protected.parts))
}

/// 整批降级：逐段重发。等价于旧版的一请求一段，用来兜住模型不守协议的情况。
async fn retry_one_by_one(
    client: &reqwest::Client,
    cfg: &TranslateConfig,
    target: &str,
    blocks: &[md::Block],
    batch: &[usize],
) -> BatchPieces {
    let mut pieces = Vec::with_capacity(batch.len());
    let mut error = None;
    for &i in batch {
        match translate_one(client, cfg, target, blocks[i].text.trim_end()).await {
            Ok(t) => pieces.push((i, Some(t))),
            Err(e) => {
                pieces.push((i, None));
                if error.is_none() {
                    error = Some(e);
                }
            }
        }
    }
    BatchPieces { pieces, error }
}

/// 翻译一批多段（batch.len() > 1）。
///
/// 正常路径：拼成带段落标记的一条消息 → 一次请求 → 按标记拆回 → 逐段校验占位符。
/// 兜底路径：模型没守住分段协议、或输出被截断时，**整批降级为逐段**，保证质量不退化。
async fn translate_group(
    client: &reqwest::Client,
    cfg: &TranslateConfig,
    target: &str,
    blocks: &[md::Block],
    batch: &[usize],
) -> BatchPieces {
    // 1) 拼装：每段以标记行开头。段内容去掉尾换行，免得把下一段的标记行顶到行中间。
    let mut joined = String::new();
    for (k, &i) in batch.iter().enumerate() {
        joined.push_str(&md::segment_marker(k + 1));
        joined.push('\n');
        joined.push_str(blocks[i].text.trim_end());
        joined.push('\n');
    }
    // 2) 整批一次性保护：占位符编号在批内全局唯一，还原时用同一份 parts
    let protected = md::protect(&joined);
    // 3) 切出每段的期望占位符编号，供后面逐段校验
    let Some(src_segs) = md::split_segments(&protected.text, batch.len()) else {
        // 标记是自己刚拼进去的，走不到这里；真走到了也不硬猜，直接降级
        return retry_one_by_one(client, cfg, target, blocks, batch).await;
    };
    let expected: Vec<Vec<usize>> =
        src_segs.iter().map(|s| md::placeholder_ids(s)).collect();

    // 4) 一次请求翻完整批
    let system = prompt::batch_system_prompt(target, !protected.parts.is_empty(), batch.len());
    match client::chat_completion(
        client,
        &cfg.base_url,
        &cfg.cred1,
        &cfg.model,
        &system,
        protected.text.trim_end(),
    )
    .await
    {
        Ok(translated) => {
            // 5) 按标记拆回；拆不动说明模型没守协议 → 逐段重发
            let Some(out_segs) = md::split_segments(&translated, batch.len()) else {
                return retry_one_by_one(client, cfg, target, blocks, batch).await;
            };
            // 6) 逐段独立校验：坏的那段保留原文，不连累同批其它段
            let mut pieces = Vec::with_capacity(batch.len());
            let mut error = None;
            for (k, &i) in batch.iter().enumerate() {
                let blank = out_segs[k].trim().is_empty() && !blocks[i].text.trim().is_empty();
                if !blank && md::placeholders_match(&out_segs[k], &expected[k]) {
                    pieces.push((i, Some(md::restore(&out_segs[k], &protected.parts))));
                } else {
                    pieces.push((i, None));
                    if error.is_none() {
                        error = Some("部分段落的结构标记被模型改写，已保留原文".to_string());
                    }
                }
            }
            BatchPieces { pieces, error }
        }
        // 输出撞上限：拆成单段重发（每段都短，几乎不会再撞）
        Err(client::ChatError::Truncated(_)) => {
            retry_one_by_one(client, cfg, target, blocks, batch).await
        }
        // 网络 / 鉴权 / 地址类错误：重发也是白等，整批保留原文
        Err(e) => BatchPieces {
            pieces: batch.iter().map(|&i| (i, None)).collect(),
            error: Some(e.to_string()),
        },
    }
}

/// 翻译一段 Markdown 文本。
///
/// `target_lang` 为目标语言码（如 "zh" / "ja"）；传 None 则用设置里的默认值。
///
/// 走哪条通道由服务商的引擎类型决定（`engine::kind_of`）：
///   · 大模型：多段**合并成少数几次请求**（见 `build_batches`），靠段落标记协议拆回；
///   · 机器翻译：按引擎上限分批（见 `engine::Limits`），超长段落先本地切开。
/// 两条通道的失败隔离与进度语义完全一致：某块失败只保留那一块原文，不会让整篇白做。
pub async fn translate_text(
    ctx: &TranslateCtx<'_>,
    text: &str,
    target_lang: Option<&str>,
) -> CmdResult<TranslateResult> {
    if text.trim().is_empty() {
        return Ok(TranslateResult {
            text: text.to_string(),
            failed_blocks: 0,
            error: None,
            cancelled: false,
        });
    }
    if text.chars().count() > MAX_TEXT_CHARS {
        return Err(AppError::BadRequest(format!(
            "单次翻译不得超过 {MAX_TEXT_CHARS} 字，请分段翻译"
        )));
    }
    // 配置缺失属于「用不了」而非「这一段失败」，直接上抛
    let cfg = load_config(ctx.pool).await?;
    // 目标语言：调用方可以覆盖默认值（编辑页的语言下拉）
    let want = target_lang
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(&cfg.target_lang);
    let client = crate::collector::http::http_client().await;

    let blocks = md::split_blocks(text);
    // 进度分母：只数真正要送翻译的块
    let total = blocks
        .iter()
        .filter(|b| b.kind == md::BlockKind::Translatable && !b.text.trim().is_empty())
        .count();

    let outcome = if cfg.kind == engine::EngineKind::Llm {
        run_llm(ctx, &cfg, &client, &blocks, &prompt::language_name(want), total).await
    } else {
        run_mt(ctx, &cfg, &client, &blocks, &engine::target_code(cfg.kind, want), total).await
    };

    // 按原文顺序拼装：不可译块与未翻成的块原样搬运
    let mut out = String::with_capacity(text.len());
    for (i, block) in blocks.iter().enumerate() {
        match outcome.translated[i].as_ref() {
            Some(piece) => {
                out.push_str(piece);
                // 模型/引擎常吃掉块尾换行，补回来以维持段落结构
                if block.text.ends_with('\n') && !piece.ends_with('\n') {
                    out.push('\n');
                }
            }
            None => out.push_str(&block.text),
        }
    }
    Ok(TranslateResult {
        text: out,
        failed_blocks: outcome.failed,
        error: if outcome.cancelled {
            Some("翻译已取消".into())
        } else {
            outcome.error
        },
        cancelled: outcome.cancelled,
    })
}

/// 大模型通道：按批合并多段，用 `@@@编号@@@` 标记协议拆回。
///
/// `target` 是**语言名**（不是语言码）——模型对「简体中文」的理解比 "zh" 更稳。
async fn run_llm(
    ctx: &TranslateCtx<'_>,
    cfg: &TranslateConfig,
    client: &reqwest::Client,
    blocks: &[md::Block],
    target: &str,
    total: usize,
) -> PassOutcome {
    let mut translated: Vec<Option<String>> = vec![None; blocks.len()];
    let mut failed_blocks = 0usize;
    let mut first_error: Option<String> = None;
    let mut done = 0usize;
    let mut cancelled = false;

    for batch in build_batches(blocks, cfg.batch_chars) {
        // 取消只在批与批之间生效：一批就是一次请求，中途掐断只会白花一次调用
        if ctx.cancel.load(Ordering::Relaxed) {
            cancelled = true;
            break;
        }
        let res = if batch.len() == 1 {
            let i = batch[0];
            match translate_one(client, cfg, target, blocks[i].text.trim_end()).await {
                Ok(t) => BatchPieces { pieces: vec![(i, Some(t))], error: None },
                Err(e) => BatchPieces { pieces: vec![(i, None)], error: Some(e) },
            }
        } else {
            translate_group(client, cfg, target, blocks, &batch).await
        };
        for (i, piece) in res.pieces {
            if piece.is_none() {
                failed_blocks += 1;
            }
            translated[i] = piece;
        }
        if first_error.is_none() {
            first_error = res.error;
        }
        done += batch.len();
        if let Some(app) = ctx.app {
            let _ = app.emit("translate-progress", TranslateProgress { done, total });
        }
    }
    PassOutcome {
        translated,
        failed: failed_blocks,
        error: first_error,
        cancelled,
    }
}

/// 机翻通道的分批：把若干片段按下标分组，组内片段数 ≤ `max_texts`、
/// 字符数之和 ≤ `max_chars`（单片段自身超限时独占一组，不会卡住）。
///
/// 抽成纯函数是为了能测：分批错了要么白跑几次请求，要么被服务商以
/// 「请求过长」整批拒绝 —— 而整批拒绝会连累同批里本来正常的段落。
fn group_batches(lengths: &[usize], limits: engine::Limits) -> Vec<Vec<usize>> {
    let mut out: Vec<Vec<usize>> = Vec::new();
    let mut cur: Vec<usize> = Vec::new();
    let mut chars = 0usize;
    for (i, &n) in lengths.iter().enumerate() {
        let full = !cur.is_empty() && (chars + n > limits.max_chars || cur.len() >= limits.max_texts);
        if full {
            out.push(std::mem::take(&mut cur));
            chars = 0;
        }
        cur.push(i);
        chars += n;
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// 机翻通道：本地切块 + 占位符保护，按引擎上限分批送出去。
///
/// 与大模型通道的关键差异：
///   · 占位符用 `[[0]]` 而不是 `<0>`（机翻引擎会把尖括号当 HTML 标签处理掉）；
///   · 引擎不守「指令」，所以结构完全靠自己保：切块不跨代码块、占位符逐个校验；
///   · 长段落先按引擎的单次上限切开，切点与分隔符都记下来，翻完按原样拼回。
async fn run_mt(
    ctx: &TranslateCtx<'_>,
    cfg: &TranslateConfig,
    client: &reqwest::Client,
    blocks: &[md::Block],
    target_code: &str,
    total: usize,
) -> PassOutcome {
    use md::PhStyle;

    let limits = cfg.kind.limits();
    let style = PhStyle::Bracket;
    let mut translated: Vec<Option<String>> = vec![None; blocks.len()];
    let mut first_error: Option<String> = None;
    let cancelled;

    /// 一个待译片段：归属哪个块、保护后的文本、还原用的片段表、切分处的分隔符
    struct Unit {
        block: usize,
        text: String,
        parts: Vec<String>,
        sep: String,
    }
    // 逐块切分。按块统计进度：一个块切成多个片段时，全部处理完才算这个块结束
    let mut units: Vec<Unit> = Vec::new();
    let mut per_block: Vec<usize> = vec![0; blocks.len()];
    let mut block_bad: Vec<bool> = vec![false; blocks.len()];
    for (i, b) in blocks.iter().enumerate() {
        if b.kind != md::BlockKind::Translatable || b.text.trim().is_empty() {
            continue;
        }
        let protected = md::protect_with(b.text.trim_end(), style);
        let mut parts = protected.parts;
        // 百度用换行拼多段，段内换行必须先变成占位符，否则行数与片段数对不上
        let text = if cfg.kind.joins_with_newline() {
            md::protect_newlines(&protected.text, &mut parts, style)
        } else {
            protected.text
        };
        for (piece, sep) in mt::chunk_text(&text, limits.max_chars) {
            units.push(Unit { block: i, text: piece, parts: parts.clone(), sep });
        }
        per_block[i] = units.iter().filter(|u| u.block == i).count();
    }

    // 按 (片段数, 字符数) 上限分批
    let batches = group_batches(&units.iter().map(|u| u.text.chars().count()).collect::<Vec<_>>(), limits);
    let mut handled: Vec<usize> = vec![0; blocks.len()];
    let mut done = 0usize;
    let mut hit_cancel = false;
    for (batch_no, batch) in batches.iter().enumerate() {
        if ctx.cancel.load(Ordering::Relaxed) {
            hit_cancel = true;
            break;
        }
        // QPS 限制严格的引擎（百度标准版 QPS=1）：两次请求之间主动等一等。
        // 不等的话连发几条就会被判「访问频率受限」，那几段只能保留原文。
        if batch_no > 0 && limits.min_interval_ms > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(limits.min_interval_ms)).await;
            // 等待期间用户可能点了取消，这里再查一次别白等一轮
            if ctx.cancel.load(Ordering::Relaxed) {
                hit_cancel = true;
                break;
            }
        }
        let texts: Vec<String> = batch.iter().map(|&k| units[k].text.clone()).collect();
        let req = mt::MtRequest {
            kind: cfg.kind,
            base_url: &cfg.base_url,
            cred1: &cfg.cred1,
            cred2: &cfg.cred2,
            extra: &cfg.extra,
            target: target_code,
        };
        let outcome = mt::translate_texts(client, &req, &texts).await;
        for (pos, &k) in batch.iter().enumerate() {
            let u = &units[k];
            handled[u.block] += 1;
            match outcome.as_ref() {
                Ok(outs) => {
                    let translated_seg = &outs[pos];
                    let expected = md::placeholder_ids_with(&u.text, style);
                    let good = !translated_seg.trim().is_empty()
                        && md::placeholders_match_with(translated_seg, &expected, style);
                    if good {
                        let piece = md::restore_with(translated_seg, &u.parts, style);
                        match translated[u.block].as_mut() {
                            // 同一块的前几段已拼上，补回分隔符再接
                            Some(acc) => {
                                acc.push_str(&u.sep);
                                acc.push_str(piece.trim());
                            }
                            None => translated[u.block] = Some(piece),
                        }
                    } else {
                        // 结构被改写或空译文：丢这一段，整块最后回退原文
                        block_bad[u.block] = true;
                        if first_error.is_none() {
                            first_error =
                                Some("部分片段的结构标记被引擎改写，已保留原文".into());
                        }
                    }
                }
                Err(e) => {
                    block_bad[u.block] = true;
                    if first_error.is_none() {
                        first_error = Some(e.to_string());
                    }
                }
            }
        }
        // 全部片段都处理过的块才计入进度
        for i in 0..blocks.len() {
            if per_block[i] > 0 && handled[i] == per_block[i] {
                done += 1;
                per_block[i] = 0; // 置零防止重复计数
            }
        }
        if let Some(app) = ctx.app {
            let _ = app.emit("translate-progress", TranslateProgress { done, total });
        }
    }
    cancelled = hit_cancel;

    // 一块只要有一段没翻成，整块回退原文：半译半原文的拼接比不译更糟
    let mut failed = 0usize;
    for i in 0..blocks.len() {
        if block_bad[i] {
            translated[i] = None;
            failed += 1;
        }
    }
    PassOutcome {
        translated,
        failed,
        error: first_error,
        cancelled,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use md::{Block, BlockKind};

    fn blk(text: &str, kind: BlockKind) -> Block {
        Block { text: text.to_string(), kind }
    }

    #[test]
    fn batches_collect_only_translatable() {
        let blocks = vec![
            blk("a", BlockKind::Translatable),
            blk("\n", BlockKind::Separator),
            blk("```\ncode\n```\n", BlockKind::Verbatim),
            blk("b", BlockKind::Translatable),
        ];
        // 代码块与空行不进批，但也不打断分组
        assert_eq!(build_batches(&blocks, DEFAULT_BATCH_CHARS), vec![vec![0, 3]]);
    }

    #[test]
    fn batches_respect_block_count_limit() {
        let blocks: Vec<Block> = (0..BATCH_MAX_BLOCKS * 2 + 1)
            .map(|_| blk("x", BlockKind::Translatable))
            .collect();
        let b = build_batches(&blocks, DEFAULT_BATCH_CHARS);
        assert_eq!(b.len(), 3);
        assert_eq!(b[0].len(), BATCH_MAX_BLOCKS);
        assert_eq!(b[1].len(), BATCH_MAX_BLOCKS);
        assert_eq!(b[2], vec![BATCH_MAX_BLOCKS * 2]);
    }

    #[test]
    fn batches_respect_char_budget() {
        // 每段 800 字，第三段就该被挤到下一批（800 + 800 + 800 > 2000）
        let seg = "字".repeat(800);
        let blocks: Vec<Block> = (0..3).map(|_| blk(&seg, BlockKind::Translatable)).collect();
        assert_eq!(build_batches(&blocks, DEFAULT_BATCH_CHARS), vec![vec![0, 1], vec![2]]);
    }

    #[test]
    fn batches_follow_configured_budget() {
        // 每段 800 字：预算调大到 3000 后，三段能装进一批
        let seg = "字".repeat(800);
        let blocks: Vec<Block> = (0..3).map(|_| blk(&seg, BlockKind::Translatable)).collect();
        assert_eq!(build_batches(&blocks, 3000), vec![vec![0, 1, 2]]);
        // 预算调小到 800 后，每段各成一批
        assert_eq!(build_batches(&blocks, 800), vec![vec![0], vec![1], vec![2]]);
    }

    #[test]
    fn batches_give_oversized_block_its_own() {
        let big = "字".repeat(DEFAULT_BATCH_CHARS + 10);
        let blocks = vec![
            blk("small", BlockKind::Translatable),
            blk(&big, BlockKind::Translatable),
            blk("small2", BlockKind::Translatable),
        ];
        assert_eq!(
            build_batches(&blocks, DEFAULT_BATCH_CHARS),
            vec![vec![0], vec![1], vec![2]]
        );
    }

    #[test]
    fn batches_ignore_blank_and_verbatim_only() {
        let blocks = vec![
            blk("```\ncode\n```\n", BlockKind::Verbatim),
            blk("\n", BlockKind::Separator),
            blk("   \n", BlockKind::Translatable), // 只有空白的可译块也跳过
        ];
        assert!(build_batches(&blocks, DEFAULT_BATCH_CHARS).is_empty());
    }

    #[test]
    fn group_batches_respects_text_and_char_limits() {
        // MyMemory 这类「一次只收一条」的引擎：必须一块一批
        let single = engine::Limits { max_texts: 1, max_chars: 1000, min_interval_ms: 0 };
        assert_eq!(group_batches(&[10, 10, 10], single), vec![vec![0], vec![1], vec![2]]);
        // 百度：可拼多段（换行分隔），但总字符数有上限
        let baidu = engine::Limits { max_texts: 16, max_chars: 800, min_interval_ms: 0 };
        assert_eq!(group_batches(&[300, 300, 300], baidu), vec![vec![0, 1], vec![2]]);
        // 空输入不该产出一个空批（那会白发一次没有任何内容的请求）
        assert!(group_batches(&[], baidu).is_empty());
    }

    #[test]
    fn group_batches_gives_oversized_piece_its_own_batch() {
        // 单片段超过字符上限时独占一批：硬塞进别的批只会让整批被服务商拒绝，
        // 连累同批里本来正常的段落
        let limits = engine::Limits { max_texts: 16, max_chars: 500, min_interval_ms: 0 };
        assert_eq!(group_batches(&[100, 900, 100], limits), vec![vec![0], vec![1], vec![2]]);
        // 每批的片段数都不超上限
        for g in group_batches(&[100; 50], engine::Limits { max_texts: 6, max_chars: 10_000, min_interval_ms: 0 }) {
            assert!(g.len() <= 6);
        }
    }

    #[test]
    fn parse_batch_chars_falls_back_and_clamps() {        // 没配过 / 空串 / 手改数据库写坏 → 一律回落默认值，不让翻译整体不可用
        assert_eq!(parse_batch_chars(""), DEFAULT_BATCH_CHARS);
        assert_eq!(parse_batch_chars("   "), DEFAULT_BATCH_CHARS);
        assert_eq!(parse_batch_chars("abc"), DEFAULT_BATCH_CHARS);
        assert_eq!(parse_batch_chars("-5"), DEFAULT_BATCH_CHARS);
        // 越界钳制到边界
        assert_eq!(parse_batch_chars("1"), MIN_BATCH_CHARS);
        assert_eq!(parse_batch_chars("999999"), MAX_BATCH_CHARS);
        // 正常值原样保留（允许前后空白）
        assert_eq!(parse_batch_chars(" 5000 "), 5000);
    }

    #[test]
    fn build_batches_clamps_out_of_range_budget() {
        // 即使调用方传了越界值也不会 panic，按边界处理
        let blocks = vec![blk("a", BlockKind::Translatable)];
        assert_eq!(build_batches(&blocks, 0), vec![vec![0]]);
        assert_eq!(build_batches(&blocks, usize::MAX), vec![vec![0]]);
    }

    #[test]
    fn provider_setting_is_per_provider() {
        // 三项设置都按服务商分桶，键名规则一致
        assert_eq!(provider_setting("base_url", "zhipu"), "translate_base_url_zhipu");
        assert_eq!(provider_setting("model", "deepseek"), "translate_model_deepseek");
        // 未设置服务商时归入 default 桶，键名不会退化成光杆前缀
        assert_eq!(provider_setting("base_url", ""), "translate_base_url_default");
        assert_eq!(provider_setting("base_url", "   "), "translate_base_url_default");
        // 核心诉求：不同服务商必须落在不同的键上，否则切换时仍会互相覆盖
        assert_ne!(provider_setting("model", "zhipu"), provider_setting("model", "moonshot"));
        // api_key_setting 是同一规则在 Key 上的别名
        assert_eq!(api_key_setting("zhipu"), provider_setting("api_key", "zhipu"));
    }

    #[test]
    fn api_key_setting_is_per_provider() {
        assert_eq!(api_key_setting("zhipu"), "translate_api_key_zhipu");
        assert_eq!(api_key_setting("deepseek"), "translate_api_key_deepseek");
        // 未设置服务商时归入 default 桶，键名不会退化成光杆前缀
        assert_eq!(api_key_setting(""), "translate_api_key_default");
        assert_eq!(api_key_setting("   "), "translate_api_key_default");
        // 核心诉求：不同服务商必须落在不同的键上，否则切换时仍会互相覆盖
        assert_ne!(api_key_setting("zhipu"), api_key_setting("moonshot"));
    }

    /// 端到端联网验证：用免注册的 MyMemory 跑**完整链路**
    /// （切块 → 占位符保护 → 分批 → 发请求 → 校验 → 还原 → 拼装），
    /// 检查 Markdown 结构有没有被机翻引擎弄坏。默认忽略：
    /// `cargo test --lib translate::tests::live_end_to_end -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn live_end_to_end_markdown_preserved() {
        let dir = std::env::temp_dir().join("yunji-translate-e2e-test");
        std::fs::create_dir_all(&dir).expect("建临时目录");
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("系统时间")
            .as_nanos();
        let db = dir.join(format!("e{stamp}.db"));
        let pool = crate::db::create_pool(&db).await.expect("建库");
        crate::db::run_migrations(&pool).await.expect("建表");
        // 配成 MyMemory：唯一不需要任何凭证就能跑的引擎，正好用来验链路
        repository::settings::set(&pool, "translate_provider", "mymemory")
            .await
            .expect("写服务商");
        repository::settings::set(&pool, "translate_target_lang", "zh")
            .await
            .expect("写目标语言");

        let cancel = AtomicBool::new(false);
        let ctx = TranslateCtx { pool: &pool, cancel: &cancel, app: None };
        let src = "# Hello World\n\nThis is a test with `inline code` and a [link](https://example.com/a).\n\n```js\nconst a = 1;\n```\n\nAnother paragraph here.\n";
        let out = translate_text(&ctx, src, Some("zh")).await.expect("翻译应当成功");
        println!("---- 原文 ----\n{src}\n---- 译文 ----\n{}", out.text);

        // 代码块必须逐字保留（机翻引擎不认识 Markdown，全靠本地切块保护）
        assert!(out.text.contains("```js\nconst a = 1;\n```"), "代码块被破坏");
        // 链接地址与行内代码也必须还原回去（它们被换成了 [[n]] 占位符）
        assert!(out.text.contains("https://example.com/a"), "链接地址丢失");
        assert!(out.text.contains("`inline code`"), "行内代码丢失");
        // 段落数不该变少
        assert!(out.text.matches("\n\n").count() >= src.matches("\n\n").count() - 1);

        pool.close().await;
        let _ = std::fs::remove_file(&db);
    }

    #[test]
    fn api_key_keys_are_recognized_for_filtering() {        // 分桶键与旧版遗留键都必须被识别（下发前端前要整体剔除明文）
        assert!(is_api_key_setting("translate_api_key_zhipu"));
        assert!(is_api_key_setting(LEGACY_API_KEY));
        // 第二个凭证（百度的密钥 / 腾讯的 SecretKey）同样必须剔除 ——
        // 它不以前者作前缀，漏掉就是把明文密钥交给前端
        assert!(is_api_key_setting("translate_api_key2_baidu"));
        assert!(is_api_key_setting("translate_api_key2_tencent"));
        assert!(is_api_key_setting(&provider_setting("api_key2", "baidu")));
        // 相邻但无关的键不能被误剔，否则设置页会缺项
        assert!(!is_api_key_setting("translate_provider"));
        assert!(!is_api_key_setting("translate_base_url"));
        assert!(!is_api_key_setting("translate_model"));
        assert!(!is_api_key_setting("translate_extra_tencent"));
        // 光杆前缀 `translate_api_key` 就是旧版遗留键的名字，同样必须剔除
        assert!(is_api_key_setting("translate_api_key"));
    }

    /// 旧版只有一把全局 Key，升级后不能丢——这是最容易出事的一步，用真库跑一遍。
    #[tokio::test]
    async fn legacy_key_migrates_into_provider_bucket() {
        let dir = std::env::temp_dir().join("yunji-translate-migrate-test");
        std::fs::create_dir_all(&dir).expect("建临时目录");
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("系统时间")
            .as_nanos();
        let db = dir.join(format!("m{stamp}.db"));

        let pool = crate::db::create_pool(&db).await.expect("建库");
        crate::db::run_migrations(&pool).await.expect("建表");

        repository::settings::set(&pool, LEGACY_API_KEY, "sk-legacy-1234")
            .await
            .expect("写旧键");
        repository::settings::set(&pool, "translate_provider", "zhipu")
            .await
            .expect("写服务商");
        repository::settings::set(&pool, "translate_base_url", "https://example.com/v1")
            .await
            .expect("写地址");
        repository::settings::set(&pool, "translate_model", "glm-4-flash")
            .await
            .expect("写模型");

        migrate_legacy_settings_to_provider(&pool).await.expect("迁移");
        // 旧键的价值搬到了「当前服务商」名下，且旧键被清掉（避免明文再多一条读取路径）
        assert_eq!(setting(&pool, "translate_api_key_zhipu").await.unwrap(), "sk-legacy-1234");
        assert!(setting(&pool, LEGACY_API_KEY).await.unwrap().is_empty());
        assert_eq!(providers_with_key(&pool).await.unwrap(), vec!["zhipu".to_string()]);
        // 接口地址 / 模型名同样固化到当前服务商的桶；全局键保留作读取回落
        assert_eq!(
            setting(&pool, "translate_base_url_zhipu").await.unwrap(),
            "https://example.com/v1"
        );
        assert_eq!(setting(&pool, "translate_model_zhipu").await.unwrap(), "glm-4-flash");
        assert_eq!(setting(&pool, "translate_base_url").await.unwrap(), "https://example.com/v1");
        // 关键兼容点：迁移后 load_config 仍能取到全部配置，不会被判成「没配」
        assert!(is_configured(&pool).await.unwrap());
        assert_eq!(load_config(&pool).await.unwrap().cred1, "sk-legacy-1234");
        assert_eq!(load_config(&pool).await.unwrap().base_url, "https://example.com/v1");

        // 幂等：再跑一次不报错、结果不变
        migrate_legacy_settings_to_provider(&pool).await.expect("重复迁移");
        assert_eq!(setting(&pool, "translate_api_key_zhipu").await.unwrap(), "sk-legacy-1234");

        // 目标桶已有值时不被旧键覆盖
        repository::settings::set(&pool, LEGACY_API_KEY, "sk-should-not-win")
            .await
            .expect("再写旧键");
        migrate_legacy_settings_to_provider(&pool).await.expect("再迁移");
        assert_eq!(setting(&pool, "translate_api_key_zhipu").await.unwrap(), "sk-legacy-1234");
        assert!(setting(&pool, LEGACY_API_KEY).await.unwrap().is_empty());

        // 两个服务商各存一把，互不干扰
        repository::settings::set(&pool, "translate_api_key_deepseek", "sk-ds")
            .await
            .expect("写第二桶");
        assert_eq!(
            providers_with_key(&pool).await.unwrap(),
            vec!["deepseek".to_string(), "zhipu".to_string()]
        );

        pool.close().await;
        let _ = std::fs::remove_file(&db);
    }

    /// 迁移失败 / 手改数据库时：桶空但全局键有值，行为应与旧版一致（回落全局键）
    #[tokio::test]
    async fn bucket_empty_falls_back_to_global_setting() {
        let dir = std::env::temp_dir().join("yunji-translate-migrate-test");
        std::fs::create_dir_all(&dir).expect("建临时目录");
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("系统时间")
            .as_nanos();
        let db = dir.join(format!("f{stamp}.db"));

        let pool = crate::db::create_pool(&db).await.expect("建库");
        crate::db::run_migrations(&pool).await.expect("建表");

        repository::settings::set(&pool, "translate_provider", "zhipu")
            .await
            .expect("写服务商");
        repository::settings::set(&pool, "translate_base_url", "https://legacy.example/v1")
            .await
            .expect("写全局地址");
        // 不跑迁移、zhipu 桶为空 → 读全局键
        assert_eq!(
            provider_setting_value(&pool, "base_url", "zhipu").await.unwrap(),
            "https://legacy.example/v1"
        );
        // 桶里一旦有值，优先桶值
        repository::settings::set(&pool, "translate_base_url_zhipu", "https://bucket.example/v1")
            .await
            .expect("写桶");
        assert_eq!(
            provider_setting_value(&pool, "base_url", "zhipu").await.unwrap(),
            "https://bucket.example/v1"
        );
        // 别的服务商的桶不受影响，仍回落全局键
        assert_eq!(
            provider_setting_value(&pool, "base_url", "moonshot").await.unwrap(),
            "https://legacy.example/v1"
        );

        pool.close().await;
        let _ = std::fs::remove_file(&db);
    }
}
