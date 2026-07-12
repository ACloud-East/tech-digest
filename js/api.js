/**
 * TechDigest API 模块 v3.5
 * - 热搜仅显示科技相关
 * - 科技资讯读取预抓取的 data/news.json（绕过CORS和rss2json限制）
 */
const API = {
    cachePrefix: 'td35_',
    cacheTTL: 30 * 1000, // 30秒：新闻更新快，用户希望刷新后立即看到最新数据

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
        { key: '网络安全', name: '网络安全', color: '#c62828' },
        { key: 'AI芯片', name: 'AI芯片', color: '#6a1b9a' },
        { key: '三星', name: '三星', color: '#0d47a1' },
        { key: '科技大厂', name: '科技大厂', color: '#00695c' },
        { key: '数码测评', name: '数码测评', color: '#e65100' },
        { key: '新品发布', name: '新品发布', color: '#ad1457' },
        { key: '科技专访', name: '科技专访', color: '#37474f' },
        { key: '上市科技', name: '上市科技', color: '#1b5e20' },
        { key: 'theverge', name: 'The Verge', color: '#e2127a' },
        { key: 'techcrunch', name: 'TechCrunch', color: '#0f9d58' },
        { key: 'engadget', name: 'Engadget', color: '#2b2d32' },
        { key: 'zdnet', name: 'ZDNet', color: '#0066cc' },
        { key: 'lobsters', name: 'Lobsters', color: '#b22222' },
        { key: 'devto', name: 'Dev.to', color: '#4b3e99' },
        { key: 'gsmarena', name: 'GSMArena', color: '#d32f2f' },
    ],

    async fetchAllTechNews() {
        const cacheKey = 'tech_all_v37';
        const cached = this.getCache(cacheKey);
        if (cached) return cached;

        try {
            // 直接fetch，不用AbortController避免超时问题
            // 追加 Date.now() 既是 HTTP 缓存击穿，也确保每次刷新都拿到 cron 最新生成的文件
            const r = await fetch('data/news.json?' + Date.now());
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const data = await r.json();
            if (data && data.articles && Array.isArray(data.articles)) {
                const articles = data.articles.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));
                const payload = { articles, updateTime: data.updateTime || '' };
                this.setCache(cacheKey, payload);
                return payload;
            }
        } catch (e) {
            console.warn('读取新闻数据失败:', e.message);
        }
        return { articles: [], updateTime: '' };
    }
};
