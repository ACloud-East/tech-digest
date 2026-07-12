# UI 闪烁与手动刷新时间基准修复 · 验证报告

> 验证时间：2026-07-12 · 站点：https://acloud-east.github.io/tech-digest/
> 提交：`b2c8a00`

## 问题 1：刷新时页面先显示 `{{ }}` 模板

**现象**：用户截图中，页面刚刷新时左侧统计卡片、筛选栏、文章列表等处出现 `{{ totalArticles }}`、`{{ sourcesCount }}`、`{{ src.name }}`、`{{ item.title }}` 等未渲染的 Vue 插值，影响观感。

**根因**：Vue 3 在 CDN 下载并挂载完成前，浏览器会直接把 HTML 模板中的 `{{ }}` 文本渲染出来。这是一个典型的 Vue 初始化闪烁（FOUC）。

**修复**：
- 在 `index.html` 的 `<head>` 内联 CSS：`[v-cloak]{display:none!important}`
- 在挂载根节点 `<div id="app">` 添加 `v-cloak`

这样 Vue 完成挂载前，整个 `#app` 会被隐藏；挂载完成后 Vue 自动移除 `v-cloak` 属性，内容平滑出现，不再显示 `{{ }}`。

**验证**：
- 线上 `<div id="app" v-cloak>` 已生效
- 无头 Chromium 渲染后的 DOM 中，`{{...}}` 模板残留数量为 **0**

## 问题 2：手动刷新后仍显示"更新于1小时之前"

**现象**：用户点击刷新按钮后，顶部时间提示仍显示"更新于1小时之前"，没有反映用户刚刚点击的动作。

**根因**：`dataAgeText` 一直基于 `news.json` 中的 `updateTime`（服务器最近一次抓取时间）。手动刷新只是重新加载了同样的静态数据，因此提示不变。

**修复**：
- 在 `js/app.js` 新增 `manualRefreshTime` ref
- 首次页面加载：仍显示服务器抓取时间（例如"更新于1小时之前"）
- 用户点击手动刷新按钮：`refreshCurrentTab()` 先把 `manualRefreshTime.value = Date.now()`，再执行数据拉取；`dataAgeText` 改用 `manualRefreshTime`（或服务器时间 fallback）作为基准

效果：
- 点击刷新后，`dataAgeText` 立即变为 **"刚刚更新"**，并随时间推移变成"1分钟前"、"2分钟前"等，以用户点击时刻为基准
- 未点击刷新时，继续显示真实的服务器抓取时间

**验证**：
- 线上 `js/app.js` 已包含 `manualRefreshTime` 的声明、在 `refreshCurrentTab` 中的赋值、以及在 `dataAgeText` 中的基准使用

## 修改文件
- `index.html`：添加 `v-cloak` 样式与属性
- `js/app.js`：新增 `manualRefreshTime` 与 `dataAgeText` 基准切换逻辑

## 结论
页面刷新时的 `{{ }}` 模板闪烁已彻底消除；手动刷新后顶部时间提示以用户点击时刻为基准显示"刚刚更新"，符合用户操作预期。
