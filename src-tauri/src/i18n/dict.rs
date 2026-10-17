// 字典合并：按回退链把语言包叠成一份完整字典
//
// 回退顺序（后者覆盖前者）：
//   内置简体中文 → 磁盘 zh-CN → ...$meta.fallback 声明的父语言... → 目标语言
//
// 保证任何残缺、甚至用户写坏了的语言包都不会让界面出现空白：最差也就是显示中文。
use std::collections::HashMap;
use std::path::Path;

use super::scan;
use super::FALLBACK_CODE;

/// 目标语言的回退链，父在前、子在后（便于逐级覆盖）
fn fallback_chain(lang_dir: &Path, code: &str) -> Vec<String> {
    let mut chain = vec![code.to_string()];
    let mut current = code.to_string();
    // 最多 4 层：正常语言包不会这么深，这个上限只是防 fallback 写成一个环
    for _ in 0..4 {
        let Some(meta) = scan::read_meta(lang_dir, &current) else {
            break;
        };
        let Some(parent) = meta.fallback.filter(|f| !f.trim().is_empty()) else {
            break;
        };
        if chain.contains(&parent) {
            break;
        }
        chain.push(parent.clone());
        current = parent;
    }
    if !chain.iter().any(|c| c == FALLBACK_CODE) {
        chain.push(FALLBACK_CODE.to_string());
    }
    chain.reverse();
    chain
}

/// 构建指定语言的完整字典（已含回退）
pub fn build_dict(lang_dir: &Path, code: &str) -> HashMap<String, String> {
    // 起点是内置简体中文：即使用户把整个 lang 目录删了，字典也一定是完整的
    let mut dict = super::seed().entries.clone();
    for c in fallback_chain(lang_dir, code) {
        if let Ok(entries) = scan::read_entries(lang_dir, &c) {
            dict.extend(entries);
        }
    }
    dict
}
