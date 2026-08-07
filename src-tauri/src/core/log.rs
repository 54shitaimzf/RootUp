//! 日志模型：业务模块经 `log` facade 写入，落盘由 `infra::logging` 实现。

use std::time::{SystemTime, UNIX_EPOCH};

/// 日志级别。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum LogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

impl LogLevel {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Debug => "DEBUG",
            Self::Info => "INFO",
            Self::Warn => "WARN",
            Self::Error => "ERROR",
        }
    }
}

/// 单条日志记录。
#[derive(Debug, Clone)]
pub struct LogRecord {
    pub timestamp: i64,
    pub level: LogLevel,
    pub module: String,
    pub message: String,
}

impl LogRecord {
    pub fn new(level: LogLevel, module: &str, message: impl Into<String>) -> Self {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        Self {
            timestamp,
            level,
            module: module.to_string(),
            message: message.into(),
        }
    }
}
