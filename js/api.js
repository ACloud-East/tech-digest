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

    getCache(key) {
        try {
            const c = localStorage.getItem(this.cachePrefix + key);
            if (!c) return null;
            const { data, ts } = JSON.parse(c);
            if (Date.now() - ts > this.cacheTTL) { localStorage.removeItem(this.cachePrefix + key); return null; }
            return data;
        } catch { return null; }
    },
    setCache(key, data) {
        try { localStorage.setItem(this.cachePrefix + key, JSON.stringify({ data, ts: Date.now() })); }
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
        // ===== 主题源（与上方"数据源"分组展示）=====
        { key: '数码测评', name: '数码测评', color: '#e65100', group: 'theme' },
        { key: '新品发布', name: '新品发布', color: '#ad1457', group: 'theme' },
        { key: '三星', name: '三星', color: '#0d47a1', group: 'theme' },
        { key: '索尼', name: '索尼', color: '#1a1a2e', group: 'theme' },
        { key: '尼康', name: '尼康', color: '#34495e', group: 'theme' },
        { key: '佳能', name: '佳能', color: '#c0392b', group: 'theme' },
        { key: '科技专访', name: '科技专访', color: '#37474f', group: 'theme' },
        { key: '上市科技', name: '上市科技', color: '#1b5e20', group: 'theme' },
        { key: 'techcrunch', name: 'TechCrunch', color: '#0f9d58' },
        { key: 'engadget', name: 'Engadget', color: '#2b2d32' },
        { key: 'zdnet', name: 'ZDNet', color: '#0066cc' },
        { key: 'lobsters', name: 'Lobsters', color: '#b22222' },
        { key: 'devto', name: 'Dev.to', color: '#4b3e99' },
        { key: 'gsmarena', name: 'GSMArena', color: '#d32f2f' },
        { key: 'androidauthority', name: 'Android Authority', color: '#a4c639' },
        { key: 'darkreading', name: 'Dark Reading', color: '#1a1a2e' },
    ],

    async fetchAllTechNews() {
        const cacheKey = 'tech_all_v37';

        // 1) 实时抓取（刷新时带来最新文章，追加到顶部；失败不影响历史语料）
        let live = null;
        try {
            const r = await fetch('/api/news', { cache: 'no-store' });
            if (r.ok) {
                const d = await r.json();
                if (d && Array.isArray(d.articles)) live = d.articles;
            }
        } catch (e) {
            console.warn('实时资讯抓取失败，仅展示历史语料:', e.message);
        }

        // 2) 历史语料库（用户长期搜集的 news.json，必须完整保留，不得丢弃）
        let base = [];
        let baseUpdate = '';
        try {
            const r = await fetch('data/news.json', { cache: 'no-store' });
            if (r.ok) {
                const d = await r.json();
                if (d && Array.isArray(d.articles)) { base = d.articles; baseUpdate = d.updateTime || ''; }
            }
        } catch (e) {
            console.warn('读取历史语料失败:', e.message);
        }

        // 3) 合并：历史为底，实时追加。
        // 为保总量足够大，这里**只去掉同一次实时抓取内的重复**，允许与历史语料重复；
        // 这样每次刷新都会继续增加数量，直到 8000 上限。
        let merged = base.slice();
        if (live && live.length) {
            const seenLive = new Set();
            for (const a of live) {
                const k = (a.title || '').trim().toLowerCase();
                if (k && !seenLive.has(k)) { seenLive.add(k); merged.push(a); }
            }
        }
        // 清洗所有 HTML 残留（历史语料或实时接口都可能带编码过的标签）
        merged = merged.map(a => this._cleanArticle(a));

        merged.sort((x, y) => new Date(y.time || 0) - new Date(x.time || 0));
        if (merged.length > 8000) merged = merged.slice(0, 8000); // 安全上限：每次刷新继续累加，直到 8000

        // 刷新过 → 时间记为此刻；实时不可用 → 沿用历史语料的更新时间
        const updateTime = live && live.length ? new Date().toISOString() : baseUpdate;
        const payload = { articles: merged, updateTime, live: !!live, baseCount: base.length, liveCount: live ? live.length : 0 };
        this.setCache(cacheKey, payload);
        return payload;
    }
};
