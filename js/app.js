/**
 * TechDigest v4 - 主应用
 * 新增 AI 文案生成面板
 */
const { createApp, ref, computed, onMounted, nextTick } = Vue;

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

        // ========== AI 文案生成 ==========
        const aiForm = ref({
            title: '',
            content: '',
            template: '',
            keywords: '',
            type: 'review',
            style: 'professional',
            wordCount: 800,
            audience: 'tech_fans',
            language: 'zh_professional',
            extraInstructions: '',
            typeLabel: '数码评测',
            styleLabel: '专业客观'
        });

        const aiOptions = ref({
            types: [
                { value: 'review', label: '数码评测' },
                { value: 'release', label: '新品发布' },
                { value: 'event', label: '活动报道' },
                { value: 'interview', label: '人物专访' },
                { value: 'exhibition', label: '新品展报' },
                { value: 'tutorial', label: '使用教程' },
                { value: 'opinion', label: '行业观点' },
                { value: 'comparison', label: '对比评测' },
                { value: 'news', label: '科技快讯' },
                { value: 'analysis', label: '深度分析' },
            ],
            styles: [
                { value: 'professional', label: '专业客观' },
                { value: 'lively', label: '活泼轻松' },
                { value: 'marketing', label: '营销推广' },
                { value: 'technical', label: '技术硬核' },
                { value: 'storytelling', label: '叙事故事' },
                { value: 'concise', label: '简洁明了' },
            ],
            wordCounts: [500, 800, 1000, 1500, 2000],
            audiences: [
                { value: 'tech_fans', label: '数码爱好者' },
                { value: 'general', label: '普通消费者' },
                { value: 'experts', label: '行业专家' },
                { value: 'investors', label: '投资者' },
                { value: 'developers', label: '开发者' },
            ],
            languages: [
                { value: 'zh_professional', label: '中文·专业' },
                { value: 'zh_casual', label: '中文·口语化' },
                { value: 'zh_literary', label: '中文·文艺' },
                { value: 'en_professional', label: 'English·Professional' },
            ],
        });

        const aiGenerating = ref(false);
        const aiResult = ref('');
        const aiResultTitle = ref('');
        const aiResultTime = ref('');
        const aiResultHtml = computed(() => {
            if (!aiResult.value) return '';
            return aiResult.value
                .split('\n')
                .filter(line => line.trim())
                .map(line => {
                    if (line.startsWith('## ')) return '<h2>' + line.slice(3) + '</h2>';
                    if (line.startsWith('### ')) return '<h3>' + line.slice(4) + '</h3>';
                    if (line.startsWith('- ')) return '<li>' + line.slice(2) + '</li>';
                    if (line.match(/^\d+[\.\、]/)) return '<li>' + line.replace(/^\d+[\.\、]\s*/, '') + '</li>';
                    return '<p>' + line + '</p>';
                })
                .join('\n');
        });

        // 类型/风格选中时同步label
        function updateAILabels() {
            const typeObj = aiOptions.value.types.find(t => t.value === aiForm.value.type);
            const styleObj = aiOptions.value.styles.find(s => s.value === aiForm.value.style);
            if (typeObj) aiForm.value.typeLabel = typeObj.label;
            if (styleObj) aiForm.value.styleLabel = styleObj.label;
        }

        // AI 生成文章（模拟 + API 预留）
        async function generateArticle() {
            updateAILabels();
            aiGenerating.value = true;
            aiResult.value = '';

            try {
                const result = await AIGenerator.generate(aiForm.value);
                aiResult.value = result.content;
                aiResultTitle.value = result.title;
                aiResultTime.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
                // 滚动到结果区
                await nextTick();
                const outputEl = document.querySelector('.ai-output-section');
                if (outputEl) outputEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } catch (e) {
                aiResult.value = '生成失败：' + (e.message || '未知错误，请重试');
                aiResultTitle.value = '';
            } finally {
                aiGenerating.value = false;
            }
        }

        function regenerateArticle() {
            aiResult.value = '';
            aiResultTitle.value = '';
            generateArticle();
        }

        async function copyResult() {
            try {
                const text = (aiResultTitle.value ? aiResultTitle.value + '\n\n' : '') + aiResult.value;
                await navigator.clipboard.writeText(text);
                // 短暂提示
                const btn = document.querySelector('.ai-action-btn');
                if (btn) {
                    const orig = btn.innerHTML;
                    btn.innerHTML = '<i class="fa-solid fa-check"></i> 已复制';
                    setTimeout(() => { btn.innerHTML = orig; }, 2000);
                }
            } catch {
                alert('复制失败，请手动选择文本复制');
            }
        }

        function downloadResult() {
            const text = (aiResultTitle.value ? aiResultTitle.value + '\n\n' : '') + aiResult.value;
            const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = (aiResultTitle.value || 'AI生成文章') + '.md';
            a.click();
            URL.revokeObjectURL(url);
        }

        // ========== 全局 ==========
        const loading = computed(() => socialLoading.value || techLoading.value || aiGenerating.value);
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

        // ========== 热点看板方法 ==========
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

        function loadMoreTech() { techDisplayCount.value += techPageSize; }

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
            refreshCurrentTab, loadMoreTech, getTagClass, getSourceColor, formatTime, truncate,
            // AI 文案生成
            aiForm, aiOptions, aiGenerating, aiResult, aiResultTitle, aiResultTime, aiResultHtml,
            generateArticle, regenerateArticle, copyResult, downloadResult,
        };
    }
});
app.mount('#app');
