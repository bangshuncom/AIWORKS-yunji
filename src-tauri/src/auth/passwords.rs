// argon2 密码哈希与校验
use argon2::password_hash::{
    rand_core::OsRng,
    PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
};
use argon2::Argon2;

use crate::error::AppError;

pub fn hash_password(password: &str) -> Result<String, AppError> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    let hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| AppError::Storage(anyhow::anyhow!("密码哈希失败: {}", e)))?;
    Ok(hash.to_string())
}

/// 访问密码落库：空串表示「不设密码」，非空则存 argon2 哈希。
/// （编辑场景里「留空」意味着「不修改原密码」，该语义由 repository 层区分处理）
pub fn hash_access_password(password: &str) -> Result<String, AppError> {
    if password.is_empty() {
        return Ok(String::new());
    }
    hash_password(password)
}

pub fn verify_password(password: &str, hash: &str) -> Result<bool, AppError> {
    let parsed_hash = PasswordHash::new(hash)
        .map_err(|e| AppError::Storage(anyhow::anyhow!("密码哈希解析失败: {}", e)))?;
    Ok(Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok())
}
