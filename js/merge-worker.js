/**
 * Web Worker：在独立线程中合并历史归档与实时文章（v2：分片处理 + 子进度上报）
 * 上报协议：
 *   { type:'progress', phase:'dedupe-base'|'dedupe-live'|'clean'|'sort'|'trim', frac: 0~1 }
 *   { type:'result',   payload: {...} }
 * frac 是【整个合并阶段】的完成比例（阶段权重见下），主线程直接乘以 merge 配额即可。
 */
const PH = { 'dedupe-base': [0, 0.40], 'dedupe-live': [0.40, 0.46], 'clean': [0.46, 0.76], 'sort': [0.76, 0.94], 'trim': [0.94, 1] };
const post = (phase, local) => {
    const [a, b] = PH[phase];
    self.postMessage({ type: 'progress', phase, frac: a + (b - a) * Math.max(0, Math.min(1, local)) });
};

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

// 归一化标题作为去重键
function keyOf(a) {
    return (a && a.title ? String(a.title) : '').trim().toLowerCase();
}

self.onmessage = function (e) {
    const { base, live, updateTime, liveAvailable } = e.data;
    const CH = 800;                      // 每片 800 条上报一次，8000 篇 → 10 次上报，开销可忽略
    const map = new Map();

    const baseArr = base || [];
    post('dedupe-base', 0);
    for (let i = 0; i < baseArr.length; i += CH) {
        const end = Math.min(i + CH, baseArr.length);
        for (let j = i; j < end; j++) { const k = keyOf(baseArr[j]); if (k) map.set(k, baseArr[j]); }
        post('dedupe-base', end / (baseArr.length || 1));
    }

    const liveArr = live || [];
    post('dedupe-live', 0);
    for (let i = 0; i < liveArr.length; i += CH) {
        const end = Math.min(i + CH, liveArr.length);
        for (let j = i; j < end; j++) { const k = keyOf(liveArr[j]); if (k) map.set(k, liveArr[j]); }   // 实时覆盖归档
        post('dedupe-live', end / (liveArr.length || 1));
    }

    let merged = Array.from(map.values());
    post('clean', 0);
    for (let i = 0; i < merged.length; i += CH) {
        const end = Math.min(i + CH, merged.length);
        for (let j = i; j < end; j++) merged[j] = cleanArticle(merged[j]);
        post('clean', end / (merged.length || 1));
    }

    // 排序无法分片：先把时间戳预计算成数字（避免 sort 比较器里反复 new Date），配合主线程涓流不静止
    post('sort', 0.05);
    const ts = new Map();
    for (const a of merged) ts.set(a, new Date((a && a.time) || 0).getTime() || 0);
    post('sort', 0.45);
    merged.sort((x, y) => ts.get(y) - ts.get(x));
    post('sort', 1);

    post('trim', 0.3);
    if (merged.length > 8000) merged = merged.slice(0, 8000);
    post('trim', 1);

    self.postMessage({ type: 'result', payload: {
        articles: merged,
        updateTime: liveAvailable ? new Date().toISOString() : (updateTime || ''),
        live: !!liveAvailable,
        baseCount: baseArr.length, liveCount: liveArr.length,
    }});
};
