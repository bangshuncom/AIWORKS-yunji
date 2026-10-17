// 翻译引擎的类型、字段规格与请求上限
//
// 引擎分两大类，协议完全不同：
//   · `Llm` —— OpenAI 兼容的 /chat/completions。可以下指令，能较好保住 Markdown 结构，
//     但按 token 计费、生成慢，免费额度多为「限速不限量」。
//   · 机器翻译（MT）—— DeepL / LibreTranslate / MyMemory / 百度 / 腾讯云。
//     各厂商一套协议，不能下指令，但免费额度通常大得多、响应也快。
//
// 界面上要展示哪些输入框**由这里派生**（`cred_fields` / `extra_field` / `uses_model`），
// 加新引擎只改这张表 + 一个适配器，前端不用动。
use serde::Serialize;

/// 引擎协议类型。序列化给前端的取值：llm / deep_l / libre / my_memory / baidu / tencent
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EngineKind {
    Llm,
    DeepL,
    Libre,
    MyMemory,
    Baidu,
    Tencent,
}

impl EngineKind {
    /// 界面上的分组标签
    pub fn label(self) -> &'static str {
        match self {
            EngineKind::Llm => "大模型",
            _ => "机器翻译",
        }
    }

    /// 是否用「模型名」这一项（同时决定能不能拉取模型列表、要不要露出批大小设置）
    pub fn uses_model(self) -> bool {
        matches!(self, EngineKind::Llm)
    }

    /// 接口地址是否允许用户改。
    /// 自建 LibreTranslate、自定义 LLM 需要；其余都是厂商固定域名（不用用户操心）。
    pub fn base_url_editable(self) -> bool {
        matches!(self, EngineKind::Llm | EngineKind::Libre)
    }

    /// 是否把多个待译片段用换行拼成一条请求（百度官方的批量方式就是换行分隔）
    pub fn joins_with_newline(self) -> bool {
        matches!(self, EngineKind::Baidu)
    }

    /// 源语言码：ML 引擎支持自动识别，只有 MyMemory 用了自己的一套写法
    pub fn source_code(self) -> &'static str {
        match self {
            EngineKind::MyMemory => "Autodetect",
            _ => "auto",
        }
    }

    /// 单次请求的容量上限（片段数、字符数）与最小发送间隔。
    ///
    /// 取值都留了余量：超限的后果是整条请求失败，而各家对超限的报错各不相同，
    /// 与其去猜边界，不如保守一点多切一批。
    pub fn limits(self) -> Limits {
        match self {
            // LLM 的批大小由管理员配置（translate_batch_chars），这里只兜底
            EngineKind::Llm => Limits { max_texts: 6, max_chars: 2_000, min_interval_ms: 0 },
            // 官方限制：单请求 128 KiB、最多 50 段
            EngineKind::DeepL => Limits { max_texts: 50, max_chars: 40_000, min_interval_ms: 0 },
            // 自建实例一般不限量，官方托管版有限制，取保守值
            EngineKind::Libre => Limits { max_texts: 20, max_chars: 4_000, min_interval_ms: 0 },
            // q 单次最长 500 字符（超出直接返回 QUERY LENGTH LIMIT EXCEEDED）
            EngineKind::MyMemory => Limits { max_texts: 1, max_chars: 450, min_interval_ms: 0 },
            // 标准版单次 1000 字符且 **QPS 只有 1**：必须限速，否则连发几条就会被
            // 54003（访问频率受限）整批拒掉，那几段只能保留原文。高级版 QPS 10，
            // 慢一点但绝不会失败，对用户更划算。
            EngineKind::Baidu => Limits { max_texts: 16, max_chars: 800, min_interval_ms: 1_100 },
            // TextTranslate 单次 SourceText 最长 2000 字符，且一次只收一条
            EngineKind::Tencent => Limits { max_texts: 1, max_chars: 1_800, min_interval_ms: 0 },
        }
    }
}

/// 单次请求能装多少
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    pub max_texts: usize,
    pub max_chars: usize,
    /// 两次请求之间的最小间隔（毫秒）。给 QPS 限制严格的引擎用，其余为 0
    pub min_interval_ms: u64,
}

/// 一个界面输入框的规格
#[derive(Debug, Clone, Serialize)]
pub struct FieldSpec {
    pub label: &'static str,
    pub placeholder: &'static str,
    pub hint: &'static str,
}

const fn f(label: &'static str, placeholder: &'static str, hint: &'static str) -> FieldSpec {
    FieldSpec { label, placeholder, hint }
}

/// 凭证明细：第一个是必需的，第二个只有部分引擎才有（百度、腾讯双凭证）
pub fn cred_fields(kind: EngineKind) -> (FieldSpec, Option<FieldSpec>) {
    match kind {
        EngineKind::Llm => (
            f("API Key", "粘贴服务商控制台生成的 API Key", "只保存在本机数据库，不会回传到界面"),
            None,
        ),
        EngineKind::DeepL => (
            f(
                "API Key",
                "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx",
                "免费版 Key 以 :fx 结尾，程序会自动选用 api-free 域名；Pro 版用 api.deepl.com",
            ),
            None,
        ),
        EngineKind::Libre => (
            f(
                "API Key",
                "自建实例可留空",
                "官方托管版需要 Key（每月 10 万字符免费）；自建实例通常不需要鉴权",
            ),
            None,
        ),
        EngineKind::MyMemory => (
            f(
                "联系邮箱",
                "可留空",
                "免注册即可用，匿名约 5000 字符/天；填邮箱可显著提高日额度",
            ),
            None,
        ),
        EngineKind::Baidu => (
            f("APP ID", "百度翻译开放平台的 APP ID", "在「管理控制台 → 开发者信息」查看"),
            Some(f("密钥", "与 APP ID 配对的密钥", "密钥只在创建应用时完整显示一次")),
        ),
        EngineKind::Tencent => (
            f("SecretId", "访问管理 → API 密钥管理里的 SecretId", "建议用子账号密钥并只授予 TMT 权限"),
            Some(f("SecretKey", "与 SecretId 配对的密钥", "密钥仅在创建时完整显示一次")),
        ),
    }
}

/// 附加参数（有些引擎需要一个额外的短参数）
pub fn extra_field(kind: EngineKind) -> Option<FieldSpec> {
    match kind {
        EngineKind::Tencent => Some(f(
            "地域",
            "ap-guangzhou",
            "腾讯云地域标识，如 ap-guangzhou / ap-beijing / ap-shanghai，填错会报鉴权失败",
        )),
        _ => None,
    }
}

/// 附加参数的默认值（切换服务商时预填）
pub fn extra_default(kind: EngineKind) -> &'static str {
    match kind {
        EngineKind::Tencent => "ap-guangzhou",
        _ => "",
    }
}

/// 把应用内的语言码翻译成各家引擎自己的写法。
///
/// 各家对同一门语言的码**完全不通用**：日语在百度是 `jp` 而腾讯是 `ja`、
/// 韩语在百度是 `kor`、繁体中文在百度是 `cht`、腾讯是 `zh-TW`、LibreTranslate 是 `zt`，
/// DeepL 还要求大写、葡语要区分 PT-BR / PT-PT。
/// 这里做集中映射，写错一处只是「翻成另一种语言」或「报语言不支持」这类难查的软故障。
pub fn target_code(kind: EngineKind, app_code: &str) -> String {
    // DeepL
    if kind == EngineKind::DeepL {
        return match app_code {
            "zh" => "ZH",
            "zh-Hant" => "ZH-HANT",
            "pt" => "PT-BR",
            other => return other.to_ascii_uppercase(),
        }
        .to_string();
    }
    // 其余引擎用小写码，逐个特殊处理
    let code = match (kind, app_code) {
        // LibreTranslate：繁体是 zt
        (EngineKind::Libre, "zh-Hant") => "zt",
        // MyMemory：要求带地区的完整 locale
        (EngineKind::MyMemory, "zh") => "zh-CN",
        (EngineKind::MyMemory, "zh-Hant") => "zh-TW",
        (EngineKind::MyMemory, "en") => "en-GB",
        (EngineKind::MyMemory, "ja") => "ja-JP",
        (EngineKind::MyMemory, "ko") => "ko-KR",
        (EngineKind::MyMemory, "ru") => "ru-RU",
        (EngineKind::MyMemory, "fr") => "fr-FR",
        (EngineKind::MyMemory, "de") => "de-DE",
        (EngineKind::MyMemory, "es") => "es-ES",
        (EngineKind::MyMemory, "pt") => "pt-PT",
        // 百度：繁体 cht、日语 jp、韩语 kor、法语 fra、西语 spa
        (EngineKind::Baidu, "zh-Hant") => "cht",
        (EngineKind::Baidu, "ja") => "jp",
        (EngineKind::Baidu, "ko") => "kor",
        (EngineKind::Baidu, "fr") => "fra",
        (EngineKind::Baidu, "es") => "spa",
        // 腾讯云：日语韩语沿用 ja / ko（**不是**百度的 jp / kor），繁体是 zh-TW
        (EngineKind::Tencent, "zh-Hant") => "zh-TW",
        // 其余原样（en / ja / ko / ru / fr / de / es / pt / zh 各家写法一致）
        (_, other) => other,
    };
    code.to_string()
}

/// 服务商模板。
///
/// ⚠ base_url 与默认模型名会随厂商调整，**厂商下线旧模型时不会通知本程序**。
/// 这里只是 2026-10-16 核对官方文档后的预填值，仅作起点；用户可改成任意内容。
/// 调用返回 400 / 404 基本就是「模型名已被下线」，请到厂商控制台复制当前模型名覆盖。
pub struct ProviderTemplate {
    pub id: &'static str,
    pub name: &'static str,
    /// 协议类型：决定走哪条代码路径、界面上要哪些字段
    pub kind: EngineKind,
    pub base_url: &'static str,
    pub default_model: &'static str,
    /// 额度/计费提示，界面上给管理员参考
    pub note: &'static str,
}

pub const PROVIDERS: &[ProviderTemplate] = &[
    // ---------- 大模型（OpenAI 兼容） ----------
    ProviderTemplate {
        id: "zhipu",
        name: "智谱 GLM",
        kind: EngineKind::Llm,
        base_url: "https://open.bigmodel.cn/api/paas/v4",
        default_model: "glm-4-flash",
        note: "glm-4-flash 永久免费、不限量，中文能力强",
    },
    ProviderTemplate {
        id: "deepseek",
        name: "DeepSeek",
        kind: EngineKind::Llm,
        base_url: "https://api.deepseek.com/v1",
        // deepseek-chat / deepseek-reasoner 已于 2026-07-24 弃用，现行是 v4 系列
        default_model: "deepseek-v4-flash",
        note: "按量计费，一篇 2000 字约 ¥0.03；需先充值，余额为 0 会报 402",
    },
    ProviderTemplate {
        id: "siliconflow",
        name: "硅基流动",
        kind: EngineKind::Llm,
        base_url: "https://api.siliconflow.cn/v1",
        default_model: "Qwen/Qwen3-8B",
        note: "Qwen3-8B 免费（需实名）；新用户另送 2000 万 token",
    },
    ProviderTemplate {
        id: "dashscope",
        name: "阿里云百炼",
        kind: EngineKind::Llm,
        base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        // qwen-turbo 已于 2026-10-10 下线
        default_model: "qwen3.6-flash",
        note: "新用户赠送 100 万 token（90 天）",
    },
    ProviderTemplate {
        id: "qianfan",
        name: "百度千帆",
        kind: EngineKind::Llm,
        base_url: "https://qianfan.baidubce.com/v2",
        // 旧的免费系列 ERNIE-Speed-8K 已整体下线
        default_model: "ernie-4.5-turbo-32k",
        note: "按量计费；旧的免费小模型已下线",
    },
    ProviderTemplate {
        id: "ark",
        name: "火山方舟",
        kind: EngineKind::Llm,
        base_url: "https://ark.cn-beijing.volces.com/api/v3",
        default_model: "doubao-seed-2-0-lite",
        note: "每日 200 万 token 免费；模型名建议填控制台里当前可见的 ID",
    },
    ProviderTemplate {
        id: "moonshot",
        name: "Kimi (Moonshot)",
        kind: EngineKind::Llm,
        base_url: "https://api.moonshot.cn/v1",
        // moonshot-v1 全系列已于 2026-08-31 下线（调用返回 404）
        default_model: "kimi-k2.6",
        note: "按量计费；旧的 moonshot-v1 系列已下线",
    },
    // ---------- 机器翻译 ----------
    ProviderTemplate {
        id: "tencent",
        name: "腾讯云机器翻译",
        kind: EngineKind::Tencent,
        base_url: "https://tmt.tencentcloudapi.com",
        default_model: "",
        note: "文本翻译每月 500 万字符免费（额度最大）；需实名并开通「机器翻译」服务，超出 58 元/百万字符",
    },
    ProviderTemplate {
        id: "baidu",
        name: "百度通用翻译",
        kind: EngineKind::Baidu,
        base_url: "https://fanyi-api.baidu.com",
        default_model: "",
        note: "标准版 5 万字符/月、单次 1000 字符、QPS 仅 1（程序会自动控速）；个人认证升级后 100 万字符/月",
    },
    ProviderTemplate {
        id: "deepl",
        name: "DeepL",
        kind: EngineKind::DeepL,
        base_url: "https://api-free.deepl.com/v2",
        default_model: "",
        note: "每月 50 万字符免费，译文质量公认最好；注册后即可拿到 Key（免费版以 :fx 结尾）",
    },
    ProviderTemplate {
        id: "libre",
        name: "LibreTranslate",
        kind: EngineKind::Libre,
        base_url: "https://libretranslate.com",
        default_model: "",
        note: "开源可自建（数据不出本机、不限量）；官方托管版每月 10 万字符免费",
    },
    ProviderTemplate {
        id: "mymemory",
        name: "MyMemory",
        kind: EngineKind::MyMemory,
        base_url: "https://api.mymemory.translated.net",
        default_model: "",
        note: "完全免注册，匿名约 5000 字符/天；额度小，适合尝鲜与备用",
    },
    // ---------- 自定义 ----------
    ProviderTemplate {
        id: "custom",
        name: "自定义（OpenAI 兼容）",
        kind: EngineKind::Llm,
        base_url: "",
        default_model: "",
        note: "自己填写接口地址与模型名，需兼容 OpenAI 的 /chat/completions 格式",
    },
];

/// 按服务商 id 找模板
pub fn template_of(provider: &str) -> Option<&'static ProviderTemplate> {
    let p = provider.trim();
    PROVIDERS.iter().find(|t| t.id == p)
}

/// 服务商 id → 引擎类型。
///
/// **未知 id 一律当大模型处理**：`custom` 是这样，用户手动改过数据库的历史 id 也是这样。
/// 这样即使模板表里删掉了某个条目，旧配置也只是退化成原行为，不会突然用不了。
pub fn kind_of(provider: &str) -> EngineKind {
    template_of(provider).map(|t| t.kind).unwrap_or(EngineKind::Llm)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_provider_falls_back_to_llm() {
        // 旧配置 / 手改数据库给出的未知 id 不能变成「无引擎可用」
        assert_eq!(kind_of("custom"), EngineKind::Llm);
        assert_eq!(kind_of("some-old-id"), EngineKind::Llm);
        assert_eq!(kind_of(""), EngineKind::Llm);
    }

    #[test]
    fn provider_ids_are_unique_and_known() {
        let mut ids: Vec<&str> = PROVIDERS.iter().map(|p| p.id).collect();
        let n = ids.len();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), n, "服务商 id 不能重复");
        // 每个机器翻译引擎都必须有固定域名，否则用户什么都不填就能翻译会打到空地址
        for p in PROVIDERS {
            if p.kind != EngineKind::Llm {
                assert!(!p.base_url.is_empty(), "{} 缺少默认接口地址", p.id);
                assert!(p.default_model.is_empty(), "{} 是机翻，不该有模型名", p.id);
            }
        }
    }

    #[test]
    fn field_specs_match_engine_shape() {
        // 大模型：地址与模型名都要，单凭证
        let (c1, c2) = cred_fields(EngineKind::Llm);
        assert_eq!(c1.label, "API Key");
        assert!(c2.is_none());
        assert!(EngineKind::Llm.uses_model());
        assert!(EngineKind::Llm.base_url_editable());

        // 百度 / 腾讯：双凭证
        assert!(cred_fields(EngineKind::Baidu).1.is_some());
        assert!(cred_fields(EngineKind::Tencent).1.is_some());
        assert_eq!(cred_fields(EngineKind::Baidu).0.label, "APP ID");
        assert_eq!(cred_fields(EngineKind::Tencent).0.label, "SecretId");
        // 只有腾讯需要地域
        assert!(extra_field(EngineKind::Tencent).is_some());
        assert!(extra_field(EngineKind::Baidu).is_none());
        assert_eq!(extra_default(EngineKind::Tencent), "ap-guangzhou");

        // 机翻都不用模型名，也不该让用户去改厂商域名（Libre 自建除外）
        for k in [EngineKind::DeepL, EngineKind::MyMemory, EngineKind::Baidu, EngineKind::Tencent] {
            assert!(!k.uses_model());
            assert!(!k.base_url_editable());
        }
        assert!(EngineKind::Libre.base_url_editable());
    }

    #[test]
    fn language_codes_are_engine_specific() {
        // 同一门语言，各家写法不同 —— 这是最容易写错的地方
        assert_eq!(target_code(EngineKind::DeepL, "zh"), "ZH");
        assert_eq!(target_code(EngineKind::DeepL, "zh-Hant"), "ZH-HANT");
        assert_eq!(target_code(EngineKind::DeepL, "pt"), "PT-BR");
        assert_eq!(target_code(EngineKind::Libre, "zh-Hant"), "zt");
        assert_eq!(target_code(EngineKind::MyMemory, "zh"), "zh-CN");
        assert_eq!(target_code(EngineKind::MyMemory, "zh-Hant"), "zh-TW");
        assert_eq!(target_code(EngineKind::Baidu, "zh-Hant"), "cht");
        assert_eq!(target_code(EngineKind::Baidu, "ja"), "jp");
        assert_eq!(target_code(EngineKind::Baidu, "ko"), "kor");
        assert_eq!(target_code(EngineKind::Baidu, "fr"), "fra");
        assert_eq!(target_code(EngineKind::Baidu, "es"), "spa");
        // 腾讯用的是 ja / ko / zh-TW —— 与百度不同，写成 jp / kr 会被判「语言不支持」
        assert_eq!(target_code(EngineKind::Tencent, "ja"), "ja");
        assert_eq!(target_code(EngineKind::Tencent, "ko"), "ko");
        assert_eq!(target_code(EngineKind::Tencent, "zh-Hant"), "zh-TW");
        // 各家一致的（德语、法语等）不该被改写；MyMemory 例外——它要求带地区的完整 locale
        for k in [EngineKind::Baidu, EngineKind::Tencent, EngineKind::Libre] {
            assert_eq!(target_code(k, "en"), "en");
            assert_eq!(target_code(k, "de"), "de");
        }
        assert_eq!(target_code(EngineKind::MyMemory, "en"), "en-GB");
        assert_eq!(target_code(EngineKind::MyMemory, "ja"), "ja-JP");
    }

    #[test]
    fn only_baidu_joins_with_newline() {
        assert!(EngineKind::Baidu.joins_with_newline());
        for k in [EngineKind::DeepL, EngineKind::Libre, EngineKind::MyMemory, EngineKind::Tencent] {
            assert!(!k.joins_with_newline());
        }
    }

    #[test]
    fn limits_are_strictly_positive() {
        for k in [
            EngineKind::Llm,
            EngineKind::DeepL,
            EngineKind::Libre,
            EngineKind::MyMemory,
            EngineKind::Baidu,
            EngineKind::Tencent,
        ] {
            let l = k.limits();
            // 0 会让分批循环死循环或切出空片段
            assert!(l.max_texts > 0 && l.max_chars > 0, "{k:?} 上限非法");
        }
        // MyMemory 的 q 有 500 字符硬上限，必须留出余量
        assert!(EngineKind::MyMemory.limits().max_chars < 500);
        // 百度标准版 QPS 为 1：必须有限速，否则连发会被整批拒掉
        assert!(EngineKind::Baidu.limits().min_interval_ms >= 1_000);
        // 其余引擎不该被无谓地拖慢
        for k in [EngineKind::DeepL, EngineKind::Libre, EngineKind::Tencent, EngineKind::MyMemory] {
            assert_eq!(k.limits().min_interval_ms, 0, "{k:?} 不该限速");
        }
    }
}
