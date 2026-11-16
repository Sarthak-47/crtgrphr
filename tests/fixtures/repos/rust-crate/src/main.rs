mod config;
mod db;
mod handlers;
mod report;
pub use config::Config;

fn main() { handlers::serve(); }
