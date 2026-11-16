use super::super::{db, config::Config};
use super::serve;
/* nested /* crate::bogus */ still a comment */
pub fn list() { let _ = r#"crate::bogus"#; db::connect(&Config { url: "" }); }
