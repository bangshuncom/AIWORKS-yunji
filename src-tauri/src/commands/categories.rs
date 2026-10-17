// 分类相关命令（树形多级子分类）
use tauri::State;

use crate::auth::{require_feature, FEATURE_ARTICLE};
use crate::db::repository;
use crate::db::repository::categories::{Category, CategoryFlat, CategoryOrderItem, CreateCategory};
use crate::error::CmdResult;
use crate::state::AppState;

/// 获取分类树（含子分类）
#[tauri::command]
pub async fn list_categories(state: State<'_, AppState>) -> CmdResult<Vec<Category>> {
    Ok(repository::categories::list_tree(&state.db).await?)
}

/// 获取扁平列表（带层级深度，用于下拉选择）
#[tauri::command]
pub async fn list_categories_flat(state: State<'_, AppState>) -> CmdResult<Vec<CategoryFlat>> {
    Ok(repository::categories::list_flat(&state.db).await?)
}

/// 创建分类
#[tauri::command]
pub async fn create_category(
    state: State<'_, AppState>,
    payload: CreateCategory,
) -> CmdResult<i64> {
    let _user = require_feature(&state.db, &state.auth, FEATURE_ARTICLE).await?;
    Ok(repository::categories::create(&state.db, &payload).await?)
}

/// 更新分类
#[tauri::command]
pub async fn update_category(
    state: State<'_, AppState>,
    cid: i64,
    payload: CreateCategory,
) -> CmdResult<()> {
    let _user = require_feature(&state.db, &state.auth, FEATURE_ARTICLE).await?;
    repository::categories::update(&state.db, cid, &payload).await?;
    Ok(())
}

/// 软删除分类（含子分类）
#[tauri::command]
pub async fn delete_category(state: State<'_, AppState>, cid: i64) -> CmdResult<()> {
    let _user = require_feature(&state.db, &state.auth, FEATURE_ARTICLE).await?;
    repository::categories::delete(&state.db, cid).await?;
    Ok(())
}

/// 恢复分类
#[tauri::command]
pub async fn restore_category(state: State<'_, AppState>, cid: i64) -> CmdResult<()> {
    let _user = require_feature(&state.db, &state.auth, FEATURE_ARTICLE).await?;
    repository::categories::restore(&state.db, cid).await?;
    Ok(())
}

/// 永久删除分类
#[tauri::command]
pub async fn permanent_delete_category(state: State<'_, AppState>, cid: i64) -> CmdResult<()> {
    let _user = require_feature(&state.db, &state.auth, FEATURE_ARTICLE).await?;
    repository::categories::permanent_delete(&state.db, cid).await?;
    Ok(())
}

/// 批量保存分类树（拖拽排序 / 拖动变成子分类）
#[tauri::command]
pub async fn save_category_order(
    state: State<'_, AppState>,
    items: Vec<CategoryOrderItem>,
) -> CmdResult<()> {
    let _user = require_feature(&state.db, &state.auth, FEATURE_ARTICLE).await?;
    repository::categories::save_order(&state.db, items).await?;
    Ok(())
}
