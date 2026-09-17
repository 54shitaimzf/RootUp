//! 智能解压命令（0.8.8）：zip 解压到独立文件夹，纳入索引 / 分类 / 归档链路。
//!
//! 安全边界（core/extract.rs）：路径穿越 / 解压炸弹 / 条目数上限三道防线，
//! 先整体校验后落盘（两阶段）。错误码 extract.not_archive / path_traversal /
//! bomb_suspected / too_many_entries / failed。
use crate::core::archive::unique_dest;
use crate::core::error_codes::{coded, EXTRACT_FAILED};
use crate::core::extract::{
    is_supported_archive, not_archive_error, plan_extract, safe_entry_components, ZipEntryMeta,
};
use crate::core::path::normalize_path;
use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// 解压结果：dest 为独立目标文件夹（含冲突改名），files 为落盘文件数。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractOutcome {
    pub dest: String,
    pub files: usize,
}

/// 解压到压缩包同级的独立文件夹（`<stem>/`），并入队扫描接入索引链路。
#[tauri::command]
pub fn extract_archive(app: AppHandle, path: String) -> Result<ExtractOutcome, String> {
    let path = normalize_path(&path);
    let source = Path::new(&path);
    if !source.is_file() {
        return Err(format!("文件不存在: {path}"));
    }
    if !is_supported_archive(&path) {
        return Err(not_archive_error(&path));
    }
    // 独立目标文件夹：<parent>/<stem>/，冲突时追加序号
    let stem = source
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "extracted".to_string());
    let parent = source.parent().ok_or("压缩包缺少父目录")?;
    let dest = unique_dest(&parent.join(&stem))?;
    let files = extract_zip_to(source, &dest)?;

    // 接入索引链路：解压目录入队扫描（watcher 亦会实时跟踪增量）
    if let Some(service) = app.try_state::<Mutex<crate::infra::scanner::ScanService>>() {
        if let Ok(scanner) = service.lock() {
            scanner.enqueue(dest.to_string_lossy().into_owned());
        }
    }
    // 变更日志追溯（复用 action_log；失败不阻断解压结果）
    crate::commands::archive::log_action(
        &app,
        "extract",
        &format!("count={files}; dest={}", dest.to_string_lossy()),
        None,
    );
    log::info!("extract: {path} -> {} files={files}", dest.display());
    Ok(ExtractOutcome {
        dest: normalize_path(&dest.to_string_lossy()),
        files,
    })
}

/// 两阶段解压执行（可单测）：清单校验 → 按计划落盘；返回落盘文件数。
fn extract_zip_to(source: &Path, dest: &Path) -> Result<usize, String> {
    let file = std::fs::File::open(source)
        .map_err(|e| coded(EXTRACT_FAILED, format!("打开压缩包失败: {e}")))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| coded(EXTRACT_FAILED, format!("读取压缩包失败: {e}")))?;

    // 第一阶段：条目清单整体过安全边界（路径穿越 / 炸弹 / 条目数）
    let mut metas: Vec<ZipEntryMeta> = Vec::with_capacity(archive.len());
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|e| coded(EXTRACT_FAILED, format!("读取条目失败: {e}")))?;
        metas.push(ZipEntryMeta {
            name: entry.name().to_string(),
            compressed_size: entry.compressed_size(),
            uncompressed_size: entry.size(),
            is_dir: entry.is_dir(),
        });
    }
    let plan = plan_extract(&metas)?;

    // 第二阶段：按计划落盘（安全分量已校验，逐条再走 safe_entry_components 构造路径）
    let mut extracted = 0usize;
    for meta in &plan.files {
        let components = safe_entry_components(&meta.name)
            .ok_or_else(|| coded(crate::core::error_codes::EXTRACT_PATH_TRAVERSAL, meta.name.clone()))?;
        let mut target = dest.to_path_buf();
        for component in &components {
            target.push(component);
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| coded(EXTRACT_FAILED, format!("创建目录失败: {e}")))?;
        }
        let mut reader = archive
            .by_name(&meta.name)
            .map_err(|e| coded(EXTRACT_FAILED, format!("读取条目失败: {e}")))?;
        let mut out = std::fs::File::create(&target)
            .map_err(|e| coded(EXTRACT_FAILED, format!("写入文件失败: {e}")))?;
        std::io::copy(&mut reader, &mut out)
            .map_err(|e| coded(EXTRACT_FAILED, format!("解压写入失败: {e}")))?;
        extracted += 1;
    }
    Ok(extracted)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir =
            std::env::temp_dir().join(format!("rootup_extract_{tag}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_zip(path: &Path, entries: &[(&str, &str)]) {
        let file = std::fs::File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options: zip::write::SimpleFileOptions = Default::default();
        for (name, content) in entries {
            zip.start_file(*name, options).unwrap();
            zip.write_all(content.as_bytes()).unwrap();
        }
        zip.finish().unwrap();
    }

    #[test]
    fn extracts_into_dest_and_counts_files() {
        let dir = temp_dir("ok");
        let zip_path = dir.join("pack.zip");
        write_zip(&zip_path, &[("a.txt", "hello"), ("sub/b.txt", "world")]);
        let dest = dir.join("pack");
        let files = extract_zip_to(&zip_path, &dest).unwrap();
        assert_eq!(files, 2);
        assert_eq!(std::fs::read_to_string(dest.join("a.txt")).unwrap(), "hello");
        assert_eq!(
            std::fs::read_to_string(dest.join("sub").join("b.txt")).unwrap(),
            "world"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn traversal_entry_fails_whole_extraction() {
        let dir = temp_dir("evil");
        let zip_path = dir.join("evil.zip");
        // zip crate 会在写入端拒绝 `..`，这里以绝对路径条目模拟越界形态
        write_zip(&zip_path, &[("/abs/evil.txt", "x")]);
        let dest = dir.join("out");
        let err = extract_zip_to(&zip_path, &dest).unwrap_err();
        assert_eq!(
            crate::core::error_codes::code_of(&err),
            Some(crate::core::error_codes::EXTRACT_PATH_TRAVERSAL)
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_file_reports_extract_failed() {
        let dir = temp_dir("corrupt");
        let zip_path = dir.join("bad.zip");
        std::fs::write(&zip_path, b"not a zip").unwrap();
        let err = extract_zip_to(&zip_path, &dir.join("out")).unwrap_err();
        assert_eq!(
            crate::core::error_codes::code_of(&err),
            Some(EXTRACT_FAILED)
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
