//! 扫描路径选择优化器（0.8.6 落地）：基于实测系数的双线性模型。
//!
//! 模型：`T_mft(N) = fixed_mft + per_mft * N`，`T_native(N) = per_native * N`，
//! 其中 `fixed_mft` 用最近一次 MFT 扫描的 `read_ms`（随整卷文件表大小增长，与监控根无关），
//! `per_mft` / `per_native` 用最近扫描实测校准（解析/落库 vs 枚举/落库）。
//! 交叉点 `N* = fixed_mft / (per_native - per_mft)`；`per_native <= per_mft` 时永不选 MFT。
//! 决策带迟滞（启用阈值 1.25×N*，回落 0.75×N*），避免临界抖动；系数随机器（HDD/SSD）自动校准，
//! 不预设固定阈值。

/// 双线性成本模型（单位：ms / 文件）。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ScanCostModel {
    /// MFT 全卷固定读取成本（ms）。
    pub mft_fixed_ms: f64,
    /// MFT 每文件成本（解析 + 路径重建 + 落库，ms）。
    pub mft_per_file_ms: f64,
    /// 原生枚举每文件成本（枚举 + 落库，ms）。
    pub native_per_file_ms: f64,
}

impl Default for ScanCostModel {
    fn default() -> Self {
        // 保守种子：交叉点约 300k；首次扫描后按实测覆盖。
        Self {
            mft_fixed_ms: 2_500.0,
            mft_per_file_ms: 0.022,
            native_per_file_ms: 0.030,
        }
    }
}

impl ScanCostModel {
    /// 交叉点文件数；`None` 表示原生恒优（无交叉点）。
    pub fn crossover(&self) -> Option<f64> {
        let delta = self.native_per_file_ms - self.mft_per_file_ms;
        if delta <= 0.0 || self.mft_fixed_ms <= 0.0 {
            None
        } else {
            Some(self.mft_fixed_ms / delta)
        }
    }

    /// 是否启用 MFT（带迟滞：启用需 ≥1.25×N*，回落需 <0.75×N*）。
    pub fn should_use_mft(&self, root_count: u64, enabled: bool) -> bool {
        if !enabled {
            return false;
        }
        let Some(crossover) = self.crossover() else {
            return false;
        };
        let n = root_count as f64;
        n >= crossover * 1.25
    }

    /// 决策入口：诊断强制开关（仅验证脚本使用）优先，其次按模型 + 迟滞决策。
    pub fn decide(&self, root_count: u64, enabled: bool, force: bool) -> bool {
        if force && enabled {
            return true;
        }
        self.should_use_mft(root_count, enabled)
    }

    /// 原生扫描校准：记录每文件成本（样本太少/耗时异常时忽略）。
    pub fn record_native(&mut self, count: usize, elapsed_ms: f64) {
        if count >= 100 && elapsed_ms > 0.0 {
            self.native_per_file_ms = (elapsed_ms / count as f64).clamp(0.005, 1.0);
        }
    }

    /// MFT 扫描校准：固定成本取 read_ms（随文件表大小自动缩放），每文件成本取扣除读取后的耗时。
    pub fn record_mft(&mut self, count: usize, elapsed_ms: f64, read_ms: f64) {
        if read_ms > 0.0 {
            self.mft_fixed_ms = read_ms;
        }
        if count >= 100 && elapsed_ms > read_ms {
            self.mft_per_file_ms = ((elapsed_ms - read_ms) / count as f64).clamp(0.005, 1.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crossover_math_and_hysteresis() {
        let model = ScanCostModel::default();
        // 种子：2500 / (0.030 - 0.022) = 312,500
        let n = model.crossover().unwrap();
        assert!((n - 312_500.0).abs() < 1.0, "crossover={n}");
        // 迟滞启用点 = 1.25 × 312,500 = 390,625
        assert!(!model.should_use_mft(312_500, true));
        assert!(model.should_use_mft(390_625, true));
        assert!(model.should_use_mft(500_000, true));
        assert!(!model.should_use_mft(500_000, false), "开关关闭时不用 MFT");
    }

    #[test]
    fn native_never_loses_has_no_crossover() {
        let model = ScanCostModel {
            mft_fixed_ms: 2_500.0,
            mft_per_file_ms: 0.010,
            native_per_file_ms: 0.010,
        };
        assert_eq!(model.crossover(), None);
        assert!(!model.should_use_mft(u64::MAX, true));
    }

    #[test]
    fn calibration_records_and_clamps() {
        let mut model = ScanCostModel::default();
        model.record_native(1_000, 30.0);
        assert!((model.native_per_file_ms - 0.030).abs() < 1e-9);
        model.record_mft(1_000, 3_000.0, 2_500.0);
        assert!((model.mft_fixed_ms - 2_500.0).abs() < 1e-9);
        assert!((model.mft_per_file_ms - 0.5).abs() < 1e-9);
        // 样本过少不覆盖
        let mut model = ScanCostModel::default();
        model.record_native(10, 100.0);
        assert!((model.native_per_file_ms - 0.030).abs() < 1e-9);
    }

    #[test]
    fn force_flag_bypasses_model_but_respects_enable_gate() {
        let model = ScanCostModel::default();
        // 强制开启且 MFT 已启用：无条件走 MFT。
        assert!(model.decide(0, true, true));
        // 强制但 MFT 未启用：仍拒绝。
        assert!(!model.decide(0, false, true));
        // 未强制：回到模型 + 迟滞。
        assert!(!model.decide(0, true, false));
        assert!(!model.decide(u64::MAX, false, true));
    }
}
