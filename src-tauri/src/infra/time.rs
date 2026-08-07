//! 公共时间工具：所有 infra 模块统一从这里取 Unix 毫秒时间戳。
use std::time::{SystemTime, UNIX_EPOCH};

/// 当前 Unix 毫秒时间戳（系统时钟异常时回退 0）。
pub fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
