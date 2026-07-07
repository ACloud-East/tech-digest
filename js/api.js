/**
 * TechDigest API 模块 v3
 * - 热搜仅显示科技相关
 * - 科技资讯多源+多日抓取
 * - 百度使用财经热搜
 */
const API = {
    cachePrefix: 'td3_',
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

    // ========== 微博热搜 ==========
    async fetchWeiboHot() {
        const key = 'weibo_hot';
        const c = this.getCache(key); if (c) return c;
        const all = [];
        // 方案1: uapis
        try { const d = await this.fetchHotFromUApi('weibo'); all.push(...d); } catch(e){}
        // 方案2: 微博内部API
        try {
            const d = await this.fetchJSON('https://weibo.com/ajax/side/hotSearch');
            if (d && d.data && d.data.realtime) {
                d.data.realtime.forEach(item => {
                    all.push({ title: item.word || item.note || '', url: `https://s.weibo.com/weibo?q=${encodeURIComponent(item.word||'')}`, tag: item.label_name || '' });
                });
            }
        } catch(e){}
        // 去重 + 过滤科技
        const seen = new Set();
        const result = all.filter(item => {
            if (seen.has(item.title)) return false;
            seen.add(item.title);
            return TechFilter.isRelevant(item.title);
        });
        this.setCache(key, result);
        return result;
    },

    // ========== 抖音热搜 ==========
    async fetchDouyinHot() {
        const key = 'douyin_hot';
        const c = this.getCache(key); if (c) return c;
        const all = [];
        try { const d = await this.fetchHotFromUApi('douyin'); all.push(...d); } catch(e){}
        const seen = new Set();
        const result = all.filter(item => {
            if (seen.has(item.title)) return false;
            seen.add(item.title);
            return TechFilter.isRelevant(item.title);
        });
        this.setCache(key, result);
        return result;
    },

    // ========== 今日头条热搜 ==========
    async fetchToutiaoHot() {
        const key = 'toutiao_hot';
        const c = this.getCache(key); if (c) return c;
        const all = [];
        try { const d = await this.fetchHotFromUApi('toutiao'); all.push(...d); } catch(e){}
        const seen = new Set();
        const result = all.filter(item => {
            if (seen.has(item.title)) return false;
            seen.add(item.title);
            return TechFilter.isRelevant(item.title);
        });
        this.setCache(key, result);
        return result;
    },

    // ========== 百度财经热搜（而非百度综合热搜）==========
    async fetchBaiduHot() {
        const key = 'baidu_hot';
        const c = this.getCache(key); if (c) return c;
        const all = [];
        // 优先用百度财经热搜
        try { const d = await this.fetchHotFromUApi('baidu'); all.push(...d); } catch(e){}
        // 备用：top.baidu.com
        const seen = new Set();
        const result = all.filter(item => {
            if (seen.has(item.title)) return false;
            seen.add(item.title);
            return TechFilter.isRelevant(item.title);
        });
        this.setCache(key, result);
        return result;
    },

    // ==========================================
    // 科技资讯 — 大幅扩充数据源
    // ==========================================
    techSourceConfig: [
        // 原有
        { key: 'ithome', name: 'IT之家', rss: 'https://www.ithome.com/rss/', color: '#e13b3f' },
        { key: '36kr', name: '36氪', rss: 'https://36kr.com/feed', color: '#0066ff' },
        { key: 'sspai', name: '少数派', rss: 'https://sspai.com/feed', color: '#d93b3b' },
        { key: 'ifanr', name: '爱范儿', rss: 'https://www.ifanr.com/feed', color: '#d4233a' },
        { key: 'huxiu', name: '虎嗅', rss: 'https://www.huxiu.com/rss/0.xml', color: '#374151' },
        { key: 'leiphone', name: '雷锋网', rss: 'https://www.leiphone.com/rss', color: '#1890ff' },
        { key: '163tech', name: '网易科技', rss: 'https://www.163.com/dy/media/T1348631808562.rss', color: '#e60012' },
        { key: 'mydrivers', name: '快科技', rss: 'https://rss.mydrivers.com/', color: '#ff6600' },
        { key: 'donews', name: 'DoNews', rss: 'https://www.donews.com/rss', color: '#00a971' },
        // 新增源
        { key: 'geekpark', name: '极客公园', rss: 'https://www.geekpark.net/rss', color: '#00c4ff' },
        { key: 'pingwest', name: '品玩', rss: 'https://www.pingwest.com/feed', color: '#ff5722' },
        { key: 'cnbeta', name: 'cnBeta', rss: 'https://www.cnbeta.com/backend.php', color: '#009a61' },
        { key: 'coolapk', name: '酷安', rss: 'https://sspai.com/feed', color: '#00bcd4' },  // fallback
        { key: 'zaeke', name: '知客', rss: 'https://www.zaeke.com/feed', color: '#9c27b0' },
        { key: 'odaily', name: 'Odaily星球日报', rss: 'https://www.odaily.news/feed', color: '#ffb300' },
        { key: 'wallstreetcn', name: '华尔街见闻·科技', rss: 'https://wallstreetcn.com/rss/tech', color: '#d32f2f' },
        { key: 'jiqizhixin', name: '机器之心', rss: 'https://www.jiqizhixin.com/rss', color: '#512da8' },
        { key: 'quantamagazine', name: '量子位', rss: 'https://www.qbitai.com/feed', color: '#00796b' },
        { key: 'infoq', name: 'InfoQ', rss: 'https://www.infoq.cn/feed', color: '#0277bd' },
        { key: 'oschina', name: '开源中国', rss: 'https://www.oschina.net/news/rss', color: '#43a047' },
        { key: 'solidot', name: 'Solidot', rss: 'https://www.solidot.org/index.rss', color: '#546e7a' },
        { key: 'xinhua', name: '新华网科技', rss: 'https://www.xinhuanet.com/tech/xhxtech.xml', color: '#003d8c' },
        { key: 'tmtpost', name: '钛媒体', rss: 'https://www.tmtpost.com/rss.xml', color: '#ff9800' },
        { key: 'kejilie', name: '科技猎', rss: 'https://www.kejilie.com/feed', color: '#795548' },
        { key: 'thepaper', name: '澎湃科技', rss: 'https://www.thepaper.cn/rss_24.xml', color: '#1e88e5' },
    ],

    // 直接网页抓取源（无RSS，用JSONP/API）
    directSources: [
        {
            key: '36kr_hot', name: '36氪·热榜', color: '#ff6d00',
            async fetch() {
                try {
                    const d = await this.fetchJSON('https://www.36kr.com/pp/api/search/entity-search?page=1&per_page=60&sort=date&entity_type=article', 10000);
                    if (d && d.data && d.data.items) {
                        return d.data.items.map(i => ({
                            title: i.title || i.post_title || '',
                            description: i.description || i.summary || '',
                            url: `https://36kr.com/p/${i.id}`,
                            time: i.published_at || i.created_at || ''
                        }));
                    }
                } catch(e) {}
                return [];
            }
        },
    ],

    async fetchRSS(rssUrl) {
        try {
            const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}&api_key=`;
            const data = await this.fetchJSON(apiUrl, 20000);
            if (data && data.status === 'ok' && data.items) return data.items;
        } catch(e) {
            // rss2json 可能超时，静默跳过
        }
        return [];
    },

    /**
     * 获取所有科技资讯 - 聚合所有源
     */
    async fetchAllTechNews() {
        const cacheKey = 'tech_all';
        const cached = this.getCache(cacheKey);
        if (cached) return cached;

        const allArticles = [];

        // RSS源并行抓取
        const rssResults = await Promise.allSettled(
            this.techSourceConfig.map(async src => {
                try {
                    const items = await this.fetchRSS(src.rss);
                    return items.map(item => ({
                        source: src.name,
                        sourceKey: src.key,
                        sourceColor: src.color,
                        title: item.title || '',
                        description: this.stripHtml(item.description || item.content || ''),
                        url: item.link || '',
                        time: item.pubDate || '',
                        tags: this.extractTags(item.title + ' ' + (item.description || ''))
                    }));
                } catch(e) { return []; }
            })
        );

        rssResults.forEach(r => {
            if (r.status === 'fulfilled') allArticles.push(...r.value);
        });

        // 直接API源
        for (const ds of this.directSources) {
            try {
                const items = await ds.fetch();
                items.forEach(item => {
                    allArticles.push({
                        source: ds.name,
                        sourceKey: ds.key,
                        sourceColor: ds.color,
                        title: item.title,
                        description: this.stripHtml(item.description || ''),
                        url: item.url,
                        time: item.time || '',
                        tags: this.extractTags(item.title + ' ' + (item.description || ''))
                    });
                });
            } catch(e) {}
        }

        // 去重
        const seen = new Set();
        const unique = [];
        for (const a of allArticles) {
            const norm = a.title.trim().toLowerCase().slice(0, 60);
            if (!seen.has(norm)) { seen.add(norm); unique.push(a); }
        }

        // 时间排序（最新的在前）
        unique.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));

        // 科技内容过滤
        const filtered = unique.filter(a =>
            TechFilter.isRelevant(a.title + ' ' + a.description)
        );

        this.setCache(cacheKey, filtered);
        return filtered;
    },

    stripHtml(html) {
        if (!html) return '';
        const div = document.createElement('div');
        div.innerHTML = html;
        return (div.textContent || div.innerText || '').replace(/\s+/g, ' ').trim();
    },

    extractTags(text) {
        if (!text) return [];
        const tagMap = {
            '人工智能': ['人工智能','AI','大模型','GPT','ChatGPT','深度学习','机器学习','神经网络','LLM','AIGC','AGI','OpenAI','Claude','Gemini','Copilot','Sora','DeepSeek','通义千问','文心一言','混元','豆包','kimi','多模态','Agent','具身智能'],
            '手机': ['手机','iPhone','华为','小米','OPPO','vivo','三星','荣耀','折叠屏','旗舰','智能手机','苹果','Apple','Mate','骁龙','天玑','iOS','Android','鸿蒙','HarmonyOS','Pixel','Galaxy'],
            '芯片/半导体': ['芯片','半导体','CPU','GPU','NPU','高通','联发科','英特尔','AMD','英伟达','NVIDIA','台积电','光刻','晶圆','3nm','5nm','ASML','ARM','RISC-V','海思','麒麟','昇腾','HBM','中芯国际'],
            '新能源/电动车': ['新能源','电动车','特斯拉','比亚迪','蔚来','小鹏','理想','电池','充电','自动驾驶','FSD','固态电池','宁德时代','小米汽车','SU7','Cybertruck','换电','800V','碳化硅'],
            '数码评测': ['评测','开箱','体验','测评','上手','对比','横评','深度','首发'],
            '游戏': ['游戏','Steam','PS5','Xbox','Switch','电竞','3A','原神','黑神话','王者荣耀','DLSS','光追','虚幻引擎','云游戏'],
            '电脑硬件': ['电脑','笔记本','显卡','内存','SSD','主板','显示器','MacBook','ThinkPad','iPad','平板','机械键盘','鼠标','OLED','miniLED','DDR5'],
            '软件应用': ['软件','App','应用','操作系统','iOS','Android','Windows','macOS','浏览器','Chrome','WPS','开源','GitHub','Docker','Linux'],
            '互联网': ['互联网','社交','电商','直播','短视频','字节跳动','腾讯','阿里','百度','美团','拼多多','京东','快手','小红书','B站','知乎','微信','抖音','TikTok'],
            '科技创投': ['融资','IPO','上市','估值','投资','创投','VC','PE','创业','独角兽','红杉','高瓴','科创板','纳斯达克'],
            '智能硬件': ['智能硬件','IoT','可穿戴','智能家居','AR','VR','XR','Vision Pro','Quest','机器人','无人机','3D打印','智能手表','Apple Watch','AirPods','扫地机器人'],
            '区块链/Web3': ['区块链','Web3','比特币','以太坊','NFT','DeFi','加密','数字货币','DAO','智能合约','Solana','数字人民币','元宇宙']
        };
        const matched = [];
        const lt = text.toLowerCase();
        for (const [cat, kws] of Object.entries(tagMap)) {
            for (const kw of kws) {
                if (lt.includes(kw.toLowerCase())) { matched.push(cat); break; }
            }
        }
        return matched.slice(0, 3);
    }
};
