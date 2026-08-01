//! 日志契约：业务模块只依赖本契约，不依赖具体落盘实现。

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

/// 日志写入契约：实现方决定落盘方式（文件、终端、远程等）。
#[cfg_attr(not(test), allow(dead_code))]
pub trait LogSink: Send + Sync {
    fn write(&self, record: LogRecord);
}
