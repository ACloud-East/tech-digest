# 预览 31274f26 — 科技资讯热点看板「一直转圈圈」修复

- **预览地址**：https://31274f26.tech-digest-74r.pages.dev
- **状态**：已部署、已验证（仅哈希预览，未触碰生产 tech-digest-74r.pages.dev）
- **对应问题**：用户反馈「44个数据源加载一直转圈圈，转不过来，不停地转」

## 根因
1. 服务端 `/api/news` 用 `Promise.all` 等全部 24 个 RSS 源，单源超时 15s 且无整体预算；多个源同时变慢时函数体跑到 ~25s，把前端拖死。
2. 前端 `fetchAllTechNews()` 用**裸 `fetch` 且无超时**，且 `/api/news` 与 `data/news.json` **串行**等待；一旦 Cloudflare 边缘把连接挂起，promise 永远不 settle → `await` 不返回 → `finally` 不执行 → `techLoading` 永久为 `true` → 无限转圈。

## 复现（修复前，全新上下文冷加载 49896e62）
- `techLoading=True` 持续 **50.5 秒** 才解析，期间 `techNewsLen=0`、无任何报错/失败请求 —— 纯被慢接口拖死。

## 修复
- **服务端** `functions/api/news.js`：单源超时 15s→8s；新增整体预算 12s（`Promise.race` 兜底，预算到即返回已收集的部分结果，新增 `partial` 标记），函数体最坏 ≤~8s。
- **客户端** `js/api.js` `fetchAllTechNews()`：新增 `fetchWithTimeout()`；`/api/news`(25s) 与 `data/news.json`(20s) **并行** `Promise.allSettled`；先读本地缓存兜底；实时与历史都拿不到但有缓存时回退缓存。
- **前端看门狗** `js/app.js` `fetchTechNews()`：30s 强制清除 `techLoading`，任何意外都不会无限转。
- `index.html` 版本号 `api.js?v=2607291810` / `app.js?v=2607291810`。

## 验证（新预览 31274f26，全新上下文冷加载）
- 冷加载 `t+30.4s RESOLVED len=2198`（满载 2198 条，无报错，转圈停止）。
- 热请求 `/api/news`：`time=7.19s`（原 25s）。
- 注：沙箱出口限速使 1.4MB 的 `data/news.json` 下载偏慢（~20–30s）；用户侧走 Cloudflare CDN + gzip（约 250KB）预计 8–18s。

## 回滚
回退到上一个预览：https://49896e62.tech-digest-74r.pages.dev （仍在线）
