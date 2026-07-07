/**
 * TechDigest - 科技数码文案聚合网站 v2
 * Vue 3 主应用
 */
const { createApp, ref, computed, onMounted } = Vue;

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

        const totalArticles = computed(() => socialHotlist.value.length + techNews.value.length);

        const sourcesCount = computed(() => {
            const activeSources = new Set();
            techNews.value.forEach(item => { if (item.source) activeSources.add(item.source); });
            if (socialHotlist.value.length > 0) activeSources.add(socialPlatform.value);
            return activeSources.size;
        });

        // ========== 方法 ==========
        function switchHotboardTab(tab) {
            hotboardTab.value = tab;
            if (tab === 'social' && socialHotlist.value.length === 0) fetchSocialHotlist();
            else if (tab === 'tech' && techNews.value.length === 0) fetchTechNews();
        }

        function switchSocialPlatform(platform) {
            socialPlatform.value = platform;
            fetchSocialHotlist();
        }

        /**
         * 获取社交媒体热搜 - 科技相关优先，但全部展示
         */
        async function fetchSocialHotlist() {
            socialLoading.value = true;
            socialError.value = '';

            try {
                let data;
                switch (socialPlatform.value) {
                    case 'weibo': data = await API.fetchWeiboHot(); break;
                    case 'douyin': data = await API.fetchDouyinHot(); break;
                    case 'toutiao': data = await API.fetchToutiaoHot(); break;
                    case 'baidu': data = await API.fetchBaiduHot(); break;
                    default: data = await API.fetchWeiboHot();
                }

                // 给每条标注是否科技相关，然后科技相关的排前面
                data.forEach(item => {
                    item.isTech = TechFilter.isRelevant(item.title);
                });
                // 排序：科技相关优先，保持原有顺序
                const techItems = data.filter(item => item.isTech);
                const otherItems = data.filter(item => !item.isTech);
                socialHotlist.value = [...techItems, ...otherItems];
                updateTimestamp();
            } catch (e) {
                socialError.value = e.message || '数据加载失败';
                socialHotlist.value = [];
            } finally {
                socialLoading.value = false;
            }
        }

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

        function refreshCurrentTab() {
            if (activePanel.value !== 'hotboard') return;
            API.clearOldCache();
            if (hotboardTab.value === 'social') fetchSocialHotlist();
            else fetchTechNews();
        }

        function updateTimestamp() {
            const now = new Date();
            lastUpdate.value = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        }

        const filteredTechNews = computed(() => {
            let articles = techNews.value;
            if (techSourceFilter.value !== 'all') {
                const sourceName = techSources.find(s => s.key === techSourceFilter.value)?.name;
                if (sourceName) articles = articles.filter(a => a.source === sourceName);
            }
            if (techSearchQuery.value.trim()) {
                const query = techSearchQuery.value.toLowerCase();
                articles = articles.filter(a =>
                    a.title.toLowerCase().includes(query) ||
                    (a.description && a.description.toLowerCase().includes(query))
                );
            }
            return articles;
        });

        function getTagClass(tag) {
            if (!tag) return '';
            if (tag === '新') return 'tag-new';
            if (tag === '热' || tag === '爆') return 'tag-hot';
            if (tag === '升' || tag === '荐') return 'tag-rising';
            if (tag === '商') return 'tag-ad';
            return '';
        }

        function getSourceColor(sourceName) {
            const source = techSources.find(s => s.name === sourceName);
            return source ? source.color : '#64748b';
        }

        function formatTime(timeStr) {
            if (!timeStr) return '';
            try {
                const date = new Date(timeStr);
                const now = new Date();
                const diff = now - date;
                if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
                if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
                if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`;
                return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
            } catch { return timeStr; }
        }

        function truncate(text, maxLen) {
            if (!text) return '';
            if (text.length <= maxLen) return text;
            return text.slice(0, maxLen) + '...';
        }

        function formatHeatDisplay(heat) {
            if (!heat) return '';
            return heat;
        }

        onMounted(() => { fetchSocialHotlist(); });

        return {
            activePanel, hotboardTab, socialPlatform, socialHotlist, socialLoading, socialError,
            techNews, techLoading, techError, techSourceFilter, techSearchQuery,
            loading, lastUpdate, techSources, totalArticles, sourcesCount, filteredTechNews,
            switchHotboardTab, switchSocialPlatform, fetchSocialHotlist, fetchTechNews,
            refreshCurrentTab, getTagClass, getSourceColor, formatTime, truncate, formatHeatDisplay
        };
    }
});

app.mount('#app');
