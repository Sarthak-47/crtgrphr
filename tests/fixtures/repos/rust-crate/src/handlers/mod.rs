mod accounts;
use axum::Router;
pub fn serve() { let _r: Router = Router::new(); accounts::list(); }
