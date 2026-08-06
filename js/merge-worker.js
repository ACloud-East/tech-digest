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

    let merged = base ? base.slice() : [];

    // 追加实时文章（仅去重实时内部的重复）
    if (live && live.length) {
        const seenLive = new Set();
        for (const a of live) {
            const k = (a.title || '').trim().toLowerCase();
            if (k && !seenLive.has(k)) {
                seenLive.add(k);
                merged.push(a);
            }
        }
    }

    merged = merged.map(a => cleanArticle(a));

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
