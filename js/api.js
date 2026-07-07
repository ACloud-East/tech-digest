/**
 * TechDigest API 模块 v3.5
 * - 热搜仅显示科技相关
 * - 科技资讯读取预抓取的 data/news.json（绕过CORS和rss2json限制）
 */
const API = {
    cachePrefix: 'td35_',
    cacheTTL: 5 * 60 * 1000,

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
        const all = [];
        try { const d = await this.fetchHotFromUApi('weibo'); all.push(...d); } catch(e){}
        try {
            const d = await this.fetchJSON('https://weibo.com/ajax/side/hotSearch');
            if (d && d.data && d.data.realtime) {
                d.data.realtime.forEach(item => {
                    all.push({ title: item.word || item.note || '', url: `https://s.weibo.com/weibo?q=${encodeURIComponent(item.word||'')}`, tag: item.label_name || '' });
                });
            }
        } catch(e){}
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
        { key: 'zaeke', name: '知客', color: '#9c27b0' },
        { key: 'odaily', name: 'Odaily星球日报', color: '#ffb300' },
        { key: 'wallstreetcn', name: '华尔街见闻·科技', color: '#d32f2f' },
        { key: 'jiqizhixin', name: '机器之心', color: '#512da8' },
        { key: 'quantamagazine', name: '量子位', color: '#00796b' },
        { key: 'infoq', name: 'InfoQ', color: '#0277bd' },
        { key: 'oschina', name: '开源中国', color: '#43a047' },
        { key: 'solidot', name: 'Solidot', color: '#546e7a' },
        { key: 'xinhua', name: '新华网科技', color: '#003d8c' },
        { key: 'tmtpost', name: '钛媒体', color: '#ff9800' },
        { key: 'kejilie', name: '科技猎', color: '#795548' },
        { key: 'thepaper', name: '澎湃科技', color: '#1e88e5' },
        { key: '9to5mac', name: '9to5Mac', color: '#0a84ff' },
        { key: 'wired', name: 'Wired', color: '#000000' },
        { key: 'ars', name: 'ArsTechnica', color: '#ff4e00' },
        { key: 'macrumors', name: 'MacRumors', color: '#1d4ed8' },
        { key: 'expreview', name: '超能网', color: '#00a0e9' },
    ],

    async fetchAllTechNews() {
        const cacheKey = 'tech_all_v35';
        const cached = this.getCache(cacheKey);
        if (cached) return cached;

        try {
            const data = await this.fetchJSON('data/news.json');
            if (data && data.articles && Array.isArray(data.articles)) {
                const articles = data.articles.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));
                this.setCache(cacheKey, articles);
                return articles;
            }
        } catch (e) {
            console.warn('读取本地新闻数据失败:', e.message);
        }
        return [];
    }
};
