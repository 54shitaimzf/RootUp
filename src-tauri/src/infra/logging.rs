//! 文件日志实现：滚动写入 + debug 终端镜像。
//!
//! 业务模块统一使用 `log` crate facade（`log::info!` 等）或
//! [`LogSink`](crate::core::log::LogSink) 契约写入，不依赖本实现。

use crate::core::log::{LogLevel, LogRecord};
use log::{Level, LevelFilter, Metadata, Record};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const LOG_FILE_NAME: &str = "rootup.log";
const MAX_ROTATED_FILES: u32 = 3;
const DEFAULT_MAX_BYTES: u64 = 1024 * 1024;

struct LogInner {
    file: Option<File>,
    bytes: u64,
}

/// 文件日志器。
pub struct FileLogger {
    dir: PathBuf,
    min_level: LevelFilter,
    max_bytes: u64,
    mirror_to_terminal: bool,
    inner: Mutex<LogInner>,
}

impl FileLogger {
    /// 初始化：创建日志目录并打开当前日志文件（默认上限 1MB）。
    pub fn init(dir: impl AsRef<Path>, min_level: LevelFilter) -> Result<Self, String> {
        Self::with_max(dir, min_level, DEFAULT_MAX_BYTES)
    }

    /// 初始化并指定单文件大小上限（测试可传入小值验证滚动）。
    pub fn with_max(
        dir: impl AsRef<Path>,
        min_level: LevelFilter,
        max_bytes: u64,
    ) -> Result<Self, String> {
        let dir = dir.as_ref().to_path_buf();
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let file = Self::open_current(&dir)?;
        Ok(Self {
            dir,
            min_level,
            max_bytes,
            mirror_to_terminal: cfg!(debug_assertions),
            inner: Mutex::new(LogInner { file, bytes: 0 }),
        })
    }

    fn open_current(dir: &Path) -> Result<Option<File>, String> {
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join(LOG_FILE_NAME))
            .map(Some)
            .map_err(|e| e.to_string())
    }

    /// 写入一条记录（两条入口共用）。
    fn write_record(&self, record: LogRecord) {
        let line = format!(
            "{} [{}] {} {}\n",
            format_timestamp(record.timestamp),
            record.level.as_str(),
            record.module,
            record.message
        );
        if self.mirror_to_terminal {
            eprint!("{}", line);
        }

        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if inner.bytes + line.len() as u64 >= self.max_bytes {
            self.rotate_locked(&mut inner);
            inner.bytes = 0;
        }
        if let Some(file) = inner.file.as_mut() {
            let _ = file.write_all(line.as_bytes());
            let _ = file.flush();
        }
        inner.bytes += line.len() as u64;
    }

    /// 滚动：`rootup.log.3` 删除，`.2→.3`、`.1→.2`、当前→`.1`，再开新文件。
    fn rotate_locked(&self, inner: &mut LogInner) {
        let _ = fs::remove_file(
            self.dir
                .join(format!("{LOG_FILE_NAME}.{MAX_ROTATED_FILES}")),
        );
        for i in (1..MAX_ROTATED_FILES).rev() {
            let from = self.dir.join(format!("{LOG_FILE_NAME}.{i}"));
            let to = self.dir.join(format!("{LOG_FILE_NAME}.{}", i + 1));
            if from.exists() {
                let _ = fs::rename(from, to);
            }
        }
        let current = self.dir.join(LOG_FILE_NAME);
        let _ = fs::rename(&current, self.dir.join(format!("{LOG_FILE_NAME}.1")));
        inner.file = Self::open_current(&self.dir).ok().flatten();
    }
}

impl crate::core::log::LogSink for FileLogger {
    fn write(&self, record: LogRecord) {
        self.write_record(record);
    }
}

impl log::Log for FileLogger {
    fn enabled(&self, metadata: &Metadata<'_>) -> bool {
        metadata.level() <= self.min_level
    }

    fn log(&self, record: &Record<'_>) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let level = match record.level() {
            Level::Error => LogLevel::Error,
            Level::Warn => LogLevel::Warn,
            Level::Info => LogLevel::Info,
            Level::Debug | Level::Trace => LogLevel::Debug,
        };
        let module = record.module_path().unwrap_or("rootup").to_string();
        self.write_record(LogRecord::new(level, &module, record.args().to_string()));
    }

    fn flush(&self) {
        if let Ok(inner) = self.inner.lock() {
            if let Some(file) = inner.file.as_ref() {
                let _ = file.sync_all();
            }
        }
    }
}

/// 毫秒时间戳 → UTC 可读时间（无第三方依赖）。
fn format_timestamp(ms: i64) -> String {
    let days = ms.div_euclid(86_400_000);
    let rem = ms.rem_euclid(86_400_000);
    let (year, month, day) = civil_from_days(days);
    let hour = rem / 3_600_000;
    let minute = (rem % 3_600_000) / 60_000;
    let second = (rem % 60_000) / 1_000;
    let milli = rem % 1_000;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{milli:03}Z")
}

/// 儒略日 → 公历（Howard Hinnant 算法）。
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    (
        if month <= 2 { year + 1 } else { year },
        month as u32,
        day as u32,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use log::Log;
    use std::fs;

    fn temp_dir(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("rootup_log_test_{tag}_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn timestamp_formatting() {
        assert_eq!(format_timestamp(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(
            format_timestamp(1_577_836_800_000),
            "2020-01-01T00:00:00.000Z"
        );
        assert_eq!(
            format_timestamp(1_577_836_801_234),
            "2020-01-01T00:00:01.234Z"
        );
    }

    #[test]
    fn writes_formatted_lines() {
        let dir = temp_dir("write");
        let logger = FileLogger::init(&dir, LevelFilter::Info).unwrap();
        logger.write_record(LogRecord::new(LogLevel::Info, "test", "hello log"));
        let content = fs::read_to_string(dir.join(LOG_FILE_NAME)).unwrap();
        assert!(content.contains("[INFO] test hello log"));
        assert!(content.starts_with("20") || content.starts_with("19"));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn level_filter_works() {
        let dir = temp_dir("filter");
        let logger = FileLogger::init(&dir, LevelFilter::Warn).unwrap();
        let info = Record::builder()
            .args(format_args!("x"))
            .level(Level::Info)
            .target("t")
            .build();
        let error = Record::builder()
            .args(format_args!("boom"))
            .level(Level::Error)
            .target("t")
            .build();
        assert!(!logger.enabled(info.metadata()));
        assert!(logger.enabled(error.metadata()));
        logger.log(&info);
        logger.log(&error);
        let content = fs::read_to_string(dir.join(LOG_FILE_NAME)).unwrap();
        assert!(!content.contains("x"));
        assert!(content.contains("boom"));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rotates_when_exceeding_max() {
        let dir = temp_dir("rotate");
        let logger = FileLogger::with_max(&dir, LevelFilter::Debug, 200).unwrap();
        // 每条约 40–50 字节，写 10 条必然超过 200 字节触发滚动
        for i in 0..10 {
            logger.write_record(LogRecord::new(
                LogLevel::Info,
                "test",
                format!("message number {i} padding padding"),
            ));
        }
        assert!(dir.join(LOG_FILE_NAME).exists());
        assert!(dir.join("rootup.log.1").exists(), "应产生滚动文件");
        let newest = fs::read_to_string(dir.join(LOG_FILE_NAME)).unwrap();
        assert!(newest.contains("message number"));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn log_sink_entry() {
        let dir = temp_dir("sink");
        let logger = FileLogger::init(&dir, LevelFilter::Debug).unwrap();
        let sink: &dyn crate::core::log::LogSink = &logger;
        sink.write(LogRecord::new(LogLevel::Error, "sink", "via trait"));
        let content = fs::read_to_string(dir.join(LOG_FILE_NAME)).unwrap();
        assert!(content.contains("[ERROR] sink via trait"));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rotation_chain_keeps_three_and_drops_oldest() {
        let dir = temp_dir("chain");
        let logger = FileLogger::with_max(&dir, LevelFilter::Debug, 200).unwrap();
        // 6 轮 × 5 条（每条约 50B）→ 至少触发 5 次滚动，足以填满 .1/.2/.3
        for round in 0..6 {
            for _ in 0..5 {
                logger.write_record(LogRecord::new(
                    LogLevel::Info,
                    "t",
                    format!("round{round} {:40}", "x"),
                ));
            }
        }
        let current = fs::read_to_string(dir.join(LOG_FILE_NAME)).unwrap();
        let r1 = fs::read_to_string(dir.join("rootup.log.1")).unwrap();
        let r2 = fs::read_to_string(dir.join("rootup.log.2")).unwrap();
        let r3 = fs::read_to_string(dir.join("rootup.log.3")).unwrap();
        assert!(current.contains("round5"), "最新记录应在当前文件");
        assert!(r1.contains("round5"), ".1 应包含最近轮次");
        assert!(!r2.is_empty());
        assert!(!r3.is_empty());
        assert!(
            !dir.join("rootup.log.4").exists(),
            "超过 3 份的旧日志应被删除"
        );
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn chinese_and_multiline_messages() {
        let dir = temp_dir("unicode");
        let logger = FileLogger::init(&dir, LevelFilter::Debug).unwrap();
        logger.write_record(LogRecord::new(
            LogLevel::Warn,
            "测试模块",
            "中文消息\n第二行内容",
        ));
        let content = fs::read_to_string(dir.join(LOG_FILE_NAME)).unwrap();
        assert!(content.contains("中文消息"));
        assert!(content.contains("第二行内容"));
        assert!(content.contains("[WARN] 测试模块"));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn flush_via_log_trait_persists() {
        let dir = temp_dir("flush");
        let logger = FileLogger::init(&dir, LevelFilter::Debug).unwrap();
        logger.write_record(LogRecord::new(LogLevel::Info, "t", "before flush"));
        logger.flush();
        let content = fs::read_to_string(dir.join(LOG_FILE_NAME)).unwrap();
        assert!(content.contains("before flush"));
        fs::remove_dir_all(&dir).unwrap();
    }
}
