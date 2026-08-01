// 发布模式下不显示控制台窗口（仅影响 Windows）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    rootup_lib::run()
}
