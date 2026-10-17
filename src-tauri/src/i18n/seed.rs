// 语言目录定位与首次启动释放
//
// 目录优先级：<exe 同级>/lang/ → <data>/lang/。
// 前者是便携版场景下用户一眼能看到的位置，改起来最方便；装在 Program Files 这类
// 不可写位置时自动退到 data 目录（那里必然可写，数据库就在里面）。
//
// 释放原则：文件已存在就跳过，绝不覆盖用户改过的模板。
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};

use super::{SEEDS, SEED_README, SEED_VERSION};

/// 模板版本号对应的设置键
const VERSION_KEY: &str = "lang_seed_version";

/// 选定语言目录：优先 exe 同级，不可写则退到 data 目录
pub fn resolve_lang_dir(exe_dir: &Path, data_dir: &Path) -> PathBuf {
    for dir in [exe_dir.join("lang"), data_dir.join("lang")] {
        if is_writable(&dir) {
            return dir;
        }
    }
    // 都不理想也照常返回，后续读写失败只降级（内置兜底字典仍在），不阻断启动
    data_dir.join("lang")
}

/// 可写性探测：真正写一个临时文件，光看目录能不能建不够
fn is_writable(dir: &Path) -> bool {
    if std::fs::create_dir_all(dir).is_err() {
        return false;
    }
    let probe = dir.join(".write_test");
    let ok = std::fs::write(&probe, b"").is_ok();
    let _ = std::fs::remove_file(&probe);
    ok
}

/// 释放默认语言文件（幂等）。任何失败都向上返回，由调用方决定只记日志
pub async fn release(lang_dir: &Path, db: &SqlitePool) -> Result<(), String> {
    std::fs::create_dir_all(lang_dir).map_err(|e| format!("创建语言目录失败：{e}"))?;

    // 说明文件：不存在才写，用户删了会随下次启动恢复
    let readme = lang_dir.join("_README.txt");
    if !readme.exists() {
        std::fs::write(&readme, SEED_README).map_err(|e| format!("写入 _README.txt 失败：{e}"))?;
    }

    let mut released = Vec::new();
    for (code, text) in SEEDS {
        let file = lang_dir.join(format!("{code}.json"));
        if !file.exists() {
            std::fs::write(&file, text).map_err(|e| format!("释放 {code}.json 失败：{e}"))?;
            released.push(*code);
        }
    }

    // 官方模板版本变化：不动用户的文件，只另写一份 .template.json 供对照
    let saved = crate::db::repository::settings::get(db, VERSION_KEY)
        .await
        .map_err(|e| e.to_string())?;
    if saved.as_deref() != Some(SEED_VERSION) {
        if saved.is_some() {
            for (code, text) in SEEDS {
                let tpl = lang_dir.join(format!("{code}.template.json"));
                let _ = std::fs::write(&tpl, text);
            }
            println!("官方语言模板已更新，对照文件已写入 lang/*.template.json");
        }
        crate::db::repository::settings::set(db, VERSION_KEY, SEED_VERSION)
            .await
            .map_err(|e| e.to_string())?;
    }

    if !released.is_empty() {
        println!("已释放默认语言文件：{}（目录：{}）", released.join("、"), lang_dir.display());
    }
    Ok(())
}
