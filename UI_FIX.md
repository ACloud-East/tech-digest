# 手动刷新时间仍显示"1小时前" · 根因与修复

> 提交：`a984aed`

## 用户反馈
"刷新了还是更新于1小时之前，你是不是忘记部署了"

## 根因（不是没部署，是浏览器缓存）
线上 `js/app.js` 早已包含 `manualRefreshTime` 新逻辑（之前 `b2c8a00` 已部署），但**修改文件内容时未同步更新其 cache-busting 版本号**——`index.html` 中仍引用 `js/app.js?v=8`。浏览器依据 URL 命中缓存，一直使用**旧的 `app.js`**（没有"刚刚更新"逻辑），因此点击刷新后依旧显示服务器抓取时间"1小时前"。

## 修复
1. **缓存版本号升级**：`index.html` 中 `js/app.js?v=8` → `js/app.js?v=9`，强制浏览器重新下载脚本，丢弃旧缓存。
2. **刷新基准统一**：`updateTimestamp()` 在每次数据加载（首次打开 / 浏览器 F5 / 点击刷新按钮）时均设置 `manualRefreshTime = Date.now()`，使"更新于X前"始终以当前时刻为基准，点击/打开后即为"刚刚更新"，并随时间滚动为"1分钟前"等。
3. **tooltip 文案**：改为"本指示以你最近一次刷新/打开页面的时刻为基准。服务器数据实际抓取于 ……"，区分"指示基准"与"真实抓取时间"。

## 验证
| 项目 | 结果 |
|---|---|
| 线上 index.html 引用 | `js/app.js?v=9`（旧 `v=8` 不再被引用，grep 计数 0）|
| 线上 app.js 逻辑 | `manualRefreshTime` 在 `updateTimestamp`/`refreshCurrentTab` 中设置（第 197/204/303/312 行）|
| 无头渲染顶部文本 | "刚刚更新" |
| 模板残留 `{{ }}` | 0 |

## 给用户
请按 `Ctrl+F5`（Windows）/ `Cmd+Shift+R`（Mac）**强刷一次**清掉本地旧缓存，即可看到"刚刚更新"。

## 修改文件
- `index.html`：`app.js?v=8`→`?v=9`；tooltip 文案
- `js/app.js`：`updateTimestamp()` 内设置 `manualRefreshTime`
