/**
 * TechDigest - 科技数码文案聚合网站
 * Vue 3 主应用
 */

const { createApp, ref, computed, watch, onMounted } = Vue;

const app = createApp({
    setup() {
        // ========== 导航状态 ==========
        const activePanel = ref('hotboard');
        const hotboardTab = ref('social');

        // ========== 社交媒体热搜 ==========
        const socialPlatform = ref('weibo');
        const socialHotlist = ref([]);
        const socialLoading = ref(false);
        const socialError = ref('');

        // ========== 科技资讯 ==========
        const techNews = ref([]);
        const techLoading = ref(false);
        const techError = ref('');
        const techSourceFilter = ref('all');
        const techSearchQuery = ref('');

        // ========== 全局状态 ==========
        const loading = computed(() => socialLoading.value || techLoading.value);
        const lastUpdate = ref('');

        const techSources = API.techSourceConfig;

        const totalArticles = computed(() => {
            return socialHotlist.value.length + techNews.value.length;
        });

        const sourcesCount = computed(() => {
            const activeSources = new Set();
            techNews.value.forEach(item => {
                if (item.source) activeSources.add(item.source);
            });
            // 社交媒体平台
            if (socialHotlist.value.length > 0) activeSources.add(socialPlatform.value);
            return activeSources.size;
        });

        // ========== 方法 ==========

        /**
         * 切换左侧面板
         */
        function switchPanel(panel) {
            activePanel.value = panel;
        }

        /**
         * 切换热点看板子Tab
         */
        function switchHotboardTab(tab) {
            hotboardTab.value = tab;
            if (tab === 'social' && socialHotlist.value.length === 0) {
                fetchSocialHotlist();
            } else if (tab === 'tech' && techNews.value.length === 0) {
                fetchTechNews();
            }
        }

        /**
         * 切换社交媒体平台
         */
        function switchSocialPlatform(platform) {
            socialPlatform.value = platform;
            fetchSocialHotlist();
        }

        /**
         * 获取社交媒体热搜
         */
        async function fetchSocialHotlist() {
            socialLoading.value = true;
            socialError.value = '';

            try {
                let data;
                switch (socialPlatform.value) {
                    case 'weibo':
                        data = await API.fetchWeiboHot();
                        break;
                    case 'douyin':
                        data = await API.fetchDouyinHot();
                        break;
                    case 'toutiao':
                        data = await API.fetchToutiaoHot();
                        break;
                    case 'baidu':
                        data = await API.fetchBaiduHot();
                        break;
                    default:
                        data = await API.fetchWeiboHot();
                }

                // 过滤科技相关内容
                socialHotlist.value = data.filter(item =>
                    TechFilter.isRelevant(item.title)
                );
                updateTimestamp();
            } catch (e) {
                socialError.value = e.message || '数据加载失败';
                socialHotlist.value = [];
            } finally {
                socialLoading.value = false;
            }
        }

        /**
         * 获取科技资讯
         */
        async function fetchTechNews() {
            techLoading.value = true;
            techError.value = '';

            try {
                const data = await API.fetchAllTechNews();
                techNews.value = data;
                updateTimestamp();
            } catch (e) {
                techError.value = e.message || '科技资讯加载失败';
                techNews.value = [];
            } finally {
                techLoading.value = false;
            }
        }

        /**
         * 刷新当前Tab
         */
        function refreshCurrentTab() {
            if (activePanel.value !== 'hotboard') return;

            if (hotboardTab.value === 'social') {
                API.clearOldCache();
                fetchSocialHotlist();
            } else {
                API.clearOldCache();
                fetchTechNews();
            }
        }

        /**
         * 更新时间戳
         */
        function updateTimestamp() {
            const now = new Date();
            lastUpdate.value = now.toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
        }

        /**
         * 过滤后的科技资讯
         */
        const filteredTechNews = computed(() => {
            let articles = techNews.value;

            // 来源过滤
            if (techSourceFilter.value !== 'all') {
                const sourceName = techSources.find(s => s.key === techSourceFilter.value)?.name;
                if (sourceName) {
                    articles = articles.filter(a => a.source === sourceName);
                }
            }

            // 搜索过滤
            if (techSearchQuery.value.trim()) {
                const query = techSearchQuery.value.toLowerCase();
                articles = articles.filter(a =>
                    a.title.toLowerCase().includes(query) ||
                    (a.description && a.description.toLowerCase().includes(query))
                );
            }

            return articles;
        });

        /**
         * 获取标签CSS类名
         */
        function getTagClass(tag) {
            if (!tag) return '';
            if (tag === '新') return 'tag-new';
            if (tag === '热' || tag === '爆') return 'tag-hot';
            if (tag === '升') return 'tag-rising';
            return '';
        }

        /**
         * 获取来源颜色
         */
        function getSourceColor(sourceName) {
            const source = techSources.find(s => s.name === sourceName);
            return source ? source.color : '#64748b';
        }

        /**
         * 格式化时间
         */
        function formatTime(timeStr) {
            if (!timeStr) return '';
            try {
                const date = new Date(timeStr);
                const now = new Date();
                const diff = now - date;

                if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
                if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
                if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`;

                return date.toLocaleDateString('zh-CN', {
                    month: 'short',
                    day: 'numeric'
                });
            } catch {
                return timeStr;
            }
        }

        /**
         * 截断文本
         */
        function truncate(text, maxLen) {
            if (!text) return '';
            if (text.length <= maxLen) return text;
            return text.slice(0, maxLen) + '...';
        }

        // ========== 生命周期 ==========
        onMounted(() => {
            // 默认加载微博热搜
            fetchSocialHotlist();
        });

        // ========== 返回 ==========
        return {
            // 状态
            activePanel,
            hotboardTab,
            socialPlatform,
            socialHotlist,
            socialLoading,
            socialError,
            techNews,
            techLoading,
            techError,
            techSourceFilter,
            techSearchQuery,
            loading,
            lastUpdate,
            techSources,
            totalArticles,
            sourcesCount,
            filteredTechNews,

            // 方法
            switchPanel,
            switchHotboardTab,
            switchSocialPlatform,
            fetchSocialHotlist,
            fetchTechNews,
            refreshCurrentTab,
            getTagClass,
            getSourceColor,
            formatTime,
            truncate
        };
    }
});

app.mount('#app');
