/**
 * TechDigest API 模块 v3.5
 * - 热搜仅显示科技相关
 * - 科技资讯读取预抓取的 data/news.json（绕过CORS和rss2json限制）
 */
const API = {
    cachePrefix: 'td35_',
    cacheTTL: 30 * 1000, // 30秒：新闻更新快，用户希望刷新后立即看到最新数据

    // 简易 HTML/实体清洗（兼容 RSS 里编码过的标签，如 &lt;p&gt;）
    _decodeEntities(s) {
        return (s || '')
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
            .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
            .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
            .replace(/&nbsp;/g, ' ');
    },
    _stripHtml(s) {
        return this._decodeEntities(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    },
    _cleanArticle(a) {
        if (!a) return a;
        if (a.title) a.title = this._stripHtml(a.title);
        if (a.description) a.description = this._stripHtml(a.description);
        return a;
    },

    getCache(key, ttl) {
        try {
            const c = localStorage.getItem(this.cachePrefix + key);
            if (!c) return null;
            const { data, ts } = JSON.parse(c);
            if (Date.now() - ts > (ttl || this.cacheTTL)) { localStorage.removeItem(this.cachePrefix + key); return null; }
            return data;
        } catch { return null; }
    },
    setCache(key, data, ttl) {
        try { localStorage.setItem(this.cachePrefix + key, JSON.stringify({ data, ts: Date.now(), ttl })); }
        catch { this.clearOldCache(); }
    },
    clearOldCache() {
        Object.keys(localStorage).filter(k => k.startsWith(this.cachePrefix)).forEach(k => localStorage.removeItem(k));
    },

    async fetchJSON(url, timeout = 15000) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeout);
        try {
            const r = await fetch(url, { signal: ctrl.signal });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return await r.json();
        } finally { clearTimeout(t); }
    },

    // 带超时的原始 fetch：超时/网络挂起时 reject，绝不会无限等待导致界面一直转圈
    async fetchWithTimeout(url, timeoutMs) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            return await fetch(url, { cache: 'no-store', signal: ctrl.signal });
        } finally { clearTimeout(t); }
    },

    // 带超时的「流式」fetch + 解析 JSON：通过 response.body.getReader() 边下边回报字节进度，
    // 让大体积的历史归档（data/news.json，当前 3MB+）也能显示真实下载进度，而不是干等转圈。
    // onProgress(loadedBytes, totalBytes) —— totalBytes 优先来自 HTTP Content-Length；
    // 若服务端 gzip 分块传输不返回总大小，则用 expectedSize（由 data/news-meta.json 提供）作为总大小，
    // 这样即使 Cloudflare 压缩分块，前端仍能显示真实百分比。
    async streamFetchJSON(url, timeoutMs, onProgress, expectedSize = 0) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            const resp = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const total = Number(resp.headers.get('content-length')) || expectedSize || 0;
            const reader = resp.body.getReader();
            const chunks = [];
            let loaded = 0;
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                loaded += value.length;
                if (onProgress) onProgress(loaded, total);
            }
            // 合并分片后解析（一次性 JSON.parse 比边下边流式解析更稳）
            const buf = new Uint8Array(loaded);
            let pos = 0;
            for (const c of chunks) { buf.set(c, pos); pos += c.length; }
            return JSON.parse(new TextDecoder('utf-8').decode(buf));
        } finally {
            clearTimeout(t);
        }
    },

    // ========== 热搜：uapis.cn 格式解析 ==========
    async fetchHotFromUApi(type) {
        const data = await this.fetchJSON(`https://uapis.cn/api/v1/misc/hotboard?type=${type}`);
        if (data && data.list && Array.isArray(data.list)) {
            return data.list.map(item => ({
                title: item.title || '',
                url: item.url || '#',
                tag: (item.extra && item.extra.label) ? item.extra.label : ''
            }));
        }
        return [];
    },

    async fetchWeiboHot() {
        const key = 'weibo_hot';
        const c = this.getCache(key); if (c) return c;
        // 直接走 uapis.cn 聚合接口（已带 CORS 头）；不再直连 weibo.com，避免跨域报错
        const all = [];
        try { const d = await this.fetchHotFromUApi('weibo'); all.push(...d); } catch(e){}
        const result = this.uniqueFilter(all);
        this.setCache(key, result);
        return result;
    },

    async fetchDouyinHot() {
        const key = 'douyin_hot';
        const c = this.getCache(key); if (c) return c;
        try {
            const result = this.uniqueFilter(await this.fetchHotFromUApi('douyin'));
            this.setCache(key, result); return result;
        } catch(e) { throw new Error('抖音热搜获取失败'); }
    },

    async fetchToutiaoHot() {
        const key = 'toutiao_hot';
        const c = this.getCache(key); if (c) return c;
        try {
            const result = this.uniqueFilter(await this.fetchHotFromUApi('toutiao'));
            this.setCache(key, result); return result;
        } catch(e) { throw new Error('今日头条热搜获取失败'); }
    },

    async fetchBaiduHot() {
        const key = 'baidu_hot';
        const c = this.getCache(key); if (c) return c;
        try {
            const result = this.uniqueFilter(await this.fetchHotFromUApi('baidu'));
            this.setCache(key, result); return result;
        } catch(e) { throw new Error('百度热搜获取失败'); }
    },

    async fetchZhihuHot() {
        const key = 'zhihu_hot';
        const c = this.getCache(key); if (c) return c;
        try {
            const result = this.uniqueFilter(await this.fetchHotFromUApi('zhihu'));
            this.setCache(key, result); return result;
        } catch(e) { throw new Error('知乎热搜获取失败'); }
    },

    uniqueFilter(items) {
        const seen = new Set();
        return items.filter(item => {
            if (seen.has(item.title)) return false;
            seen.add(item.title);
            return TechFilter.isRelevant(item.title);
        });
    },

    // ==========================================
    // 科技资讯 — 读取预抓取的静态 JSON
    // ==========================================
    techSourceConfig: [
        { key: 'ithome', name: 'IT之家', color: '#e13b3f' },
        { key: '36kr', name: '36氪', color: '#0066ff' },
        { key: 'sspai', name: '少数派', color: '#d93b3b' },
        { key: 'ifanr', name: '爱范儿', color: '#d4233a' },
        { key: 'huxiu', name: '虎嗅', color: '#374151' },
        { key: 'leiphone', name: '雷锋网', color: '#1890ff' },
        { key: '163tech', name: '网易科技', color: '#e60012' },
        { key: 'mydrivers', name: '快科技', color: '#ff6600' },
        { key: 'donews', name: 'DoNews', color: '#00a971' },
        { key: 'geekpark', name: '极客公园', color: '#00c4ff' },
        { key: 'pingwest', name: '品玩', color: '#ff5722' },
        { key: 'cnbeta', name: 'cnBeta', color: '#009a61' },
        { key: 'wallstreetcn', name: '华尔街见闻', color: '#d32f2f' },
        { key: 'jiqizhixin', name: '机器之心', color: '#512da8' },
        { key: 'quantamagazine', name: '量子位', color: '#00796b' },
        { key: 'infoq', name: 'InfoQ', color: '#0277bd' },
        { key: 'oschina', name: '开源中国', color: '#43a047' },
        { key: 'solidot', name: 'Solidot', color: '#546e7a' },
        { key: 'xinhua', name: '新华网科技', color: '#003d8c' },
        { key: 'tmtpost', name: '钛媒体', color: '#ff9800' },
        { key: 'thepaper', name: '澎湃新闻', color: '#1e88e5' },
        { key: '9to5mac', name: '9to5Mac', color: '#0a84ff' },
        { key: 'wired', name: 'Wired', color: '#000000' },
        { key: 'ars', name: 'ArsTechnica', color: '#ff4e00' },
        { key: 'macrumors', name: 'MacRumors', color: '#1d4ed8' },
        { key: 'expreview', name: '超能网', color: '#00a0e9' },
        { key: 'igao7', name: '爱搞机', color: '#ff6a00' },
        { key: 'theverge', name: 'The Verge', color: '#e2127a' },
        { key: 'fengniao', name: '蜂鸟网', color: '#ff8c00' },
        // ===== 主题源（与上方"数据源"分组展示）=====
        { key: '数码测评', name: '数码测评', color: '#e65100', group: 'theme' },
        { key: '新品发布', name: '新品发布', color: '#ad1457', group: 'theme' },
        { key: '三星', name: '三星', color: '#0d47a1', group: 'theme' },
        { key: '索尼', name: '索尼', color: '#1a1a2e', group: 'theme' },
        { key: '尼康', name: '尼康', color: '#34495e', group: 'theme' },
        { key: '佳能', name: '佳能', color: '#c0392b', group: 'theme' },
        { key: '科技专访', name: '科技专访', color: '#37474f', group: 'theme' },
        { key: 'techcrunch', name: 'TechCrunch', color: '#0f9d58' },
        { key: 'engadget', name: 'Engadget', color: '#2b2d32' },
        { key: 'zdnet', name: 'ZDNet', color: '#0066cc' },
        { key: 'lobsters', name: 'Lobsters', color: '#b22222' },
        { key: 'devto', name: 'Dev.to', color: '#4b3e99' },
        { key: 'gsmarena', name: 'GSMArena', color: '#d32f2f' },
        { key: 'androidauthority', name: 'Android Authority', color: '#a4c639' },
        { key: 'darkreading', name: 'Dark Reading', color: '#1a1a2e' },
    ],

    async fetchAllTechNews(onProgress) {
        onProgress = onProgress || (() => {});
        const cacheKey = 'tech_all_v37';

        // 先读本地缓存兜底：历史归档体积大，缓存 TTL 给 1 小时，避免每次刷新都重拉 12MB。
        // 实时接口仍会每次都跑，保证新内容不漏。
        const ARCHIVE_TTL = 60 * 60 * 1000;
        const cached = this.getCache(cacheKey, ARCHIVE_TTL);

        // 1) 实时抓取 与 2) 历史语料 并行拉取，各自带超时（关键修复：
        //    原实现用裸 fetch 且无超时、且串行等待，单个慢源/CDN 挂起就会让界面永久转圈）。
        const LIVE_MS = 18000;   // /api/news：服务端整体预算 12s、冷启动可能到 ~18s，给 18s 余量即止。
                                 // 实测实时接口常因上游 RSS 慢源拖到 7~13s，过长会让进度条卡在「实时抓取」阶段；
                                 // 实时数据体小、非必需，宁可快速超时回退到历史归档，也不阻塞看板主体。
        const BASE_MS = 180000;  // data/news.json：改累加归档后体积持续增长（当前 ~12MB / gzip ~4MB，
                                 // 上限 8000 篇）。实测 CDN 正常回源仅 2.1s，但弱网/移动网络可能十几秒；
                                 // 归档是看板主体，宁可多等也不要丢，故给到 180s（3 分钟）。
                                 // 超时只丢历史归档，实时部分不受影响（两者并行、各自独立超时）。

        // ---- 进度状态机：实时抓取(小/快) 与 历史归档(大/慢) 并行，各自回报，合成统一进度 ----
        const prog = { liveDone: false, archStarted: false, archLoaded: 0, archTotal: 0, archKnown: false, merging: false };
        const fmtMB = (b) => b >= 1048576 ? (b / 1048576).toFixed(2) + ' MB'
            : b >= 1024 ? (b / 1024).toFixed(0) + ' KB' : b + ' B';
        const emit = () => {
            let percent, label, indeterminate = false;
            if (prog.merging) {
                percent = 96; label = '正在合并文章、去重并排序…';
            } else if (prog.archStarted) {
                if (prog.archKnown && prog.archTotal) {
                    const frac = Math.min(1, prog.archLoaded / prog.archTotal);
                    percent = Math.round(frac * 82) + (prog.liveDone ? 12 : 0); // 归档占 82%，实时占 12%，合并 6%
                    label = `正在加载历史归档 ${fmtMB(prog.archLoaded)} / ${fmtMB(prog.archTotal)}（${Math.round(frac * 100)}%）`;
                } else {
                    percent = -1; indeterminate = true; // 服务端分块压缩传输、拿不到总大小 → 走不确定动画 + 已下载量
                    label = `正在加载历史归档 ${fmtMB(prog.archLoaded)}…（压缩分块传输，总大小未知）`;
                }
            } else {
                percent = prog.liveDone ? 12 : 4;
                label = prog.liveDone ? '实时资讯已就绪，正在准备历史归档…' : '正在抓取实时科技资讯…';
            }
            onProgress({ stage: prog.merging ? 'merge' : (prog.archStarted ? 'archive' : 'live'), label, percent, indeterminate, loaded: prog.archLoaded, total: prog.archTotal });
        };
        emit();

        // 1) 实时抓取（小体积，先到先渲染；失败不影响历史语料）。完成后回报，让进度条推进到 12%
        const liveTask = (async () => {
            try {
                const r = await this.fetchWithTimeout('/api/news', LIVE_MS);
                if (r && r.ok) {
                    const d = await r.json();
                    if (d && Array.isArray(d.articles)) { prog.liveDone = true; emit(); return d.articles; }
                }
            } catch (e) { console.warn('实时资讯抓取失败/超时，仅展示历史语料:', e.message); }
            emit();
            return null;
        })();

        // 2) 先取极小的元数据文件（data/news-meta.json），拿到归档原始字节数，
        //    这样即使 Cloudflare 对 gzip 分块传输不返回 Content-Length，进度条仍能显示真实百分比。
        //    meta 下载与归档下载并行：meta 很可能很快返回，届时进度条立即变为确定模式；
        //    若 meta 极慢，也不阻塞归档开始（最多等 500ms），避免增加首屏延迟。
        let expectedSize = 0;
        const metaTask = (async () => {
            try {
                const r = await this.fetchWithTimeout('data/news-meta.json', 10000);
                if (r && r.ok) {
                    const meta = await r.json();
                    if (meta && typeof meta.size === 'number') { expectedSize = meta.size; return; }
                }
            } catch (e) { console.warn('读取归档元数据失败:', e.message); }
        })();

        // 3) 历史语料库（用户长期搜集的 news.json，必须完整保留）。
        //    先尝试流式下载（带字节进度）；部分浏览器/网络对超大 JSON 的流式读取不稳定
        //    （Chrome 无痕窗口尤其容易因内存/传输中断而失败），失败则回退到普通 fetch().json()，
        //    同样能拿到完整数据，只是进度变为不确定动画。两层都失败才算真正拉不到。
        const archiveTask = (async () => {
            // 优先等 meta 就绪（通常 <100ms），最多等 500ms 避免阻塞
            await Promise.race([metaTask, new Promise(r => setTimeout(r, 500))]);
            try {
                const data = await this.streamFetchJSON('data/news.json', BASE_MS, (loaded, total) => {
                    // streamFetchJSON 的 total 来自 Content-Length；生产上分块 gzip 时它为 0，
                    // 此时用 meta 提供的 expectedSize，让进度条保持真实百分比。
                    const effectiveTotal = total || expectedSize;
                    prog.archStarted = true; prog.archLoaded = loaded; prog.archTotal = effectiveTotal; prog.archKnown = !!effectiveTotal; emit();
                }, expectedSize);
                if (data && Array.isArray(data.articles)) return { articles: data.articles, updateTime: data.updateTime || '' };
            } catch (e) { console.warn('流式读取历史语料失败，回退普通 fetch:', e.message); }
            // 兜底：普通 GET + response.json()，无流式进度但更稳，专治流式在部分浏览器失败的情况
            try {
                const r = await this.fetchJSON('data/news.json', BASE_MS);
                if (r && Array.isArray(r.articles)) return { articles: r.articles, updateTime: r.updateTime || '' };
            } catch (e) { console.warn('普通 fetch 读取历史语料失败/超时:', e.message); }
            return null;
        })();

        let [live, base] = await Promise.all([liveTask, archiveTask]);

        // 历史归档加载失败/超时，但本地缓存里还有上一次完整数据 → 用缓存当底座，
        // 避免因归档一时拉不下来就只展示少量实时文章（用户会误以为"8000 篇变成 634 篇"）。
        if ((!base || !base.length) && cached && cached.articles && cached.articles.length) {
            base = { articles: cached.articles, updateTime: cached.updateTime || '' };
        }

        // 实时与历史都拿不到，但本地有缓存 → 用缓存兜底（至少不白屏/不空转）
        if ((!live || !live.length) && (!base || !base.length) && cached) {
            this.setCache(cacheKey, cached, ARCHIVE_TTL); // 续命缓存 TTL
            onProgress({ stage: 'done', label: '联网拉取失败，已使用本地缓存展示', percent: 100, indeterminate: false, loaded: 0, total: 0 });
            return cached;
        }

        // 实时抓取失败/超时，但历史归档成功 → 仍正常展示归档，并提示「实时稍慢」，不让用户误以为什么都没加载
        if ((!live || !live.length) && base && base.articles && base.articles.length) {
            onProgress({ stage: 'done', label: `历史归档已加载（共 ${base.articles.length} 篇）；实时资讯暂时获取较慢，稍后刷新可补齐`, percent: 100, indeterminate: false, loaded: 0, total: 0 });
        }

        // 3) 合并：历史归档为底，实时抓取追加。
        // 说明（原注释「每次刷新都会继续增加数量，直到 8000 上限」是不成立的）：
        // merged 每次都从 base 重新构建，本函数**不做跨次累加**，缓存仅在两端都失败时兜底。
        // 因此单看前端，总数 = 归档量 + 本次实时量，刷新只换内容不涨数量。
        // 真正让数量增长的是服务端：scripts/fetch-news.js 已改为累加归档（每小时并入新文，
        // 上限 8000），data/news.json 会持续变大，前端总数随之自然增长。
        // 这里仍只去掉「同一次实时抓取内」的重复、允许与历史归档重复，以免总量被削。
        prog.merging = true; emit();
        let payload;
        try {
            // 优先在 Web Worker 中合并/清洗/排序，避免主线程被数千篇文章阻塞导致进度条卡顿
            payload = await this._mergeInWorker(base && base.articles, live, base && base.updateTime, !!live && live.length > 0);
        } catch (err) {
            console.warn('Worker 合并失败，回退主线程:', err.message);
            // 降级方案：主线程同步合并（老旧浏览器或不支持 Worker 时）
            // 同样做 base+live 全局去重，实时抓取优先，避免"完全重复"的条目。
            const keyOf = (a) => (a && a.title ? String(a.title) : '').trim().toLowerCase();
            const map = new Map();
            for (const a of ((base && base.articles) || [])) {
                const k = keyOf(a);
                if (k) map.set(k, a);
            }
            for (const a of (live || [])) {
                const k = keyOf(a);
                if (k) map.set(k, a);
            }
            let merged = Array.from(map.values()).map(a => this._cleanArticle(a));
            merged.sort((x, y) => new Date(y.time || 0) - new Date(x.time || 0));
            if (merged.length > 8000) merged = merged.slice(0, 8000);
            const updateTime = (live && live.length) ? new Date().toISOString() : (base ? base.updateTime : '');
            payload = { articles: merged, updateTime, live: !!live, baseCount: (base && base.articles) ? base.articles.length : 0, liveCount: live ? live.length : 0 };
        }
        this.setCache(cacheKey, payload, ARCHIVE_TTL);
        onProgress({ stage: 'done', label: `加载完成，共 ${payload.articles.length} 篇`, percent: 100, indeterminate: false, loaded: 0, total: 0 });
        return payload;
    },

    // 在独立 Worker 线程中合并，避免阻塞 UI 主线程
    _mergeInWorker(baseArticles, liveArticles, baseUpdateTime, liveAvailable) {
        return new Promise((resolve, reject) => {
            let worker;
            try {
                worker = new Worker('js/merge-worker.js?v=2608061001');
            } catch (e) {
                reject(e);
                return;
            }
            let settled = false;
            const cleanup = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                try { worker.terminate(); } catch (_) {}
            };
            const timer = setTimeout(() => { cleanup(); reject(new Error('Worker 合并超时')); }, 15000);
            worker.onmessage = (e) => { cleanup(); resolve(e.data && e.data.payload); };
            worker.onerror = (err) => { cleanup(); reject(err); };
            worker.postMessage({ base: baseArticles, live: liveArticles, updateTime: baseUpdateTime, liveAvailable });
        });
    }
};
