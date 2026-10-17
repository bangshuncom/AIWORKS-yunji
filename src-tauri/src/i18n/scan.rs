// 语言目录扫描：读取 lang/*.json，产出语言清单（含覆盖率与解析状态）
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::{seed, LangInfo, LangMeta};

/// 语言文件名 → 语言代码。非法/非语言文件返回 None
///
/// 规则：以 .json 结尾；主名只能含字母、数字、下划线、连字符且以字母或数字开头；
/// 下划线开头（如 _README）与 .template.json（官方模板副本）都不算语言包。
pub fn code_from_file_name(file_name: &str) -> Option<String> {
    let name = file_name.strip_suffix(".json")?;
    if name.is_empty() || name.starts_with('_') || name.ends_with(".template") {
        return None;
    }
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphanumeric() => {}
        _ => return None,
    }
    if !chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return None;
    }
    Some(name.to_string())
}

fn lang_file(lang_dir: &Path, code: &str) -> PathBuf {
    lang_dir.join(format!("{code}.json"))
}

/// 读取某个语言的元信息（解析失败时返回 None，由调用方降级为「按文件名处理」）
pub fn read_meta(lang_dir: &Path, code: &str) -> Option<LangMeta> {
    let text = std::fs::read_to_string(lang_file(lang_dir, code)).ok()?;
    super::parse_lang_text(&text).ok()?.0
}

/// 读取某个语言的条目表（仅该文件自身的内容，不做回退合并）
pub fn read_entries(lang_dir: &Path, code: &str) -> Result<HashMap<String, String>, String> {
    let text = std::fs::read_to_string(lang_file(lang_dir, code))
        .map_err(|e| format!("读取 {code}.json 失败：{e}"))?;
    super::parse_lang_text(&text).map(|(_, entries)| entries)
}

/// 扫描语言目录，产出语言清单。目录不存在或不可读时返回空列表（调用方会降级）
pub fn scan(lang_dir: &Path) -> Vec<LangInfo> {
    let mut out = Vec::new();
    let Ok(dir) = std::fs::read_dir(lang_dir) else {
        return out;
    };
    // 目录遍历顺序不保证稳定，排序后列表顺序才可预期
    let mut paths: Vec<PathBuf> = dir.filter_map(|e| e.ok()).map(|e| e.path()).collect();
    paths.sort();

    let base_keys = &seed().keys;
    let base_total = base_keys.len();

    for path in paths {
        let Some(file_name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        let Some(code) = code_from_file_name(file_name) else {
            continue;
        };

        let is_seed = super::SEEDS.iter().any(|(c, _)| *c == code);
        let path_str = path.to_string_lossy().to_string();

        // 解析失败：单独标记，不影响其它语言包
        let entries = match read_entries(lang_dir, &code) {
            Ok(entries) => entries,
            Err(e) => {
                out.push(LangInfo {
                    name: code.clone(),
                    native_name: code.clone(),
                    code,
                    is_seed,
                    total: 0,
                    missing: base_total,
                    coverage: 0,
                    status: "invalid".into(),
                    error: Some(e),
                    warning: None,
                    path: path_str,
                });
                continue;
            }
        };

        // 文件名与 $meta.code 不一致时以文件名为准，仅提示（用户复制模板后常忘了改 meta）
        let meta = read_meta(lang_dir, &code);
        let warning = meta.as_ref().and_then(|m| {
            if m.code != code {
                Some(format!("文件名与 $meta.code（{}）不一致，已按文件名处理", m.code))
            } else {
                None
            }
        });

        let (name, native_name) = match meta {
            Some(m) => (m.name, m.native_name),
            None => (code.clone(), code.clone()),
        };

        // 覆盖率按「内置简体中文的条目被覆盖了多少」算，比按文件自身条目数更贴近实际观感
        let covered = base_keys.iter().filter(|k| entries.contains_key(*k)).count();
        let missing = base_total.saturating_sub(covered);
        let coverage = if base_total == 0 {
            100
        } else {
            ((covered * 100) / base_total).min(100) as u8
        };

        out.push(LangInfo {
            code,
            name,
            native_name,
            is_seed,
            total: entries.len(),
            missing,
            coverage,
            status: "ok".into(),
            error: None,
            warning,
            path: path_str,
        });
    }

    // 内置语言排在前面，其余按代码排序，切换下拉里更好找
    out.sort_by(|a, b| {
        b.is_seed
            .cmp(&a.is_seed)
            .then_with(|| a.code.cmp(&b.code))
    });
    out
}
