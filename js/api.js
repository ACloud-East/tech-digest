/**
 * TechDigest API 模块
 * 负责从各种数据源获取热搜和科技资讯
 */

const API = {
    // 缓存配置
    cachePrefix: 'techdigest_',
    cacheTTL: 5 * 60 * 1000, // 5分钟缓存

    /**
     * 从缓存获取数据
     */
    getCache(key) {
        try {
            const cached = localStorage.getItem(this.cachePrefix + key);
            if (!cached) return null;
            const { data, timestamp } = JSON.parse(cached);
            if (Date.now() - timestamp > this.cacheTTL) {
                localStorage.removeItem(this.cachePrefix + key);
                return null;
            }
            return data;
        } catch {
            return null;
        }
    },

    /**
     * 设置缓存
     */
    setCache(key, data) {
        try {
            localStorage.setItem(this.cachePrefix + key, JSON.stringify({
                data,
                timestamp: Date.now()
            }));
        } catch (e) {
            // localStorage 满了就清一下旧缓存
            this.clearOldCache();
        }
    },

    /**
     * 清除过期缓存
     */
    clearOldCache() {
        const keys = Object.keys(localStorage).filter(k => k.startsWith(this.cachePrefix));
        keys.forEach(k => localStorage.removeItem(k));
    },

    /**
     * 通用 fetch 封装（带超时和重试）
     */
    async fetchWithTimeout(url, options = {}, timeout = 15000) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json',
                    ...options.headers
                }
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } finally {
            clearTimeout(timer);
        }
    },

    // ==========================================
    // 社交媒体热搜 API
    // ==========================================

    /**
     * 获取微博热搜 - 通过多个备用接口
     */
    async fetchWeiboHot() {
        const cacheKey = 'weibo_hot';
        const cached = this.getCache(cacheKey);
        if (cached) return cached;

        // 备用方案列表
        const endpoints = [
            // 方案1: uapis.cn 聚合API
            async () => {
                const data = await this.fetchWithTimeout('https://uapis.cn/api/v1/misc/hotboard?type=weibo');
                if (data && data.code === 200 && data.data) {
                    return data.data.map(item => ({
                        title: item.title || item.word || '',
                        heat: item.desc || item.hotScore || '',
                        url: item.url || item.rawUrl || `https://s.weibo.com/weibo?q=${encodeURIComponent(item.title || item.word)}`,
                        tag: this.parseTag(item)
                    }));
                }
                return null;
            },

            // 方案2: 微博内部API
            async () => {
                const data = await this.fetchWithTimeout('https://weibo.com/ajax/side/hotSearch');
                if (data && data.data && data.data.realtime) {
                    return data.data.realtime.slice(0, 50).map(item => ({
                        title: item.word || item.note || '',
                        heat: item.num ? `${Math.round(item.num / 10000)}万` : '',
                        url: `https://s.weibo.com/weibo?q=${encodeURIComponent(item.word || '')}`,
                        tag: item.emoji || (item.label_name === '新' ? '新' : item.label_name === '热' ? '热' : '')
                    }));
                }
                return null;
            }
        ];

        for (const endpoint of endpoints) {
            try {
                const result = await endpoint();
                if (result && result.length > 0) {
                    this.setCache(cacheKey, result);
                    return result;
                }
            } catch (e) {
                console.warn('微博热搜接口失败，尝试备用:', e.message);
                continue;
            }
        }

        throw new Error('微博热搜数据获取失败，请稍后重试');
    },

    /**
     * 获取抖音热搜
     */
    async fetchDouyinHot() {
        const cacheKey = 'douyin_hot';
        const cached = this.getCache(cacheKey);
        if (cached) return cached;

        const endpoints = [
            async () => {
                const data = await this.fetchWithTimeout('https://uapis.cn/api/v1/misc/hotboard?type=douyin');
                if (data && data.code === 200 && data.data) {
                    return data.data.map(item => ({
                        title: item.title || item.word || '',
                        heat: item.desc || item.hotScore || '',
                        url: item.url || '#',
                        tag: this.parseTag(item)
                    }));
                }
                return null;
            }
        ];

        for (const endpoint of endpoints) {
            try {
                const result = await endpoint();
                if (result && result.length > 0) {
                    this.setCache(cacheKey, result);
                    return result;
                }
            } catch (e) {
                console.warn('抖音热搜接口失败:', e.message);
                continue;
            }
        }

        throw new Error('抖音热搜数据获取失败，请稍后重试');
    },

    /**
     * 获取今日头条热搜
     */
    async fetchToutiaoHot() {
        const cacheKey = 'toutiao_hot';
        const cached = this.getCache(cacheKey);
        if (cached) return cached;

        const endpoints = [
            async () => {
                const data = await this.fetchWithTimeout('https://uapis.cn/api/v1/misc/hotboard?type=toutiao');
                if (data && data.code === 200 && data.data) {
                    return data.data.map(item => ({
                        title: item.title || item.word || '',
                        heat: item.desc || item.hotScore || '',
                        url: item.url || '#',
                        tag: this.parseTag(item)
                    }));
                }
                return null;
            }
        ];

        for (const endpoint of endpoints) {
            try {
                const result = await endpoint();
                if (result && result.length > 0) {
                    this.setCache(cacheKey, result);
                    return result;
                }
            } catch (e) {
                console.warn('今日头条热搜接口失败:', e.message);
                continue;
            }
        }

        throw new Error('今日头条热搜数据获取失败，请稍后重试');
    },

    /**
     * 获取百度热搜
     */
    async fetchBaiduHot() {
        const cacheKey = 'baidu_hot';
        const cached = this.getCache(cacheKey);
        if (cached) return cached;

        const endpoints = [
            async () => {
                const data = await this.fetchWithTimeout('https://uapis.cn/api/v1/misc/hotboard?type=baidu');
                if (data && data.code === 200 && data.data) {
                    return data.data.map(item => ({
                        title: item.title || item.word || '',
                        heat: item.desc || item.hotScore || '',
                        url: item.url || '#',
                        tag: this.parseTag(item)
                    }));
                }
                return null;
            },
            // 备用: 百度top接口
            async () => {
                const data = await this.fetchWithTimeout('https://top.baidu.com/board?tab=realtime');
                // 如果返回的是HTML,需要解析;这里作为fallback返回null
                return null;
            }
        ];

        for (const endpoint of endpoints) {
            try {
                const result = await endpoint();
                if (result && result.length > 0) {
                    this.setCache(cacheKey, result);
                    return result;
                }
            } catch (e) {
                console.warn('百度热搜接口失败:', e.message);
                continue;
            }
        }

        throw new Error('百度热搜数据获取失败，请稍后重试');
    },

    /**
     * 解析热搜标签
     */
    parseTag(item) {
        if (item.label_name === '新') return '新';
        if (item.label_name === '热') return '热';
        if (item.label_name === '爆') return '爆';
        if (item.hotChange && parseInt(item.hotChange) > 0) return '升';
        if (item.emoji) return item.emoji;
        return '';
    },

    // ==========================================
    // 科技资讯 API（通过 RSS2JSON）
    // ==========================================

    /**
     * 科技资讯源配置
     */
    techSourceConfig: [
        { key: 'ithome', name: 'IT之家', rss: 'https://www.ithome.com/rss/', color: '#e13b3f' },
        { key: '36kr', name: '36氪', rss: 'https://36kr.com/feed', color: '#0066ff' },
        { key: 'sspai', name: '少数派', rss: 'https://sspai.com/feed', color: '#d93b3b' },
        { key: 'ifanr', name: '爱范儿', rss: 'https://www.ifanr.com/feed', color: '#000000' },
        { key: 'huxiu', name: '虎嗅', rss: 'https://www.huxiu.com/rss/0.xml', color: '#374151' },
        { key: 'leiphone', name: '雷锋网', rss: 'https://www.leiphone.com/us/rss', color: '#1890ff' },
        { key: '163tech', name: '网易科技', rss: 'https://www.163.com/dy/media/T1348631808562.rss', color: '#e60012' },
        { key: 'mydrivers', name: '快科技', rss: 'https://rss.mydrivers.com/', color: '#ff6600' },
        { key: 'donews', name: 'DoNews', rss: 'https://www.donews.com/rss', color: '#00a971' },
        { key: 'xinhua', name: '新华网科技', rss: 'https://www.xinhuanet.com/tech/xhxtech.xml', color: '#003d8c' }
    ],

    /**
     * 通过 rss2json 获取RSS内容
     */
    async fetchRSS(rssUrl) {
        const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`;
        const data = await this.fetchWithTimeout(apiUrl, {}, 20000);
        if (data && data.status === 'ok' && data.items) {
            return data.items;
        }
        return [];
    },

    /**
     * 获取所有科技资讯
     */
    async fetchAllTechNews() {
        const cacheKey = 'tech_news_all';
        const cached = this.getCache(cacheKey);
        if (cached) return cached;

        const allArticles = [];
        const results = await Promise.allSettled(
            this.techSourceConfig.map(async (source) => {
                try {
                    const items = await this.fetchRSS(source.rss);
                    return items.map(item => ({
                        source: source.name,
                        sourceKey: source.key,
                        sourceColor: source.color,
                        title: item.title || '',
                        description: this.stripHtml(item.description || item.content || ''),
                        url: item.link || '',
                        time: item.pubDate || '',
                        thumbnail: item.thumbnail || '',
                        tags: this.extractTags(item.title + ' ' + (item.description || ''))
                    }));
                } catch (e) {
                    console.warn(`${source.name} RSS获取失败:`, e.message);
                    return [];
                }
            })
        );

        results.forEach(result => {
            if (result.status === 'fulfilled') {
                allArticles.push(...result.value);
            }
        });

        // 按时间排序
        allArticles.sort((a, b) => new Date(b.time) - new Date(a.time));

        // 过滤：只保留科技相关文章
        const filtered = allArticles.filter(article =>
            TechFilter.isRelevant(article.title + ' ' + article.description)
        );

        this.setCache(cacheKey, filtered);
        return filtered;
    },

    /**
     * 去除HTML标签
     */
    stripHtml(html) {
        if (!html) return '';
        const div = document.createElement('div');
        div.innerHTML = html;
        return div.textContent || div.innerText || '';
    },

    /**
     * 提取科技领域标签
     */
    extractTags(text) {
        if (!text) return [];
        const tagMap = {
            '人工智能': ['人工智能', 'AI', '大模型', 'GPT', 'ChatGPT', '深度学习', '机器学习', '神经网络', 'LLM', 'AIGC', 'AGI'],
            '手机': ['手机', 'iPhone', '华为', '小米', 'OPPO', 'vivo', '三星', '荣耀', '折叠屏', '旗舰', '智能手机'],
            '芯片/半导体': ['芯片', '半导体', 'CPU', 'GPU', 'NPU', '高通', '联发科', '英特尔', 'AMD', '英伟达', 'NVIDIA', '台积电', '光刻'],
            '新能源/电动车': ['新能源', '电动车', '特斯拉', '比亚迪', '蔚来', '小鹏', '理想', '电池', '充电', '自动驾驶', 'FSD', '固态电池'],
            '数码评测': ['评测', '开箱', '体验', '测评', '上手', '对比'],
            '游戏': ['游戏', 'Steam', '主机', 'PS5', 'Xbox', 'Switch', '电竞', '3A', '原神', '黑神话'],
            '电脑硬件': ['电脑', '笔记本', '显卡', '内存', 'SSD', '主板', '显示器', 'MacBook', 'ThinkPad'],
            '软件应用': ['软件', 'App', '应用', '操作系统', 'iOS', 'Android', 'Windows', 'macOS', '浏览器'],
            '互联网': ['互联网', '社交', '电商', '直播', '短视频', '搜索', '字节跳动', '腾讯', '阿里', '百度', '美团'],
            '科技创投': ['融资', 'IPO', '上市', '估值', '投资', '创投', 'VC', 'PE', '创业', '独角兽'],
            '智能硬件': ['智能硬件', 'IoT', '可穿戴', '智能家居', 'AR', 'VR', 'XR', 'Vision Pro', 'Quest', '机器人'],
            '区块链/Web3': ['区块链', 'Web3', '比特币', '以太坊', 'NFT', 'DeFi', '加密', '数字货币', 'DAO']
        };

        const matchedTags = [];
        const lowerText = text.toLowerCase();

        for (const [category, keywords] of Object.entries(tagMap)) {
            for (const keyword of keywords) {
                if (lowerText.includes(keyword.toLowerCase())) {
                    if (!matchedTags.includes(category)) {
                        matchedTags.push(category);
                    }
                    break;
                }
            }
        }

        return matchedTags.slice(0, 3);
    }
};
