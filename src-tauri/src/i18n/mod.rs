// 多语言（i18n）：语言包释放、扫描与字典合并
//
// 完整设计见 docs/i18n-design.md。三条硬规则：
//   1. 仓库根 lang/ 是唯一真源，编译期 include_str! 嵌入；首次启动释放到 <exe 同级>/lang/
//   2. 已存在的文件**绝不覆盖**（用户可能改过）；官方模板更新时只另写一份 .template.json
//   3. 任何语言包缺条目都回退到内置简体中文，界面不会出现空白或崩溃

pub mod dict;
pub mod scan;
pub mod seed;

use std::collections::{HashMap, HashSet};

use once_cell::sync::OnceCell;
use serde::{Deserialize, Serialize};

/// 内置语言种子（编译期嵌入；唯一真源位于仓库根 lang/）
pub const SEED_ZH_CN: &str = include_str!("../../../lang/zh-CN.json");
pub const SEED_ZH_TW: &str = include_str!("../../../lang/zh-TW.json");
pub const SEED_EN_US: &str = include_str!("../../../lang/en-US.json");
pub const SEED_README: &str = include_str!("../../../lang/_README.txt");

/// 官方模板版本。改动仓库根 lang/ 下的内置文件后递增，
/// 启动时据此判断要不要给用户另出一份 .template.json 供对照
pub const SEED_VERSION: &str = "2";

/// 最终兜底语言：任何语言包缺条目都回退到它，同时也是「基准 key 集」的来源
pub const FALLBACK_CODE: &str = "zh-CN";

/// 随程序释放的三份默认语言
pub const SEEDS: &[(&str, &str)] = &[
    ("zh-CN", SEED_ZH_CN),
    ("zh-TW", SEED_ZH_TW),
    ("en-US", SEED_EN_US),
];

/// 语言文件里的 $meta 段
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LangMeta {
    pub code: String,
    pub name: String,
    #[serde(rename = "nativeName")]
    pub native_name: String,
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub fallback: Option<String>,
}

/// 语言清单项（下发给前端）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LangInfo {
    pub code: String,
    pub name: String,
    pub native_name: String,
    /// 是否官方内置的三份之一
    pub is_seed: bool,
    /// 该语言包自己的条目数
    pub total: usize,
    /// 相对内置简体中文缺失的条目数
    pub missing: usize,
    /// 覆盖率百分比（0-100）
    pub coverage: u8,
    /// ok | invalid
    pub status: String,
    /// 解析失败原因（status=invalid 时有值）
    pub error: Option<String>,
    /// 非致命问题（如文件名与 $meta.code 不一致）
    pub warning: Option<String>,
    pub path: String,
}

/// 解析后的内置简体中文：既是兜底字典，也是统计覆盖率的基准
pub struct Seed {
    pub entries: HashMap<String, String>,
    pub keys: HashSet<String>,
}

/// 内置简体中文（只解析一次）
pub fn seed() -> &'static Seed {
    static CELL: OnceCell<Seed> = OnceCell::new();
    CELL.get_or_init(|| {
        let (_, entries) = parse_lang_text(SEED_ZH_CN).unwrap_or_default();
        let keys = entries.keys().cloned().collect();
        Seed { entries, keys }
    })
}

/// 解析语言文件文本 → (元信息, 条目表)
///
/// 容错优先：`$meta` 之外的非字符串值直接跳过，不让一处脏数据废掉整个文件。
pub fn parse_lang_text(text: &str) -> Result<(Option<LangMeta>, HashMap<String, String>), String> {    let text = text.trim_start_matches('\u{feff}'); // 容忍 UTF-8 BOM
    let value: serde_json::Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
    let obj = value
        .as_object()
        .ok_or_else(|| "文件内容不是一个 JSON 对象".to_string())?;
    let mut meta = None;
    let mut entries = HashMap::new();
    for (key, val) in obj {
        if key == "$meta" {
            meta = serde_json::from_value(val.clone()).ok();
            continue;
        }
        if let Some(s) = val.as_str() {
            entries.insert(key.clone(), s.to_string());
        }
    }
    Ok((meta, entries))
}

/// 取一个 key 的翻译，带完整回退链：当前语言 → 父语言 → 内置简体中文 → key 本身。
///
/// 用于 Rust 侧（当前主要是系统托盘菜单）需要按当前语言渲染固定文案的场景。
/// 每次都从磁盘重建字典，调用频率极低（仅建托盘/切语言时），无需缓存。
pub fn tr<P: AsRef<std::path::Path>>(lang_dir: P, code: &str, key: &str) -> String {
    let dict = dict::build_dict(lang_dir.as_ref(), code);
    dict.get(key)
        .cloned()
        .unwrap_or_else(|| key.to_string())
}
