// 云记 - Tauri 应用入口
mod auth;
mod bencode;
mod collector;
mod commands;
mod db;
mod error;
mod i18n;
mod magnet;
mod state;
mod storage;
mod translate;

use std::path::PathBuf;
use tauri::{Manager, WindowEvent};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

use crate::state::AppState;
use crate::storage::get_storage;

/// 显示并聚焦主窗口
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// 系统托盘固定 ID（切换语言后据此重建菜单文案）
const TRAY_ID: &str = "main";

/// 按当前语言构建托盘右键菜单。文案取自 lang 目录对应语言包，缺词回退简体中文。
fn build_tray_menu(app: &tauri::AppHandle, lang_dir: &std::path::Path, lang: &str) -> tauri::Result<Menu<tauri::Wry>> {
    let show_item = MenuItem::with_id(
        app,
        "tray_show",
        i18n::tr(lang_dir, lang, "tray.show"),
        true,
        None::<&str>,
    )?;
    let quit_item = MenuItem::with_id(
        app,
        "tray_quit",
        i18n::tr(lang_dir, lang, "tray.quit"),
        true,
        None::<&str>,
    )?;
    Menu::with_items(app, &[&show_item, &quit_item])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // 获取数据目录：exe 同级 data/
            let exe_dir = std::env::current_exe()
                .map_err(|e| e.to_string())?
                .parent()
                .ok_or("无法确定 exe 目录")?
                .to_path_buf();
            let data_dir = exe_dir.join("data");

            // 开发模式：使用项目根的 data/
            let data_dir = if cfg!(debug_assertions) {
                let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
                manifest_dir.parent().unwrap_or(&manifest_dir).join("data")
            } else {
                data_dir
            };

            std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

            // 语言目录：优先 exe 同级 lang/（便携版用户一眼能看到），不可写时退到 data/lang/
            let lang_dir = i18n::seed::resolve_lang_dir(&exe_dir, &data_dir);

            // 初始化数据库
            let db_path = data_dir.join("app.db");
            let pool = tauri::async_runtime::block_on(async {
                db::create_pool(&db_path)
                    .await
                    .map_err(|e| e.to_string())
            })?;

            // 运行迁移
            tauri::async_runtime::block_on(async {
                db::run_migrations(&pool)
                    .await
                    .map_err(|e| e.to_string())
            })?;

            // 翻译设置由「全局单份」改为「按服务商分桶」，补一次搬迁。
            // 迁移只是兼容旧数据，失败不该拦住启动，所以只记日志。
            tauri::async_runtime::block_on(async {
                if let Err(e) = translate::migrate_legacy_settings_to_provider(&pool).await {
                    eprintln!("翻译设置迁移失败（不影响启动）：{e}");
                }
            });

            // 首次启动释放默认语言文件（简/繁/英），已存在的文件绝不覆盖；
            // 失败只记日志，程序用内置简体中文兜底，不阻断启动。
            tauri::async_runtime::block_on(async {
                if let Err(e) = i18n::seed::release(&lang_dir, &pool).await {
                    eprintln!("释放语言文件失败（不影响启动，将使用内置简体中文兜底）：{e}");
                }
            });

            // 初始化存储
            let storage = tauri::async_runtime::block_on(async {
                get_storage(&pool, &data_dir)
                    .await
                    .map_err(|e| e.to_string())
            })?;

            // 首次启动创建管理员
            tauri::async_runtime::block_on(async {
                let count = db::repository::users::count(&pool).await.map_err(|e| e.to_string())?;
                if count == 0 {
                    let hash = auth::hash_password("admin123")
                        .map_err(|e| e.to_string())?;
                    db::repository::users::create_admin(&pool, "admin", &hash)
                        .await
                        .map_err(|e| e.to_string())?;
                    println!("已创建默认管理员: admin / admin123");
                }
                Ok::<(), String>(())
            })?;

            // 创建 AppState（pool / lang_dir 后续建托盘还要用，这里 clone 保留所有权）
            let app_state = AppState::new(pool.clone(), storage, data_dir, lang_dir.clone());
            app.manage(app_state);

            // 启动时应用已保存的代理设置（system/none/custom）
            tauri::async_runtime::block_on(async {
                let state: tauri::State<AppState> = app.state();
                collector::http::apply_proxy_settings(&state).await;
            });

            // 系统托盘（左键单击显示窗口，右键菜单：显示 / 退出）
            // 文案按全局默认语言（ui_language）渲染，切换语言后由 set_ui_language 重建
            let tray_lang = tauri::async_runtime::block_on(async {
                db::repository::settings::get(&pool, "ui_language")
                    .await
                    .ok()
                    .flatten()
                    .filter(|v| !v.is_empty())
                    .unwrap_or_else(|| "zh-CN".to_string())
            });
            let tray_menu = build_tray_menu(app.handle(), &lang_dir, &tray_lang)?;
            TrayIconBuilder::with_id(TRAY_ID)
                .icon(app.default_window_icon().ok_or("缺少应用图标")?.clone())
                .tooltip(i18n::tr(&lang_dir, &tray_lang, "app.name"))
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "tray_show" => show_main_window(app),
                    "tray_quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            // 开启"关闭最小化到托盘"时，拦截关闭改为隐藏窗口
            if let WindowEvent::CloseRequested { api, .. } = event {
                let to_tray = {
                    let app = window.app_handle();
                    let state = app.state::<AppState>();
                    tauri::async_runtime::block_on(async {
                        db::repository::settings::get(&state.db, "close_to_tray")
                            .await
                            .ok()
                            .flatten()
                            .map(|v| v == "1")
                            .unwrap_or(false)
                    })
                };
                if to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            // auth
            commands::auth::auth_login,
            commands::auth::auth_logout,
            commands::auth::auth_me,
            commands::auth::auth_register,
            commands::auth::auth_update_profile,
            commands::auth::auth_change_username,
            commands::auth::auth_upload_avatar,
            commands::auth::auth_upload_avatar_bytes,
            commands::auth::auth_change_password,
            // users（管理）
            commands::users::list_users,
            commands::users::list_users_page,
            commands::users::list_authors,
            commands::users::list_authors_page,
            commands::users::admin_set_user_avatar,
            commands::users::create_user,
            commands::users::delete_users,
            commands::users::reset_user_password,
            commands::users::update_user,
            // resources
            commands::resources::list_resources,
            commands::resources::get_resource,
            commands::resources::create_resource,
            commands::resources::update_resource,
            commands::resources::batch_update_resources,
            commands::resources::delete_resource,
            commands::resources::restore_resource,
            commands::resources::permanent_delete_resource,
            commands::resources::list_trash_resources,
            commands::resources::list_trash_resources_page,
            commands::resources::check_resource_access,
            commands::resources::upload_resource_file,
            // images
            commands::images::list_resource_images,
            commands::images::upload_resource_image,
            commands::images::delete_resource_image,
            commands::images::reorder_resource_images,
            commands::images::set_resource_thumbnail,
            commands::images::clear_resource_thumbnail,
            commands::images::list_collection_images,
            commands::images::upload_collection_image,
            commands::images::delete_collection_image,
            commands::images::reorder_collection_images,
            // tags
            commands::tags::list_tags,
            commands::tags::list_tags_page,
            commands::tags::create_tag,
            commands::tags::rename_tag,
            commands::tags::delete_tag,
            commands::tags::merge_tags,
            // collections
            commands::collections::list_collections,
            commands::collections::list_collections_page,
            commands::collections::get_collection,
            commands::collections::check_collection_access,
            commands::collections::create_collection,
            commands::collections::update_collection,
            commands::collections::delete_collection,
            commands::collections::restore_collection,
            commands::collections::permanent_delete_collection,
            commands::collections::sync_collection_resources,
            // settings
            commands::settings::get_public_settings,
            commands::settings::get_settings,
            commands::settings::update_settings,
            commands::settings::get_upload_base_dir,
            commands::settings::upload_logo,
            commands::settings::clear_logo,
            // translate（翻译：OpenAI 兼容接口）
            commands::translate::translate_text,
            commands::translate::translate_test,
            commands::translate::translate_options,
            commands::translate::get_translate_config,
            commands::translate::translate_cancel,
            commands::translate::translate_fetch_models,
            // categories（树形分类）
            commands::categories::list_categories,
            commands::categories::list_categories_flat,
            commands::categories::create_category,
            commands::categories::update_category,
            commands::categories::delete_category,
            commands::categories::restore_category,
            commands::categories::permanent_delete_category,
            commands::categories::save_category_order,
            // torrent
            commands::torrent::get_resource_files,
            commands::torrent::save_resource_files,
            commands::torrent::parse_torrent_file,
            commands::torrent::fetch_torrent,
            commands::torrent::get_fetch_status,
            commands::torrent::check_resource_files,
            commands::torrent::reveal_file_in_explorer,
            commands::torrent::open_file_with_default,
            // cleanup（附件清理）
            commands::cleanup::scan_orphan_files,
            commands::cleanup::delete_orphan_files,
            // collector（网页采集）
            collector::fetch::fetch_webpage,
            collector::plugin::list_collectors,
            collector::plugin::import_collector,
            collector::image::collector_set_thumbnail,
            collector::image::collector_add_images,
            collector::image::download_remote_image,
            commands::settings::get_proxy_status,
            commands::settings::open_external_url,
            // i18n（语言包与切换）
            commands::i18n::list_languages,
            commands::i18n::get_language,
            commands::i18n::get_lang_dir,
            commands::i18n::set_ui_language,
            commands::i18n::open_lang_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
