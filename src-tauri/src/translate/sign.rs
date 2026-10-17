// 机器翻译厂商的请求签名
//
// 百度与腾讯用的是两套完全不同的机制，且都不打算引 SDK，所以这里按官方文档手写一遍：
//   · 百度：sign = MD5(appid + q + salt + 密钥)，32 位小写
//   · 腾讯云：TC3-HMAC-SHA256（腾讯云 API 3.0 统一签名），Authorization 头里带 4 段信息
//
// 签名算错的表现通常是一句含糊的「签名错误 / 鉴权失败」，很难反查，
// 所以两套算法都配了**用 Python 的 hashlib/hmac 独立算出的期望值**做回归测试。
use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use md5::{Digest, Md5};
use sha2::Sha256;

/// 字节数组 → 小写十六进制串
pub fn hex(bytes: &[u8]) -> String {
    const TABLE: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(TABLE[(b >> 4) as usize] as char);
        s.push(TABLE[(b & 0x0f) as usize] as char);
    }
    s
}

fn sha256_hex(data: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(data);
    hex(&h.finalize())
}

/// HMAC-SHA256(key, msg) 的原始字节。
/// 用法上容易被 key/msg 的顺序绊住：**参数顺序是 key 在前、消息在后**。
fn hmac_sha256(key: &[u8], msg: &str) -> Vec<u8> {
    let mut mac = Hmac::<Sha256>::new_from_slice(key).expect("HMAC 接受任意长度密钥");
    mac.update(msg.as_bytes());
    mac.finalize().into_bytes().to_vec()
}

/// 百度通用文本翻译签名：MD5(appid + q + salt + key)
///
/// ⚠ `q` 必须是**未做 URL 编码**的原文。先编码再签名是 54001「签名错误」的头号原因，
/// 百度官方 FAQ 专门点了这条。编码是发请求时才做的事（见 `mt::baidu`）。
pub fn baidu_sign(appid: &str, q: &str, salt: &str, secret: &str) -> String {
    let mut h = Md5::new();
    h.update(format!("{appid}{q}{salt}{secret}").as_bytes());
    hex(&h.finalize())
}

/// 腾讯云签名需要的全部要素，避免调用处塞十个参数
pub struct Tc3Request<'a> {
    pub secret_id: &'a str,
    pub secret_key: &'a str,
    /// 产品名，机器翻译固定为 `tmt`
    pub service: &'a str,
    /// 请求域名，参与签名，必须与实际请求头一致
    pub host: &'a str,
    /// **实际发送的 body 原文**（GET 之类无 body 时传空串）
    pub payload: &'a str,
    /// Unix 秒。签名与请求头里的 X-TC-Timestamp 必须是同一个值
    pub timestamp: i64,
}

/// 腾讯云 TC3-HMAC-SHA256 签名，返回可直接放进 `Authorization` 头的整串。
///
/// 官方五步：拼规范请求串 → 拼待签字符串 → 逐级派生密钥（日期 → 服务 → tc3_request）
/// → 计算签名 → 拼 Authorization。任何一处顺序或分隔符写错都会得到「鉴权失败」。
///
/// 注意**地域不进签名**：它只放在 `X-TC-Region` 头里，参与签名的头只有 content-type 与 host。
/// 很多人以为地域要签进去，反而把签名改错。
pub fn tc3_authorization(req: &Tc3Request<'_>) -> String {
    // 日期必须由时间戳推出，不能用「当前时间」——跨零点时会与 X-TC-Timestamp 不一致
    let date = DateTime::from_timestamp(req.timestamp, 0)
        .unwrap_or_else(Utc::now)
        .format("%Y-%m-%d")
        .to_string();

    const CONTENT_TYPE: &str = "application/json; charset=utf-8";
    const SIGNED_HEADERS: &str = "content-type;host";

    // 1) 规范请求串
    let canonical_headers = format!("content-type:{CONTENT_TYPE}\nhost:{}\n", req.host);
    let canonical_request = format!(
        "POST\n/\n\n{canonical_headers}\n{SIGNED_HEADERS}\n{}",
        sha256_hex(req.payload.as_bytes())
    );

    // 2) 待签字符串
    let credential_scope = format!("{date}/{}/tc3_request", req.service);
    let string_to_sign = format!(
        "TC3-HMAC-SHA256\n{}\n{credential_scope}\n{}",
        req.timestamp,
        sha256_hex(canonical_request.as_bytes())
    );

    // 3) 逐级派生签名密钥：TC3+SecretKey → 日期 → 服务 → tc3_request
    let secret_date = hmac_sha256(format!("TC3{}", req.secret_key).as_bytes(), &date);
    let secret_service = hmac_sha256(&secret_date, req.service);
    let secret_signing = hmac_sha256(&secret_service, "tc3_request");

    // 4) 计算签名
    let signature = hex(&hmac_sha256(&secret_signing, &string_to_sign));

    // 5) 拼 Authorization
    format!(
        "TC3-HMAC-SHA256 Credential={}/{credential_scope}, SignedHeaders={SIGNED_HEADERS}, Signature={signature}",
        req.secret_id
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_encodes_lowercase_and_pads() {
        assert_eq!(hex(&[0x00, 0x0f, 0xa0, 0xff]), "000fa0ff");
        assert_eq!(hex(&[]), "");
    }

    #[test]
    fn baidu_sign_matches_reference_md5() {
        // 期望值由 Python 独立算出：
        // hashlib.md5(("2015063000000001" + "apple" + "1435660288" + "12345678").encode()).hexdigest()
        let got = baidu_sign("2015063000000001", "apple", "1435660288", "12345678");
        assert_eq!(got, "f89f9594663708c1605f3d736d01d2d4");
        // 百度要求 32 位小写十六进制
        assert_eq!(got.len(), 32);
        assert!(got.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }

    #[test]
    fn baidu_sign_is_sensitive_to_every_part() {
        let base = baidu_sign("app", "你好", "1", "key");
        assert_ne!(base, baidu_sign("app", "你好", "2", "key")); // 盐变了
        assert_ne!(base, baidu_sign("app", "你好", "1", "key2")); // 密钥变了
        assert_ne!(base, baidu_sign("app", "您 好", "1", "key")); // 文本变了（含空格差异）
    }

    #[test]
    fn tc3_matches_reference_implementation() {
        // 固定输入（含时间戳），整串期望值由 Python 的 hmac/hashlib 独立算出。
        // 只要密钥派生顺序、规范请求串的换行位置、签名头拼接任一处写错，这里就会红。
        let auth = tc3_authorization(&Tc3Request {
            secret_id: "AKIDEXAMPLE",
            secret_key: "SECRETKEYEXAMPLE",
            service: "tmt",
            host: "tmt.tencentcloudapi.com",
            payload: "{\"SourceText\":\"hello\",\"Source\":\"auto\",\"Target\":\"zh\",\"ProjectId\":0}",
            timestamp: 1_700_000_000,
        });
        assert_eq!(
            auth,
            "TC3-HMAC-SHA256 Credential=AKIDEXAMPLE/2023-11-14/tmt/tc3_request, \
             SignedHeaders=content-type;host, \
             Signature=fbd40b187f04c643f7f5f4ddf4f38006bf61baf68bc3aa5ea9ba62bef9cfed60"
        );
    }

    #[test]
    fn tc3_date_follows_timestamp_not_clock() {
        // 用时间戳推日期：UTC 1970-01-01/1970-01-02 的边界必须体现在 Credential 里
        let day1 = tc3_authorization(&Tc3Request {
            secret_id: "id",
            secret_key: "k",
            service: "tmt",
            host: "h",
            payload: "{}",
            timestamp: 0,
        });
        let day2 = tc3_authorization(&Tc3Request {
            secret_id: "id",
            secret_key: "k",
            service: "tmt",
            host: "h",
            payload: "{}",
            timestamp: 86_400,
        });
        assert!(day1.contains("/1970-01-01/tmt/tc3_request"));
        assert!(day2.contains("/1970-01-02/tmt/tc3_request"));
        assert_ne!(day1, day2);
    }

    #[test]
    fn tc3_changes_with_payload_and_secret() {
        let mk = |payload: &'static str, key: &'static str| {
            tc3_authorization(&Tc3Request {
                secret_id: "id",
                secret_key: key,
                service: "tmt",
                host: "tmt.tencentcloudapi.com",
                payload,
                timestamp: 1_700_000_000,
            })
        };
        assert_ne!(mk("{}", "k"), mk("{\"a\":1}", "k"));
        assert_ne!(mk("{}", "k"), mk("{}", "k2"));
    }
}
