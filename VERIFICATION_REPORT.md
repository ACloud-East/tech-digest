# TechDigest 筛选栏修复 · 线上验证报告

> 验证时间：2026-07-12 · 验证对象：https://acloud-east.github.io/tech-digest/

## 问题回顾
用户反馈"看不见数据源有哪些，也看不见主题源有哪些了"。

**根因**：`js/app.js` 中 `techSources` 是普通数组（`const techSources = API.techSourceConfig;`，非 `ref`），但 `themeSources`/`dataSources` 两个 `computed` 误用了 `techSources.value.filter(...)`。`.value` 在普通数组上为 `undefined`，调用 `.filter()` 抛出错误，导致依赖它的**整个来源筛选栏渲染区块崩溃**（数据源与主题源两组按钮同时消失）。

**修复**（已推送 `5adfbc7`）：去掉 `.value`，改为 `techSources.filter(...)`，并加注释防止复发。

## 验证手段与结果

| 验证项 | 方法 | 结果 |
|---|---|---|
| 本地代码修复正确 | `grep` `js/app.js` 关键行 | ✅ 无 `techSources.value` 误用 |
| 线上 `app.js` 已同步 | 拉取 CDN 文件并 grep | ✅ 第 310–311 行为修复后代码 |
| `api.js` 分组配置正确 | 解析 `techSourceConfig` | ✅ 36 个数据源 + 8 个 `group:'theme'` 主题源 |
| computed 切分不抛错 | Node 模拟 `filter` 逻辑 | ✅ `dataSources`(36) / `themeSources`(8) 正常切分 |
| **真实浏览器渲染** | 无头 Chromium `--dump-dom` | ✅ 筛选栏全部渲染 |
| 白屏链接 | 检查 `news.google.com/rss/articles/` | ✅ 0 条（全部已修正为 `articles/`） |
| 数据新鲜度 | 读取 `news.json.updateTime` | ✅ `2026-07-12T02:37:51Z`（每小时 cron 刷新） |

## 渲染后实际可见内容
- **筛选栏标签**：`筛选来源` + `主题源`
- **数据源按钮（36 个）**：IT之家、36氪、少数派、爱范儿、虎嗅、雷锋网、网易科技、快科技、DoNews、极客公园、品玩、cnBeta、华尔街见闻、机器之心、量子位、InfoQ、开源中国、Solidot、新华网科技、钛媒体、澎湃新闻、9to5Mac、Wired、ArsTechnica、MacRumors、超能网、爱搞机、The Verge、TechCrunch、Engadget、ZDNet、Lobsters、Dev.to、GSMArena、Android Authority、Dark Reading
- **主题源按钮（8 个）**：数码测评、新品发布、三星、索尼、尼康、佳能、科技专访、上市科技
- **按钮总数**：45（`全部` + 36 数据源 + 8 主题源）

## 当前数据健康度
- 文章总数：**1331 篇**
- 来源数：45
- 时间分布：1 天内 443 · 1–3 天 681 · 3–7 天 98 · 7 天以上 109
- 主题源文章：370 篇
- 自动刷新：已按用户要求**禁用**，仅保留手动刷新（仍基于当前时间点，展示 新的/1天前/2天前/3天前）

## 结论
用户"看不见数据源/主题源"的问题已彻底修复并在线上验证通过。筛选栏的两组按钮现在均正常显示，可点击筛选；所有文章链接均无白屏。
