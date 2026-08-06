/**
 * Web Worker：在独立线程中合并历史归档与实时文章
 * 避免主线程被大批量文章的去重/清洗/排序阻塞，解决进度条卡在 82% 的问题
 */
self.onmessage = function (e) {
    const { base, live, updateTime, liveAvailable } = e.data;

    // 简易 HTML 实体解码
    function decodeEntities(s) {
        return String(s || '')
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
            .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
            .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
            .replace(/&nbsp;/g, ' ');
    }

    function stripHtml(s) {
        return decodeEntities(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function cleanArticle(a) {
        if (!a) return a;
        if (a.title) a.title = stripHtml(a.title);
        if (a.description) a.description = stripHtml(a.description);
        return a;
    }

    // 归一化标题作为去重键：去首尾空格、转小写，忽略大小写/空白差异造成的"伪重复"
    function keyOf(a) {
        return (a && a.title ? String(a.title) : '').trim().toLowerCase();
    }

    // ── 全局去重 ──────────────────────────────────────────────────────────
    // 同一篇文章往往既在【历史归档】又在【实时抓取】里（两边源高度重合），
    // 旧实现只去掉"同一次实时内部"的重复、刻意允许与归档重复，导致列表里出现
    // "完全一样的、完全重复"的条目。这里改为 base+live 一起按标题去重，
    // 冲突时实时抓取优先（更鲜活、URL 直达原文），既消除重复又不丢失新内容。
    const map = new Map();
    for (const a of (base || [])) {
        const k = keyOf(a);
        if (k) map.set(k, a); // 归档内部重复也会在此自然合并为一条
    }
    for (const a of (live || [])) {
        const k = keyOf(a);
        if (k) map.set(k, a); // 实时覆盖归档：同一标题只保留实时这一份
    }

    let merged = Array.from(map.values()).map(a => cleanArticle(a));

    // 按时间降序排列
    merged.sort((x, y) => new Date(y.time || 0).getTime() - new Date(x.time || 0).getTime());

    // 安全上限
    if (merged.length > 8000) merged = merged.slice(0, 8000);

    const payload = {
        articles: merged,
        updateTime: liveAvailable ? new Date().toISOString() : (updateTime || ''),
        live: !!liveAvailable,
        baseCount: base ? base.length : 0,
        liveCount: live ? live.length : 0,
    };

    self.postMessage({ payload });
};
