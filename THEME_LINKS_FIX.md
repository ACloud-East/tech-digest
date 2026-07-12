# 主题源链接白屏修复 · 验证报告

> 验证时间：2026-07-12 · 站点：https://acloud-east.github.io/tech-digest/
> 提交：`59a4129`

## 问题
用户反馈"主题源的，点进去是白屏链接 `<about:blank>`"。

**根因**：主题源（数码测评/新品发布/三星/索尼/尼康/佳能/科技专访/上市科技）以及 dead 兜底源（品玩/虎嗅/ZDNet）的文章链接来自 Google News 检索，形如 `https://news.google.com/articles/CBMi…?oc=5`。这是 Google 的 **JS 跳转页**，必须浏览器端加载 Google 的 JS 才能重定向到原文。在**无法访问 Google 的网络环境**下，点击后页面空白 —— 即用户看到的白屏 / `<about:blank>`。

> 注：纯 base64 / 字符索引偏移等算法无法解码新版 Google News 的 article ID（已穷举验证），因其解码必须**调用 Google 服务端端点**。

## 修复方案
在**服务端（GitHub Actions 拥有正常国际网络）抓取时**，调用 Google 官方的 `batchexecute` 解码端点，把 `news.google.com/articles/ID` 还原为**真实原文 URL** 写入 `news.json`。用户端拿到的是原始媒体站点链接，直接打开，不再依赖 Google。

### 代码改动
| 文件 | 改动 |
|---|---|
| `scripts/decode-google-news.js`（新增） | 纯 Node 原生 https 复刻 `googlenewsdecoder`(new_decoderv3) 逻辑：`GET articles 页取签名` → `POST batchexecute 取原文 URL` |
| `scripts/fetch-news.js` | `fetchGoogleNews` 生成链接后调用解码；用 `data/decode-cache.json` 缓存（**命中跳过**，仅对新文章解码，避免每小时全量重解）；**解码失败的文章自动丢弃**，保证零白屏 |
| `scripts/decode-urls.js`（新增） | 一次性批量解码现有 `news.json`，并产出缓存 |
| `.github/workflows/fetch-news.yml` | 提交时一并 `git add data/decode-cache.json` |

## 验证结果
| 项目 | 结果 |
|---|---|
| 批量解码 | 466 篇 Google 链接 → **456 篇成功**还原为真实 URL（46.6s） |
| 失效文章 | 10 篇 Google 侧已失效（页面仅 2021 字节、无签名参数）→ 已移除，保证零白屏 |
| **线上白屏链接** | **0**（渲染后页面 `news.google.com` 出现次数 = 0） |
| 线上文章总数 | 1321 篇 |
| 主题源文章 | 360 篇，全部为真实媒体 URL |
| 主题源域名样例 | k.sina.com.cn、163.com、finance.sina.cn、m.sohu.com、news.mydrivers.com、chejiahao.autohome.com.cn、notebookcheck-cn.com…（均为可直连的中文/国际媒体） |

### 渲染实测（无头 Chromium 真实渲染线上页）
- 主题源文章卡片 `href` 抽样：
  - `https://chejiahao.autohome.com.cn/info/25955526`（汽车之家）
  - `https://finance.sina.cn/stock/jdts/2026-07-12/detail-…`（新浪财经）
  - `https://tech.sina.cn/2026-07-12/detail-…`（新浪科技）
- 页面内 `news.google.com` 链接：**0 处**

## 结论
主题源（及 dead 源）文章现已全部指向可直连的真实媒体原文，**点击不再白屏 / about:blank**。后续每小时自动抓取时，新文章会在服务端解码（命中缓存几乎零开销），持续保持零白屏。
