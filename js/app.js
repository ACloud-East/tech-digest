/**
 * TechDigest v3 - 主应用
 */
const { createApp, ref, computed, onMounted } = Vue;

const app = createApp({
    setup() {
        // ========== 导航 ==========
        const activePanel = ref('hotboard');
        const hotboardTab = ref('social');

        // ========== 热搜 ==========
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
        const techPageSize = 50;
        const techDisplayCount = ref(50);

        // ========== 全局 ==========
        const loading = computed(() => socialLoading.value || techLoading.value);
        const lastUpdate = ref('');
        const techSources = API.techSourceConfig;

        const totalArticles = computed(() => socialHotlist.value.length + techNews.value.length);
        const sourcesCount = computed(() => {
            const s = new Set();
            techNews.value.forEach(i => { if (i.source) s.add(i.source); });
            if (socialHotlist.value.length > 0) s.add(socialPlatform.value);
            return s.size;
        });

        const displayedTechNews = computed(() => techNews.value.slice(0, techDisplayCount.value));
        const hasMoreTech = computed(() => techDisplayCount.value < techNews.value.length);

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

        async function fetchSocialHotlist() {
            socialLoading.value = true; socialError.value = '';
            try {
                let data;
                switch (socialPlatform.value) {
                    case 'weibo': data = await API.fetchWeiboHot(); break;
                    case 'douyin': data = await API.fetchDouyinHot(); break;
                    case 'toutiao': data = await API.fetchToutiaoHot(); break;
                    case 'baidu': data = await API.fetchBaiduHot(); break;
                    default: data = await API.fetchWeiboHot();
                }
                socialHotlist.value = data;
                updateTimestamp();
            } catch(e) {
                socialError.value = e.message || '数据加载失败';
                socialHotlist.value = [];
            } finally { socialLoading.value = false; }
        }

        async function fetchTechNews() {
            techLoading.value = true; techError.value = '';
            techDisplayCount.value = techPageSize;
            try {
                const data = await API.fetchAllTechNews();
                techNews.value = data;
                updateTimestamp();
            } catch(e) {
                techError.value = e.message || '科技资讯加载失败';
                techNews.value = [];
            } finally { techLoading.value = false; }
        }

        function loadMoreTech() {
            techDisplayCount.value += techPageSize;
        }

        function refreshCurrentTab() {
            if (activePanel.value !== 'hotboard') return;
            API.clearOldCache();
            if (hotboardTab.value === 'social') fetchSocialHotlist();
            else fetchTechNews();
        }

        function updateTimestamp() {
            lastUpdate.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        }

        const filteredTechNews = computed(() => {
            let articles = displayedTechNews.value;
            if (techSourceFilter.value !== 'all') {
                const srcName = techSources.find(s => s.key === techSourceFilter.value)?.name;
                if (srcName) articles = articles.filter(a => a.source === srcName);
            }
            if (techSearchQuery.value.trim()) {
                const q = techSearchQuery.value.toLowerCase();
                articles = articles.filter(a =>
                    a.title.toLowerCase().includes(q) ||
                    (a.description && a.description.toLowerCase().includes(q))
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
        function getSourceColor(name) {
            const s = techSources.find(x => x.name === name);
            return s ? s.color : '#64748b';
        }
        function formatTime(ts) {
            if (!ts) return '';
            try {
                const d = new Date(ts), n = new Date(), diff = n - d;
                if (diff < 3600000) return `${Math.floor(diff/60000)}分钟前`;
                if (diff < 86400000) return `${Math.floor(diff/3600000)}小时前`;
                if (diff < 604800000) return `${Math.floor(diff/86400000)}天前`;
                return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
            } catch { return ts; }
        }
        function truncate(text, len) {
            if (!text) return '';
            return text.length <= len ? text : text.slice(0, len) + '...';
        }

        onMounted(() => { fetchSocialHotlist(); });

        return {
            activePanel, hotboardTab, socialPlatform, socialHotlist, socialLoading, socialError,
            techNews, techLoading, techError, techSourceFilter, techSearchQuery,
            loading, lastUpdate, techSources, totalArticles, sourcesCount,
            filteredTechNews, displayedTechNews, hasMoreTech,
            switchHotboardTab, switchSocialPlatform, fetchSocialHotlist, fetchTechNews,
            refreshCurrentTab, loadMoreTech, getTagClass, getSourceColor, formatTime, truncate
        };
    }
});
app.mount('#app');
