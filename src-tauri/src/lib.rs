mod app;
mod commands;

#[cfg(feature = "bench")]
#[doc(hidden)]
pub mod core;
#[cfg(not(feature = "bench"))]
mod core;

#[cfg(feature = "bench")]
#[doc(hidden)]
pub mod infra;
#[cfg(not(feature = "bench"))]
mod infra;

pub fn run() {
    app::run();
}
