// 分类 Repository：树形结构，通过 parent_id 实现多级子分类
use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::error::AppError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Category {
    pub id: i64,
    pub parent_id: Option<i64>,
    pub name: String,
    pub slug: String,
    pub description: String,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    #[serde(default)]
    pub resource_count: i64,
    #[serde(default)]
    pub children: Vec<Category>,
}

/// 扁平结构（用于下拉选择）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategoryFlat {
    pub id: i64,
    pub parent_id: Option<i64>,
    pub name: String,
    pub slug: String,
    pub description: String,
    pub sort_order: i64,
    pub level: i64,  // 层级深度，0=顶级
    #[serde(default)]
    pub resource_count: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateCategory {
    pub parent_id: Option<i64>,
    pub name: String,
    pub slug: Option<String>,
    pub description: Option<String>,
    pub sort_order: Option<i64>,
}

/// 查询所有未删除分类（含资源计数），返回扁平列表
async fn list_all(pool: &SqlitePool) -> Result<Vec<Category>, AppError> {
    let rows = sqlx::query_as::<
        _,
        (i64, Option<i64>, String, String, String, i64, String, String, Option<String>, i64),
    >(
        // 计数必须 JOIN resources 并排除软删：资源移入回收站时只是置 deleted_at，
        // resource_categories 的关联行仍然保留，不 Join 会把回收站里的文章也算进来
        "SELECT c.id, c.parent_id, c.name, c.slug, c.description, c.sort_order, \
         c.created_at, c.updated_at, c.deleted_at, \
         (SELECT COUNT(*) FROM resource_categories rc \
          JOIN resources r ON r.id = rc.resource_id AND r.deleted_at IS NULL \
          WHERE rc.category_id = c.id) as resource_count \
         FROM categories c WHERE c.deleted_at IS NULL ORDER BY c.sort_order, c.id",
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|(id, parent_id, name, slug, description, sort_order, created_at, updated_at, deleted_at, resource_count)| Category {
            id, parent_id, name, slug, description, sort_order, created_at, updated_at, deleted_at, resource_count, children: vec![],
        })
        .collect())
}

/// 查询树形结构（在 Rust 中组装）
pub async fn list_tree(pool: &SqlitePool) -> Result<Vec<Category>, AppError> {
    let all = list_all(pool).await?;
    Ok(build_tree(all))
}

/// 查询扁平列表（带层级深度）
pub async fn list_flat(pool: &SqlitePool) -> Result<Vec<CategoryFlat>, AppError> {
    let all = list_all(pool).await?;
    Ok(flatten_with_level(all))
}

/// 创建分类
pub async fn create(pool: &SqlitePool, payload: &CreateCategory) -> Result<i64, AppError> {
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let slug = payload.slug.clone().unwrap_or_default();
    let description = payload.description.clone().unwrap_or_default();
    // 未显式指定序号时，排在同级末尾
    let sort_order = match payload.sort_order {
        Some(v) => v,
        None => {
            let row: (Option<i64>,) =
                sqlx::query_as("SELECT MAX(sort_order) + 1 FROM categories WHERE parent_id IS ? AND deleted_at IS NULL")
                    .bind(payload.parent_id)
                    .fetch_one(pool)
                    .await?;
            row.0.unwrap_or(0)
        }
    };

    let result = sqlx::query(
        "INSERT INTO categories (parent_id, name, slug, description, sort_order, created_at, updated_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(payload.parent_id)
    .bind(&payload.name)
    .bind(&slug)
    .bind(&description)
    .bind(sort_order)
    .bind(&now)
    .bind(&now)
    .execute(pool)
    .await?;
    Ok(result.last_insert_rowid())
}

/// 更新分类
pub async fn update(pool: &SqlitePool, cid: i64, payload: &CreateCategory) -> Result<(), AppError> {
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let slug = payload.slug.clone().unwrap_or_default();
    let description = payload.description.clone().unwrap_or_default();
    let sort_order = payload.sort_order.unwrap_or(0);

    sqlx::query(
        "UPDATE categories SET parent_id=?, name=?, slug=?, description=?, sort_order=?, updated_at=? \
         WHERE id=? AND deleted_at IS NULL",
    )
    .bind(payload.parent_id)
    .bind(&payload.name)
    .bind(&slug)
    .bind(&description)
    .bind(sort_order)
    .bind(&now)
    .bind(cid)
    .execute(pool)
    .await?;
    Ok(())
}

/// 软删除分类及其所有子分类（递归）
pub async fn delete(pool: &SqlitePool, cid: i64) -> Result<(), AppError> {
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    // 获取所有子分类 ID（递归）
    let ids = get_descendant_ids(pool, cid).await?;
    for id in ids {
        sqlx::query("UPDATE categories SET deleted_at=? WHERE id=?")
            .bind(&now)
            .bind(id)
            .execute(pool)
            .await?;
    }
    Ok(())
}

/// 恢复分类及其所有子分类
pub async fn restore(pool: &SqlitePool, cid: i64) -> Result<(), AppError> {
    let ids = get_descendant_ids_including_deleted(pool, cid).await?;
    for id in ids {
        sqlx::query("UPDATE categories SET deleted_at=NULL WHERE id=?")
            .bind(id)
            .execute(pool)
            .await?;
    }
    Ok(())
}

/// 永久删除
pub async fn permanent_delete(pool: &SqlitePool, cid: i64) -> Result<(), AppError> {
    let ids = get_descendant_ids(pool, cid).await?;
    for id in ids {
        sqlx::query("DELETE FROM categories WHERE id=?")
            .bind(id)
            .execute(pool)
            .await?;
    }
    Ok(())
}

/// 拖拽排序提交项：一个分类最终的父级与同级序号
#[derive(Debug, Clone, Deserialize)]
pub struct CategoryOrderItem {
    pub id: i64,
    pub parent_id: Option<i64>,
    pub sort_order: i64,
}

/// 批量保存分类树（拖拽排序 / 拖动变成子分类后提交全量结果）。
/// 一个事务内更新所有节点的 parent_id 与 sort_order，并做环检测。
pub async fn save_order(
    pool: &SqlitePool,
    items: Vec<CategoryOrderItem>,
) -> Result<(), AppError> {
    if items.is_empty() {
        return Ok(());
    }

    // 最终关系图：id -> parent_id
    let mut new_parent: HashMap<i64, Option<i64>> = HashMap::new();
    for it in &items {
        new_parent.insert(it.id, it.parent_id);
    }

    // 校验：父级必须存在，不能以自己为父，最终结构不能成环
    for it in &items {
        if let Some(pid) = it.parent_id {
            if pid == it.id {
                return Err(AppError::BadRequest("分类不能以自己为父级".to_string()));
            }
            if !new_parent.contains_key(&pid) {
                return Err(AppError::BadRequest(format!("父分类 {} 不存在", pid)));
            }
        }
        // 向上追溯父链，若回到自身则存在环
        let mut cur = it.parent_id;
        let mut steps = 0;
        while let Some(pid) = cur {
            if pid == it.id {
                return Err(AppError::BadRequest("检测到循环层级，已取消".to_string()));
            }
            cur = new_parent.get(&pid).copied().flatten();
            steps += 1;
            if steps > items.len() as i64 {
                return Err(AppError::BadRequest("检测到循环层级，已取消".to_string()));
            }
        }
    }

    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let mut tx = pool.begin().await?;
    for it in &items {
        sqlx::query(
            "UPDATE categories SET parent_id=?, sort_order=?, updated_at=? WHERE id=?",
        )
        .bind(it.parent_id)
        .bind(it.sort_order)
        .bind(&now)
        .bind(it.id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// 获取分类及其所有后代 ID（含自身，仅未删除）
async fn get_descendant_ids(pool: &SqlitePool, cid: i64) -> Result<Vec<i64>, AppError> {
    let mut result = vec![cid];
    let mut stack = vec![cid];
    while let Some(cur) = stack.pop() {
        let children: Vec<(i64,)> = sqlx::query_as(
            "SELECT id FROM categories WHERE parent_id=? AND deleted_at IS NULL",
        )
        .bind(cur)
        .fetch_all(pool)
        .await?;
        for (child_id,) in children {
            if !result.contains(&child_id) {
                result.push(child_id);
                stack.push(child_id);
            }
        }
    }
    Ok(result)
}

/// 获取分类及其所有后代 ID（含自身，包括已删除的）
async fn get_descendant_ids_including_deleted(pool: &SqlitePool, cid: i64) -> Result<Vec<i64>, AppError> {
    let mut result = vec![cid];
    let mut stack = vec![cid];
    while let Some(cur) = stack.pop() {
        let children: Vec<(i64,)> = sqlx::query_as(
            "SELECT id FROM categories WHERE parent_id=?",
        )
        .bind(cur)
        .fetch_all(pool)
        .await?;
        for (child_id,) in children {
            if !result.contains(&child_id) {
                result.push(child_id);
                stack.push(child_id);
            }
        }
    }
    Ok(result)
}

/// 将扁平列表组装成树形结构（与输入顺序无关）
fn build_tree(all: Vec<Category>) -> Vec<Category> {
    // 第一遍：建立 id → 节点 的索引
    let mut node_map: HashMap<i64, Category> = HashMap::new();
    for c in all {
        node_map.insert(c.id, c);
    }

    // 第二遍：收集每个父节点的子节点 id 列表
    let mut children_ids: HashMap<i64, Vec<i64>> = HashMap::new();
    for c in node_map.values() {
        if let Some(pid) = c.parent_id {
            children_ids.entry(pid).or_default().push(c.id);
        }
    }

    // 递归构建：按 sort_order 排序子节点
    fn build(
        node_map: &HashMap<i64, Category>,
        children_ids: &HashMap<i64, Vec<i64>>,
        id: i64,
    ) -> Category {
        let mut cat = node_map[&id].clone();
        if let Some(cids) = children_ids.get(&id) {
            let mut kids: Vec<Category> = cids.iter().map(|cid| build(node_map, children_ids, *cid)).collect();
            kids.sort_by_key(|c| c.sort_order);
            cat.children = kids;
        }
        cat
    }

    // 收集所有顶级节点并按 sort_order 排序
    let mut roots: Vec<Category> = node_map
        .values()
        .filter(|c| c.parent_id.is_none())
        .map(|c| build(&node_map, &children_ids, c.id))
        .collect();
    roots.sort_by_key(|c| c.sort_order);
    roots
}

/// 扁平化带层级深度（用于下拉选择，DFS 遍历）
fn flatten_with_level(tree: Vec<Category>) -> Vec<CategoryFlat> {
    let mut result = Vec::new();
    fn walk(cats: Vec<Category>, level: i64, result: &mut Vec<CategoryFlat>) {
        for mut c in cats {
            let children = std::mem::take(&mut c.children);
            result.push(CategoryFlat {
                id: c.id,
                parent_id: c.parent_id,
                name: c.name,
                slug: c.slug,
                description: c.description,
                sort_order: c.sort_order,
                level,
                resource_count: c.resource_count,
            });
            walk(children, level + 1, result);
        }
    }
    walk(tree, 0, &mut result);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repository::testkit::*;

    /// 读取分类对外暴露的文章计数（与导航栏走的是同一条查询）
    async fn resource_count_of(pool: &SqlitePool, cid: i64) -> i64 {
        list_all(pool)
            .await
            .expect("查分类")
            .into_iter()
            .find(|c| c.id == cid)
            .map(|c| c.resource_count)
            .expect("分类应存在")
    }

    /// 回归：删除文章（移入回收站）后分类计数必须立刻减少。
    /// 曾经的写法是 `COUNT(*) FROM resource_categories WHERE category_id = ?`，
    /// 而软删只置 resources.deleted_at、不清关联行，于是计数一直停在旧值。
    #[tokio::test]
    async fn count_ignores_soft_deleted_resources() {
        let pool = memory_pool().await;
        let cat = insert_category(&pool, "分类A").await;
        let r1 = insert_resource(&pool, "文章1").await;
        let r2 = insert_resource(&pool, "文章2").await;
        attach_category(&pool, r1, cat).await;
        attach_category(&pool, r2, cat).await;
        assert_eq!(resource_count_of(&pool, cat).await, 2);

        // 移入回收站：计数立刻减一，而不是等彻底删除
        soft_delete_resource(&pool, r1).await;
        assert_eq!(resource_count_of(&pool, cat).await, 1);

        // 恢复：加回来
        restore_resource(&pool, r1).await;
        assert_eq!(resource_count_of(&pool, cat).await, 2);

        // 彻底删除：外键级联清掉关联行，计数仍是 1
        soft_delete_resource(&pool, r1).await;
        hard_delete_resource(&pool, r1).await;
        assert_eq!(resource_count_of(&pool, cat).await, 1);
    }

    /// 把上一条测试的成因固定下来：软删**不会**清理关联行。
    /// 如果哪天有人「优化」掉计数子查询里的 Join resources，上一条测试会红，这里解释了原因。
    #[tokio::test]
    async fn soft_delete_keeps_relation_row() {
        let pool = memory_pool().await;
        let cat = insert_category(&pool, "分类A").await;
        let r1 = insert_resource(&pool, "文章1").await;
        attach_category(&pool, r1, cat).await;

        soft_delete_resource(&pool, r1).await;
        assert_eq!(
            category_relation_rows(&pool).await,
            1,
            "软删只置 deleted_at，关联行仍在，所以计数必须靠 Join resources 过滤"
        );
    }

    /// 无关联文章的分类计数为 0，且不受别的分类影响
    #[tokio::test]
    async fn count_is_per_category() {
        let pool = memory_pool().await;
        let a = insert_category(&pool, "分类A").await;
        let b = insert_category(&pool, "分类B").await;
        let r1 = insert_resource(&pool, "文章1").await;
        attach_category(&pool, r1, a).await;

        assert_eq!(resource_count_of(&pool, a).await, 1);
        assert_eq!(resource_count_of(&pool, b).await, 0);
    }
}
