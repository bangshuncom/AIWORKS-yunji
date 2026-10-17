// 语言码映射与提示词模板

/// 可选目标语言（码 → 提示词里使用的语言名）。
///
/// 用语言名而不是语言码：模型对「简体中文」的理解明显比 "zh" 更稳。
pub const LANGUAGES: &[(&str, &str)] = &[
    ("zh", "简体中文"),
    ("zh-Hant", "繁體中文"),
    ("en", "English"),
    ("ja", "日本語"),
    ("ko", "한국어"),
    ("ru", "Русский"),
    ("fr", "Français"),
    ("de", "Deutsch"),
    ("es", "Español"),
    ("pt", "Português"),
];

/// 语言码 → 语言名；未知码回落到简体中文
pub fn language_name(code: &str) -> String {
    LANGUAGES
        .iter()
        .find(|(c, _)| *c == code)
        .map(|(_, n)| (*n).to_string())
        .unwrap_or_else(|| "简体中文".to_string())
}

/// 系统提示：约束输出形态，保住 Markdown 语法与占位符。
///
/// `has_placeholders` 只在文本里确实存在占位符时传 true——
/// 没有占位符却告诉模型「有 <0> 要保留」，反而可能诱发它凭空造出标记。
pub fn system_prompt(target_lang: &str, has_placeholders: bool) -> String {
    let mut p = format!(
        "你是专业翻译引擎。用户的下一条消息是待翻译的文本，请把它翻译成{target_lang}。\n\
         严格遵守以下要求：\n\
         1. 只输出译文本身，不要任何解释、前言、引号或代码块包裹；\n\
         2. 完整保留原文的 Markdown 语法（# 标题、* 与 - 列表、> 引用、表格、空行与换行结构）；\n\
         3. 代码、URL、邮箱、文件名、软件与游戏名称等专有名词保持原样，不要翻译；\n\
         4. 保持与原文相同的段落数量与顺序。"
    );
    if has_placeholders {
        p.push_str(
            "\n5. 文中形如 <0>、<1> 的标记是占位符，代表不可翻译的代码、链接或图片；\
             必须原样保留在它原本的位置，不要改动、不要遗漏、不要重复、不要增删编号。",
        );
    }
    p
}

/// 批量翻译的系统提示：在单段要求之外，额外约束「段落标记」必须原样保留。
///
/// 之所以能把多段合成一次请求，全靠这个协议；模型不遵守时调用方会整批降级为逐段，
/// 所以这里写得尽量死板、不留解释空间。
pub fn batch_system_prompt(target_lang: &str, has_placeholders: bool, segments: usize) -> String {
    let mut p = system_prompt(target_lang, has_placeholders);
    p.push_str(&format!(
        "\n\n本次用户消息包含 {segments} 个段落，每段以单独一行的 @@@编号@@@ 开头\
         （从 @@@1@@@ 到 @@@{segments}@@@）。在此之上还必须遵守：\n\
         6. 逐段翻译，输出时原样保留每个 @@@编号@@@ 标记行：单独占一行，编号与先后顺序都不得改动，\
         不得增删、不得改写成其它形式；\n\
         7. 每段译文紧跟在其标记行之后；不得把两个段落合并成一段，也不得把一段拆成多段；\n\
         8. 除标记行与译文外不要输出任何其它内容（不要解释、不要总结、不要加分隔线）。"
    ));
    p
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_and_unknown_language() {
        assert_eq!(language_name("ja"), "日本語");
        assert_eq!(language_name("zh-Hant"), "繁體中文");
        // 未知码回落
        assert_eq!(language_name("xx"), "简体中文");
    }

    #[test]
    fn placeholder_clause_is_conditional() {
        let without = system_prompt("简体中文", false);
        assert!(!without.contains("占位符"));
        let with = system_prompt("简体中文", true);
        assert!(with.contains("占位符"));
        // 目标语言要真的写进去
        assert!(with.contains("简体中文"));
    }

    #[test]
    fn batch_prompt_keeps_segment_protocol() {
        let p = batch_system_prompt("English", true, 3);
        // 单段规则不能丢
        assert!(p.contains("English"));
        assert!(p.contains("占位符"));
        // 分段协议与段数都要写清楚
        assert!(p.contains("@@@1@@@"));
        assert!(p.contains("@@@3@@@"));
        assert!(p.contains("3 个段落"));
    }
}
