// Markdown 保护：切块 + 把不可翻译片段抽成占位符、翻完再还原
//
// 为什么必须自己做：通用 LLM 虽然能被提示词约束「保留 Markdown 语法」，
// 但这约束是靠模型自觉的——长文里只要有一次把 ``` 改掉、或者把 URL 补个斜杠，
// 正文就坏了。所以采用双保险：先把这些片段抠成 <0> <1>，让模型根本看不到它们。
use once_cell::sync::Lazy;
use regex::Regex;

// ---------- 切块 ----------

/// 块的类型
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlockKind {
    /// 需要翻译的正文
    Translatable,
    /// 原样保留（围栏代码块）
    Verbatim,
    /// 空行等分隔符，原样保留
    Separator,
}

#[derive(Debug, Clone)]
pub struct Block {
    pub text: String,
    pub kind: BlockKind,
}

/// 行首的围栏标记（``` 或 ~~~，允许缩进）
fn fence_marker(line: &str) -> Option<&'static str> {
    let t = line.trim_start();
    if t.starts_with("```") {
        Some("```")
    } else if t.starts_with("~~~") {
        Some("~~~")
    } else {
        None
    }
}

/// 按空行切块；围栏代码块整体作为一个不可译块，空行单独成块。
///
/// 每个块都用 `split_inclusive` 保留了自己的换行符，
/// 所以按顺序原样拼接即可**无损还原**原文结构。
pub fn split_blocks(md: &str) -> Vec<Block> {
    let mut blocks: Vec<Block> = Vec::new();
    let mut cur = String::new();
    let mut kind = BlockKind::Translatable;
    let mut fence: Option<&'static str> = None;

    for line in md.split_inclusive('\n') {
        // 1) 围栏内部：整行累积（含空行），遇到闭合行结束
        if let Some(marker) = fence {
            cur.push_str(line);
            if line.trim_start().starts_with(marker) {
                fence = None;
            }
            continue;
        }
        // 2) 围栏起始行
        if let Some(marker) = fence_marker(line) {
            if !cur.is_empty() {
                blocks.push(Block { text: std::mem::take(&mut cur), kind });
            }
            kind = BlockKind::Verbatim;
            fence = Some(marker);
            cur.push_str(line);
            continue;
        }
        // 3) 空行：结束当前块，空行自成一个分隔块
        if line.trim().is_empty() {
            if !cur.is_empty() {
                blocks.push(Block { text: std::mem::take(&mut cur), kind });
                kind = BlockKind::Translatable;
            }
            blocks.push(Block { text: line.to_string(), kind: BlockKind::Separator });
            continue;
        }
        // 4) 普通文本行
        cur.push_str(line);
    }
    if !cur.is_empty() {
        blocks.push(Block { text: cur, kind });
    }
    blocks
}

// ---------- 占位符保护 ----------

// 注意各条正则之间的顺序与互斥：
// 已经生成 <n> 占位符的片段不能被后续正则再次匹配，所以：
//   · 链接目标与裸 URL 的字符类都排除了 '<'
//   · 图片在链接之前处理（整图替换，不会残留 '](url)'）
static RE_INLINE_CODE: Lazy<Regex> = Lazy::new(|| Regex::new(r"`[^`\n]+`").unwrap());
static RE_IMAGE: Lazy<Regex> = Lazy::new(|| Regex::new(r"!\[[^\]]*\]\([^)\s]*\)").unwrap());
static RE_LINK_URL: Lazy<Regex> = Lazy::new(|| Regex::new(r"\]\(([^)\s<]+)\)").unwrap());
static RE_BARE_URL: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"https?://[^\s<>\)\]，。；、！？]+").unwrap());
static RE_HTML: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"</?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?/?>").unwrap());
static RE_MATH: Lazy<Regex> = Lazy::new(|| Regex::new(r"\$\$[^$]+\$\$|\$[^$\n]+\$").unwrap());
static RE_PLACEHOLDER: Lazy<Regex> = Lazy::new(|| Regex::new(r"<(\d+)>").unwrap());

/// 占位符的写法。
///
/// 大模型用 `<0>`；机器翻译引擎换成 `[[0]]`。为什么必须区别对待：
/// `<0>` 长得像 HTML 标签，机翻引擎（尤其百度、腾讯这类）会按标签处理——
/// 重排、丢弃、甚至把编号也翻掉；方括号形式它们一般原样保留。
/// 两种写法都不落在上面任何一条保护正则里，可以安全穿过 protect/restore。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PhStyle {
    /// `<0>`：给大模型
    Angle,
    /// `[[0]]`：给机器翻译引擎
    Bracket,
}

impl PhStyle {
    /// 生成第 i 个占位符
    fn wrap(self, i: usize) -> String {
        match self {
            PhStyle::Angle => format!("<{i}>"),
            PhStyle::Bracket => format!("[[{i}]]"),
        }
    }

    /// 识别该写法的正则
    fn regex(self) -> &'static Regex {
        static BRACKET: Lazy<Regex> = Lazy::new(|| Regex::new(r"\[\[(\d+)\]\]").unwrap());
        match self {
            PhStyle::Angle => &RE_PLACEHOLDER,
            PhStyle::Bracket => &BRACKET,
        }
    }
}

pub struct Protected {
    /// 替换后的文本（不可译片段已变成占位符）
    pub text: String,
    /// 占位符对应的原始片段，下标即编号
    pub parts: Vec<String>,
}

/// 把不可翻译片段抽成 `<n>` 占位符（大模型通道）
pub fn protect(text: &str) -> Protected {
    protect_with(text, PhStyle::Angle)
}

/// 按指定写法抽占位符
pub fn protect_with(text: &str, style: PhStyle) -> Protected {
    let mut parts: Vec<String> = Vec::new();
    let mut out = text.to_string();

    out = replace_whole(&RE_INLINE_CODE, &out, &mut parts, style);
    out = replace_whole(&RE_IMAGE, &out, &mut parts, style);
    out = replace_link_url(&out, &mut parts, style);
    out = replace_whole(&RE_BARE_URL, &out, &mut parts, style);
    out = replace_whole(&RE_HTML, &out, &mut parts, style);
    out = replace_whole(&RE_MATH, &out, &mut parts, style);

    Protected { text: out, parts }
}

/// 把块内的换行也换成占位符，用于「用换行拼多段」的引擎（百度）。
///
/// 不这么做的话，拼进去的段内换行会和段间的分隔换行混在一起，
/// 返回时行数与片段数就对不上了。还原时这些占位符会变回换行。
pub fn protect_newlines(text: &str, parts: &mut Vec<String>, style: PhStyle) -> String {
    if !text.contains('\n') {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    for (i, seg) in text.split('\n').enumerate() {
        if i > 0 {
            parts.push("\n".to_string());
            out.push_str(&style.wrap(parts.len() - 1));
        }
        out.push_str(seg);
    }
    out
}

/// 整段替换为占位符
fn replace_whole(re: &Regex, text: &str, parts: &mut Vec<String>, style: PhStyle) -> String {
    re.replace_all(text, |caps: &regex::Captures| {
        parts.push(caps[0].to_string());
        style.wrap(parts.len() - 1)
    })
    .into_owned()
}

/// 只替换链接目标 `](url)` 中的 url，保留可翻译的链接文字
fn replace_link_url(text: &str, parts: &mut Vec<String>, style: PhStyle) -> String {
    RE_LINK_URL
        .replace_all(text, |caps: &regex::Captures| {
            parts.push(caps[1].to_string());
            format!("]({})", style.wrap(parts.len() - 1))
        })
        .into_owned()
}

/// 把 `<n>` 占位符还原成原文片段（大模型通道）
pub fn restore(text: &str, parts: &[String]) -> String {
    restore_with(text, parts, PhStyle::Angle)
}

/// 按指定写法还原占位符
pub fn restore_with(text: &str, parts: &[String], style: PhStyle) -> String {
    style
        .regex()
        .replace_all(text, |caps: &regex::Captures| match caps[1].parse::<usize>() {
            Ok(i) => parts.get(i).cloned().unwrap_or_else(|| caps[0].to_string()),
            Err(_) => caps[0].to_string(),
        })
        .into_owned()
}

/// 文本里出现的占位符编号（按出现顺序，含重复）
pub fn placeholder_ids(text: &str) -> Vec<usize> {
    placeholder_ids_with(text, PhStyle::Angle)
}

/// 按指定写法取出占位符编号
pub fn placeholder_ids_with(text: &str, style: PhStyle) -> Vec<usize> {
    style
        .regex()
        .captures_iter(text)
        .filter_map(|c| c[1].parse::<usize>().ok())
        .collect()
}

/// 译文的占位符编号是否与期望**完全一致**（含重数）。
///
/// 比「数量相等」严格：丢一个、多一个、重复一个、串到别的编号都会判否。
/// 模型偶尔会改写、吞掉或重复占位符——那种译文一定已经把正文结构弄坏了。
/// 此时调用方应**丢弃该段译文、保留原文**：宁可不译，也不能让正文被破坏。
pub fn placeholders_match(text: &str, expected: &[usize]) -> bool {
    placeholders_match_with(text, expected, PhStyle::Angle)
}

/// 按指定写法校验占位符
pub fn placeholders_match_with(text: &str, expected: &[usize], style: PhStyle) -> bool {
    let Some(mut got) = style
        .regex()
        .captures_iter(text)
        .map(|c| c[1].parse::<usize>().ok())
        .collect::<Option<Vec<usize>>>()
    else {
        // 编号大到解析不出来，等同于结构被破坏
        return false;
    };
    if got.len() != expected.len() {
        return false;
    }
    got.sort_unstable();
    let mut want = expected.to_vec();
    want.sort_unstable();
    got == want
}

// ---------- 批量翻译的段落标记 ----------

// 标记形如 @@@1@@@。选 '@' 是刻意的：它不落在上面任何一条保护正则里，
// 所以标记能安全穿过 protect / restore，也不会被模型当成需要翻译的专有名词。
static RE_SEG_MARKER: Lazy<Regex> = Lazy::new(|| Regex::new(r"@@@(\d+)@@@").unwrap());

/// 第 n 段的标记行（n 从 1 开始）
pub fn segment_marker(n: usize) -> String {
    format!("@@@{n}@@@")
}

/// 按标记把文本切回 n 段。
///
/// 标记缺失、多出、编号不符或顺序错乱时返回 None —— 说明模型没遵守分段协议，
/// 调用方必须**整批降级为逐段翻译**，而不是硬猜怎么切。
pub fn split_segments(text: &str, n: usize) -> Option<Vec<String>> {
    let found: Vec<_> = RE_SEG_MARKER.find_iter(text).collect();
    if found.len() != n {
        return None;
    }
    for (k, m) in found.iter().enumerate() {
        if m.as_str() != segment_marker(k + 1) {
            return None;
        }
    }
    let mut out = Vec::with_capacity(n);
    for (k, m) in found.iter().enumerate() {
        let start = m.end();
        let end = found.get(k + 1).map_or(text.len(), |x| x.start());
        out.push(text[start..end].trim().to_string());
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(blocks: &[Block]) -> Vec<BlockKind> {
        blocks.iter().map(|b| b.kind).collect()
    }

    #[test]
    fn splits_on_blank_lines() {
        let b = split_blocks("a\n\nb\n");
        assert_eq!(
            kinds(&b),
            vec![BlockKind::Translatable, BlockKind::Separator, BlockKind::Translatable]
        );
    }

    #[test]
    fn fence_block_is_verbatim_and_swallows_blank_lines() {
        let md = "前言\n\n```js\nconst a = 1;\n\n// 空行也不该切\n```\n\n后记\n";
        let b = split_blocks(md);
        let verbatim: Vec<_> = b.iter().filter(|x| x.kind == BlockKind::Verbatim).collect();
        assert_eq!(verbatim.len(), 1);
        assert!(verbatim[0].text.contains("const a = 1;"));
        assert!(verbatim[0].text.contains("// 空行也不该切"));
        // 只有「前言」后与「后记」前两个空行算分隔符，代码块内部的空行被吞进去了
        assert_eq!(b.iter().filter(|x| x.kind == BlockKind::Separator).count(), 2);
    }

    #[test]
    fn split_is_lossless() {
        let md = "# 标题\n\n正文一段\n\n- 列表\n- 列表\n\n> 引用\n\n```\ncode\n```\n";
        let joined: String = split_blocks(md).iter().map(|b| b.text.clone()).collect();
        assert_eq!(joined, md);
    }

    #[test]
    fn protects_inline_code() {
        let p = protect("用 `cargo build` 构建");
        assert_eq!(p.parts, vec!["`cargo build`".to_string()]);
        assert!(!p.text.contains("cargo"));
        assert_eq!(restore(&p.text, &p.parts), "用 `cargo build` 构建");
    }

    #[test]
    fn protects_link_url_but_keeps_text() {
        let src = "见 [官方文档](https://example.com/a?b=1) 说明";
        let p = protect(src);
        assert_eq!(p.parts, vec!["https://example.com/a?b=1".to_string()]);
        // 链接文字仍可翻译
        assert!(p.text.contains("官方文档"));
        assert!(!p.text.contains("example.com"));
        assert_eq!(restore(&p.text, &p.parts), src);
    }

    #[test]
    fn protects_image_and_bare_url_without_nesting() {
        let src = "![封面](img/a.png) 与 https://example.com/x 都要保住";
        let p = protect(src);
        // 关键：图片整段被保护后，不能再被「链接目标」正则二次匹配（否则会嵌套占位符）
        assert_eq!(
            p.parts,
            vec!["![封面](img/a.png)".to_string(), "https://example.com/x".to_string()]
        );
        assert_eq!(restore(&p.text, &p.parts), src);
    }

    #[test]
    fn protects_html_and_math() {
        let src = "行内 <b>粗体</b> 与公式 $E=mc^2$ 保持原样";
        let p = protect(src);
        assert_eq!(p.parts.len(), 3);
        assert_eq!(restore(&p.text, &p.parts), src);
    }

    #[test]
    fn detects_broken_placeholders() {
        assert!(placeholders_match("译文 <0> 内容", &[0]));
        assert!(!placeholders_match("译文 内容", &[0])); // 丢了
        assert!(!placeholders_match("译文 <0> <0>", &[0])); // 重复
        assert!(!placeholders_match("译文 <2>", &[0, 1])); // 串号
        assert!(!placeholders_match("译文 <0>", &[0, 1])); // 少了一个
        assert!(placeholders_match("无占位符", &[]));
        // 多重集比较与顺序无关
        assert!(placeholders_match("a <1> b <0>", &[0, 1]));
    }

    #[test]
    fn placeholder_ids_follow_appearance_order() {
        assert_eq!(placeholder_ids("a <0> b <2> c <1>"), vec![0, 2, 1]);
        // 越界编号也原样取出，交给 placeholders_match 判定
        assert_eq!(placeholder_ids("<9>"), vec![9]);
    }

    #[test]
    fn segment_marker_survives_protect() {
        // 标记必须能安全穿过 protect：否则批量翻译的分段信息会被吃掉
        let src = "@@@1@@@\n用 `cargo build` 构建\n@@@2@@@\n看 https://example.com/x\n";
        let p = protect(src);
        let segs = split_segments(&p.text, 2).expect("标记应完好穿过保护");
        assert_eq!(segs.len(), 2);
        assert!(segs[0].contains("<0>"));
        // 还原后与原文片段一致
        assert_eq!(restore(&segs[0], &p.parts), "用 `cargo build` 构建");
    }

    #[test]
    fn split_segments_rejects_broken_protocol() {
        let ok = "@@@1@@@\n甲\n@@@2@@@\n乙\n";
        assert_eq!(split_segments(ok, 2).unwrap(), vec!["甲", "乙"]);

        // 少一个标记
        assert!(split_segments("@@@1@@@\n甲\n乙\n", 2).is_none());
        // 编号跳号
        assert!(split_segments("@@@1@@@\n甲\n@@@3@@@\n乙\n", 2).is_none());
        // 顺序颠倒
        assert!(split_segments("@@@2@@@\n乙\n@@@1@@@\n甲\n", 2).is_none());
        // 要求两段却只给了一段
        assert!(split_segments("@@@1@@@\n甲\n", 2).is_none());
    }

    #[test]
    fn split_segments_trims_but_keeps_inner_newlines() {
        let text = "@@@1@@@\n\n- 甲\n- 乙\n\n@@@2@@@\n\n丙\n\n";
        let segs = split_segments(text, 2).unwrap();
        assert_eq!(segs[0], "- 甲\n- 乙");
        assert_eq!(segs[1], "丙");
    }

    #[test]
    fn bracket_style_round_trips_and_does_not_collide_with_angle() {
        let src = "用 `cargo build` 与 [文档](https://example.com/a) 构建";
        let p = protect_with(src, PhStyle::Bracket);
        assert_eq!(p.parts.len(), 2);
        assert!(p.text.contains("[[0]]") && p.text.contains("[[1]]"));
        // 机翻通道的文本里不该再出现尖括号形式
        assert!(!p.text.contains('<'));
        assert_eq!(restore_with(&p.text, &p.parts, PhStyle::Bracket), src);
        // 两种写法互不串味：方括号文本用尖括号规则去数，应该是空的
        assert!(placeholder_ids_with(&p.text, PhStyle::Angle).is_empty());
        // 反之亦然
        let a = protect(src);
        assert!(placeholder_ids_with(&a.text, PhStyle::Bracket).is_empty());
    }

    #[test]
    fn newline_protection_removes_all_breaks() {
        // 已有 1 个占位符（模拟代码片段已抽出），换行从编号 1 往下排
        let mut parts = vec!["`code`".to_string()];
        let out = protect_newlines("第一行\n第二行\n第三行", &mut parts, PhStyle::Bracket);
        // 关键：换行全变成占位符，文本里一个都不剩 —— 这才敢用换行拼多段
        assert!(!out.contains('\n'));
        assert_eq!(placeholder_ids_with(&out, PhStyle::Bracket), vec![1, 2]);
        // 还原后与原文一致
        assert_eq!(
            restore_with(&out, &parts, PhStyle::Bracket),
            "第一行\n第二行\n第三行"
        );
    }

    #[test]
    fn newline_protection_is_noop_without_breaks() {
        let mut parts: Vec<String> = Vec::new();
        let out = protect_newlines("没有换行的一段", &mut parts, PhStyle::Angle);
        assert_eq!(out, "没有换行的一段");
        assert!(parts.is_empty());
    }
}
