// 网页采集模块：HTTP/代理基础设施、采集插件、网页抓取、网络图片下载
// 按职责拆分，避免单个 700+ 行文件混杂四种互不相关的逻辑
pub mod fetch;
pub mod http;
pub mod image;
pub mod plugin;
