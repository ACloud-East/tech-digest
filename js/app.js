/**
 * TechDigest v4 - 主应用
 * 新增 AI 文案生成面板
 */
const { createApp, ref, computed, onMounted, nextTick } = Vue;

const app = createApp({
    setup() {
        // ========== 导航 ==========
        const activePanel = ref('hotboard');
        // 默认展示「科技资讯热点看板」（数据来自本地预抓取，最稳定；打开即见，无需点击）
        const hotboardTab = ref('tech');

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
            wordCount: 'auto',
            audience: 'tech_fans',
            language: 'zh_professional',
            extraInstructions: '',
            sources: '',
            webSearch: false,   // 联网搜索开关（默认关）：开启后系统自动检索真实参数/数据并作为参考文献引用
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
            wordCounts: ['auto', 500, 800, 1000, 1500, 2000],
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
        const aiResultPlain = ref('');    // 非结构式文本
        const aiTab = ref('structured');  // 'structured' | 'plain'
        const aiShowOutput = ref(false);  // 是否已显示结果面板（点击生成即展示）
        const aiGeneratingStructured = ref(false);
        const aiGeneratingPlain = ref(false);
        const aiResultSources = ref([]);  // 当前结果对应的来源链接列表（展示用，仅 http(s) URL）
        const aiResultSourcesMeta = ref([]);  // 与 aiResultSources 一一对应：{url, ok, note}
        const aiResultReferences = ref([]);  // 参考文献列表（展示用）：[{title, url, ok, note}]，优先来自函数端联网检索/抓取结果
        const aiHistory = ref([]);        // 历史记录
        const aiHistoryOpen = ref(false); // 历史面板是否展开
        const hoveredCite = ref(null);    // 当前鼠标悬停的内联引用编号
        const hoveredSource = ref(null);  // 当前悬停的来源列表项编号
        const citationTooltip = ref({ visible: false, cite: null, source: '', top: 0, left: 0 }); // 引用上标 tooltip

        // ====== API 设置（BYOK：用户自带 key，仅存本机 localStorage） ======
        const aiApi = ref({
            show: false,
            key: '',
            basePreset: 'vectorengine', // vectorengine | deepseek | custom
            customBase: '',
            model: 'deepseek-v3',
            showKey: false,
        });

        const LS_KEY = 'td_ai_api_v1';

        function basePresetToUrl(preset, custom) {
            if (preset === 'deepseek') return 'https://api.deepseek.com/v1';
            if (preset === 'custom') return (custom || '').trim();
            return ''; // vectorengine → 留空，由代理函数用默认地址
        }

        function applyApiSettings() {
            const a = aiApi.value;
            AIGenerator.config.userApiKey = (a.key || '').trim();
            AIGenerator.config.userApiBase = basePresetToUrl(a.basePreset, a.customBase);
            AIGenerator.config.userApiModel = (a.model || '').trim();
        }

        function loadApiSettings() {
            try {
                const raw = localStorage.getItem(LS_KEY);
                if (raw) {
                    const o = JSON.parse(raw);
                    if (o.key) aiApi.value.key = o.key;
                    if (o.basePreset) aiApi.value.basePreset = o.basePreset;
                    if (o.customBase) aiApi.value.customBase = o.customBase;
                    if (o.model) aiApi.value.model = o.model;
                }
            } catch (_) {}
            applyApiSettings();
        }

        function saveApiSettings() {
            const a = aiApi.value;
            const payload = {
                key: (a.key || '').trim(),
                basePreset: a.basePreset,
                customBase: (a.customBase || '').trim(),
                model: (a.model || '').trim() || 'deepseek-v3',
            };
            try { localStorage.setItem(LS_KEY, JSON.stringify(payload)); } catch (_) {}
            applyApiSettings();
            alert('已保存：本次及之后的生成将使用你配置的 API。用完可在「我的 key」里直接更换。');
        }

        function clearApiSettings() {
            aiApi.value.key = '';
            aiApi.value.customBase = '';
            try { localStorage.removeItem(LS_KEY); } catch (_) {}
            applyApiSettings();
            alert('已清除你的 key，将回退到站点默认 key / 本地模板。');
        }

        const aiApiStatus = computed(() => {
            const k = (aiApi.value.key || '').trim();
            if (k) {
                const masked = k.length > 10 ? (k.slice(0, 6) + '…' + k.slice(-4)) : k;
                return { cls: 'ok', icon: 'fa-solid fa-circle-check', text: '正在使用你自己的 key：' + masked };
            }
            return { cls: 'warn', icon: 'fa-solid fa-circle-info', text: '未填 key：将使用站点默认 API（VectorEngine / deepseek-v3）' };
        });

        loadApiSettings();
        loadHistory();

        // 把带 [1] 内联引用的文本解析为「块→引用段」结构，便于按段高亮与 tooltip
        const aiResultBlocks = computed(() => parseCitedText(aiResult.value));
        const aiResultPlainBlocks = computed(() => parseCitedText(aiResultPlain.value));

        function parseCitedText(text) {
            if (!text) return [];
            const lines = text.split('\n').filter(line => line.trim());
            const blocks = [];
            lines.forEach(line => {
                let type = 'p';
                let content = line;
                if (line.startsWith('## ')) { type = 'h2'; content = line.slice(3); }
                else if (line.startsWith('### ')) { type = 'h3'; content = line.slice(4); }
                else if (line.startsWith('- ')) { type = 'li'; content = line.slice(2); }
                else if (/^\d+[\.\、]/.test(line)) { type = 'li'; content = line.replace(/^\d+[\.\、]\s*/, ''); }

                const segments = [];
                const parts = content.split(/(\[\d+(?:,\d+)*\]|\[\?\])/);
                let currentText = '';
                let hasCitation = false;

                parts.forEach(part => {
                    if (part.match(/^\[\d+(?:,\d+)*\]$/)) {
                        hasCitation = true;
                        const cites = part.slice(1, -1).split(',').map(n => parseInt(n, 10));
                        segments.push({ text: currentText, cites });
                        currentText = '';
                    } else if (part === '[?]') {
                        hasCitation = true;
                        segments.push({ text: currentText, cites: ['?'] });
                        currentText = '';
                    } else {
                        currentText += part;
                    }
                });
                if (currentText || !hasCitation) {
                    segments.push({ text: currentText, cites: [] });
                }
                blocks.push({ type, segments });
            });
            return blocks;
        }

        function isCiteActive(cites) {
            if (!cites || !cites.length) return false;
            return cites.some(c => String(c) === hoveredCite.value || String(c) === hoveredSource.value);
        }

        function showCiteTooltip(cite, event) {
            hoveredCite.value = String(cite);
            const target = event.target;
            const container = target.closest('.ai-output-content');
            if (!container) return;
            const rect = target.getBoundingClientRect();
            const contRect = container.getBoundingClientRect();
            const ref = (aiResultReferences.value[parseInt(cite, 10) - 1]) || null;
            const srcText = ref ? (ref.title ? ref.title + '\n' + ref.url : ref.url) : '未知来源';
            citationTooltip.value = {
                visible: true,
                cite,
                source: srcText.length > 160 ? srcText.slice(0, 160) + '…' : srcText,
                top: rect.bottom - contRect.top + 8,
                left: rect.left - contRect.left + rect.width / 2,
            };
        }

        function hideCiteTooltip() {
            hoveredCite.value = null;
            citationTooltip.value.visible = false;
        }

        function scrollToSource(cite) {
            const idx = parseInt(cite, 10) - 1;
            if (idx < 0 || idx >= aiResultReferences.value.length) return;
            const items = document.querySelectorAll('.ai-sources-list li');
            if (items[idx]) {
                items[idx].scrollIntoView({ behavior: 'smooth', block: 'center' });
                hoveredSource.value = String(cite);
                setTimeout(() => { hoveredSource.value = null; }, 1200);
            }
        }

        // 总字数（与生成目标口径一致：仅计 中文字符 + 字母数字，排除标点/空白/Markdown 标记）
        const aiTotalChars = computed(() => {
            const text = aiTab.value === 'plain' ? aiResultPlain.value : aiResult.value;
            const m = (text || '').match(/[一-龥a-zA-Z0-9]/g);
            return m ? m.length : 0;
        });

        // 类型/风格选中时同步label
        function updateAILabels() {
            const typeObj = aiOptions.value.types.find(t => t.value === aiForm.value.type);
            const styleObj = aiOptions.value.styles.find(s => s.value === aiForm.value.style);
            if (typeObj) aiForm.value.typeLabel = typeObj.label;
            if (styleObj) aiForm.value.styleLabel = styleObj.label;
        }

        // 解析来源文本为列表（仅保留 http(s) URL，与函数端抓取逻辑一致，便于按索引对应抓取状态）
        function parseSources(str) {
            if (!str || !str.trim()) return [];
            return str.split(/[\n,，;；]+/).map(s => s.trim()).filter(s => /^https?:\/\//i.test(s)).slice(0, 6);
        }
        function isUrl(s) { return /^https?:\/\//i.test((s || '').trim()); }

        // ===== 历史记录（存本机 localStorage，跨会话保留） =====
        const LS_HISTORY_KEY = 'td_ai_history_v1';
        function loadHistory() {
            try {
                const raw = localStorage.getItem(LS_HISTORY_KEY);
                if (raw) aiHistory.value = JSON.parse(raw) || [];
            } catch (_) {}
        }
        function persistHistory() {
            try { localStorage.setItem(LS_HISTORY_KEY, JSON.stringify(aiHistory.value.slice(0, 50))); } catch (_) {}
        }
        function saveToHistory(item) {
            aiHistory.value.unshift(item);
            if (aiHistory.value.length > 50) aiHistory.value = aiHistory.value.slice(0, 50);
            persistHistory();
        }
        function deleteHistory(id) {
            aiHistory.value = aiHistory.value.filter(h => h.id !== id);
            persistHistory();
        }
        function clearHistory() {
            if (!confirm('确定清空全部历史记录吗？')) return;
            aiHistory.value = [];
            persistHistory();
        }
        function restoreHistory(item) {
            aiForm.value.type = item.type || 'review';
            aiForm.value.style = item.style || 'professional';
            aiForm.value.audience = item.audience || 'tech_fans';
            aiForm.value.language = item.language || 'zh_professional';
            aiForm.value.wordCount = item.wordCount || 800;
            aiForm.value.title = item.inputTitle || '';
            aiForm.value.content = item.inputContent || '';
            aiForm.value.sources = item.inputSources || '';
            aiForm.value.keywords = item.inputKeywords || '';
            aiForm.value.template = item.inputTemplate || '';
            aiForm.value.extraInstructions = item.inputExtra || '';
            updateAILabels();
            aiShowOutput.value = true;
            aiResult.value = item.resultContent || '';
            aiResultPlain.value = item.resultPlain || '';
            aiResultTitle.value = item.resultTitle || '';
            aiResultTime.value = item.time || '';
            aiResultSources.value = item.inputSources ? parseSources(item.inputSources) : [];
            aiResultSourcesMeta.value = (item.sourcesMeta && Array.isArray(item.sourcesMeta)) ? item.sourcesMeta : [];
            aiResultReferences.value = (item.references && Array.isArray(item.references) && item.references.length)
                ? item.references
                : aiResultSources.value.map(u => ({ title: u, url: u, ok: true, note: '' }));
            aiTab.value = 'structured';
            const outputEl = document.querySelector('.ai-output-section');
            if (outputEl) outputEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        function toggleHistory() { aiHistoryOpen.value = !aiHistoryOpen.value; }

        // AI 生成文章（结构式优先流式打字展示，非结构式随后流式填充）
        async function generateArticle() {
            updateAILabels();
            aiGenerating.value = true;
            aiShowOutput.value = true;
            aiResult.value = '';
            aiResultPlain.value = '';
            aiResultTitle.value = '';
            aiTab.value = 'structured';
            // 立即展示来源框：只要用户填了来源 URL 或开启联网搜索，框就出现，避免后续某次生成失败时整框丢失
            aiResultSources.value = parseSources(aiForm.value.sources);
            aiResultReferences.value = aiResultSources.value.map(u => ({ title: u, url: u, ok: true, note: '' }));

            try {
                // 结构式：逐字流式展示（默认可见 tab）
                aiGeneratingStructured.value = true;
                const onToken = (partial) => {
                    if (partial && partial.title) aiResultTitle.value = partial.title;
                    if (partial && partial.content !== undefined) aiResult.value = partial.content;
                };
                const result = await AIGenerator.generate(aiForm.value, onToken);
                aiResult.value = result.content;
                aiResultTitle.value = result.title;
                // 优先用函数端回传的 references（联网检索/抓取结果），否则回退到用户输入 URL
                aiResultReferences.value = (result.references && result.references.length)
                    ? result.references
                    : aiResultSources.value.map(u => ({ title: u, url: u, ok: true, note: '' }));
                aiResultSources.value = aiResultReferences.value.map(r => r.url);
                aiResultSourcesMeta.value = aiResultReferences.value.map(r => ({ url: r.url, ok: r.ok, note: r.note }));
                aiResultTime.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
                aiGeneratingStructured.value = false; // 结构式完成，光标停止

                // 非结构式：流式填充（隐藏，切到该 tab 时已就绪）
                aiGeneratingPlain.value = true;
                const onTokenPlain = (partial) => {
                    if (partial && partial.content !== undefined) aiResultPlain.value = partial.content;
                };
                const plainResult = await AIGenerator.generate({ ...aiForm.value, plain: true }, onTokenPlain);
                aiResultPlain.value = plainResult.content;
                aiGeneratingPlain.value = false; // 非结构式完成

                // 来源展示 + 历史记录
                aiResultSources.value = parseSources(aiForm.value.sources);
                saveToHistory({
                    id: Date.now() + '_' + Math.random().toString(36).slice(2, 7),
                    time: new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
                    resultTitle: aiResultTitle.value,
                    resultContent: aiResult.value,
                    resultPlain: aiResultPlain.value,
                    type: aiForm.value.type,
                    style: aiForm.value.style,
                    audience: aiForm.value.audience,
                    language: aiForm.value.language,
                    wordCount: aiForm.value.wordCount,
                    inputTitle: aiForm.value.title,
                    inputContent: aiForm.value.content,
                    inputSources: aiForm.value.sources,
                    references: aiResultReferences.value,
                    sourcesMeta: aiResultSourcesMeta.value,
                    inputKeywords: aiForm.value.keywords,
                    inputTemplate: aiForm.value.template,
                    inputExtra: aiForm.value.extraInstructions,
                });

                // 滚动到结果区
                await nextTick();
                const outputEl = document.querySelector('.ai-output-section');
                if (outputEl) outputEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } catch (e) {
                aiResult.value = '生成失败：' + (e.message || '未知错误，请重试');
                aiResultTitle.value = '';
            } finally {
                aiGenerating.value = false;
                aiGeneratingStructured.value = false;
                aiGeneratingPlain.value = false;
            }
        }

        function regenerateArticle() {
            aiShowOutput.value = true;
            aiResult.value = '';
            aiResultPlain.value = '';
            aiResultTitle.value = '';
            aiTab.value = 'structured';
            generateArticle();
        }

        async function copyResult() {
            try {
                const text = (aiResultTitle.value ? aiResultTitle.value + '\n\n' : '') +
                    (aiTab.value === 'plain' ? aiResultPlain.value : aiResult.value);
                await navigator.clipboard.writeText(text);
            } catch {
                alert('复制失败，请手动选择文本复制');
            }
        }

        function downloadResult() {
            const text = (aiResultTitle.value ? aiResultTitle.value + '\n\n' : '') +
                (aiTab.value === 'plain' ? aiResultPlain.value : aiResult.value);
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

        // 数据源自身的抓取时间（来自 news.json 的 updateTime，由 GitHub Actions 定时生成）
        // 数据源自身的抓取时间（来自 news.json 的 updateTime，由 GitHub Actions 每小时定时生成）
        const dataUpdateTime = ref('');
        // 实时心跳：每 30 秒刷新一次，让“X 分钟前”类相对时间始终相对于用户当前时钟
        const nowTick = ref(Date.now());
        setInterval(() => { nowTick.value = Date.now(); }, 30000);

        // "数据更新于 X 前" —— 反映服务器最近一次成功抓取的时间（真实数据新鲜度，与列表内容时间一致）
        const dataAgeText = computed(() => {
            if (!dataUpdateTime.value) return '';
            try {
                const d = new Date(dataUpdateTime.value), diff = nowTick.value - d.getTime();
                if (diff < 0) return '刚刚更新';
                if (diff < 60000) return '刚刚更新';
                if (diff < 3600000) return `数据更新于 ${Math.floor(diff / 60000)} 分钟前`;
                if (diff < 86400000) return `数据更新于 ${Math.floor(diff / 3600000)} 小时前`;
                return `数据更新于 ${Math.floor(diff / 86400000)} 天前`;
            } catch { return ''; }
        });
        // 数据源抓取的绝对本地时间（辅助说明）
        const dataUpdateAbsolute = computed(() => {
            if (!dataUpdateTime.value) return '';
            try {
                return new Date(dataUpdateTime.value).toLocaleString('zh-CN', {
                    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
                });
            } catch { return ''; }
        });

        // 注意：按用户要求「禁止自动更新，只手动更新」——此处不再注册任何定时/切回标签页的自动重抓。
        // 仅保留手动刷新按钮（refreshCurrentTab）触发 fetchTechNews / fetchSocialHotlist。
        // nowTick 仅用于让「X 分钟前」等相对时间标签随当前时钟实时滚动（不重新拉取数据）。

        const techSources = API.techSourceConfig;

        // 侧边栏统计数据（全部来自真实数据，非硬编码）
        const totalArticles = computed(() => techNews.value.length);
        const sourcesCount = computed(() => {
            const s = new Set();
            techNews.value.forEach(i => { if (i.source) s.add(i.source); });
            return s.size;
        });
        // 总数据源 = 科技资讯源 + 社交媒体平台
        const totalSourcesCount = computed(() => {
            let count = sourcesCount.value;
            // 社交媒体平台（微博、抖音、头条、百度）
            if (socialHotlist.value.length > 0) count += 1;
            return count;
        });

        // ========== 风格分析（基于当前真实数据的纯客户端分析，无需 API）==========
        const styleAnalysis = computed(() => {
            const arts = techNews.value;
            const total = arts.length;
            if (!total) return null;

            // 概览
            const lens = arts.map(a => (a.description || '').length).filter(Boolean);
            const avgLen = lens.length ? Math.round(lens.reduce((s, x) => s + x, 0) / lens.length) : 0;
            const times = arts.map(a => new Date(a.time).getTime()).filter(t => !isNaN(t));
            const minT = times.length ? new Date(Math.min(...times)) : null;
            const maxT = times.length ? new Date(Math.max(...times)) : null;
            const spanDays = (minT && maxT) ? Math.max(1, Math.round((maxT - minT) / 86400000) + 1) : 1;

            // 热词：以文章标签（抓取时已提炼的主题词）为主；若不足 30 个，
            // 再用科技词表从标题/正文中补充高频词，让词云更饱满（纯本地，无需 API）
            const tagCount = {};
            arts.forEach(a => (a.tags || []).forEach(t => { const k = (t || '').trim(); if (k) tagCount[k] = (tagCount[k] || 0) + 1; }));
            const KW_DICT = ['苹果','华为','小米','特斯拉','英伟达','微软','谷歌','阿里','腾讯','百度','字节','OpenAI','ChatGPT','大模型','AIGC','半导体','新能源','电动车','自动驾驶','iPhone','安卓','鸿蒙','量子','机器人','5G','6G','GPU','算力','数据中心','操作系统','折叠屏','电池','卫星','航天','火箭','空间站','元宇宙','京东','美团','拼多多','比亚迪','蔚来','理想','小鹏','英特尔','AMD','高通','三星','索尼','任天堂','网易','抖音','快手','小红书','微博','Vision','Mac','Windows','Linux','RISC','脑机'];
            const kwCount = {};
            arts.forEach(a => {
                const txt = ((a.title || '') + ' ' + (a.description || '')).toLowerCase();
                const seen = new Set();
                KW_DICT.forEach(k => { if (!seen.has(k) && txt.includes(k.toLowerCase())) { seen.add(k); kwCount[k] = (kwCount[k] || 0) + 1; } });
            });
            // 去掉与已有标签重复/包含关系的词，避免词云冗余
            const tagKeys = Object.keys(tagCount);
            const isRedundant = k => tagKeys.some(t => t.includes(k) || k.includes(t));
            const kwEntries = Object.entries(kwCount).filter(([k]) => !isRedundant(k)).sort((x, y) => y[1] - x[1]);
            const tagEntries = Object.entries(tagCount).sort((x, y) => y[1] - x[1]);
            const hotWords = [...tagEntries, ...kwEntries].slice(0, 30).map(([w, c]) => ({ w, c }));
            const maxC = hotWords.length ? hotWords[0].c : 1;
            const minC = hotWords.length ? hotWords[hotWords.length - 1].c : 1;
            const palette = ['#6366f1', '#ec4899', '#06b6d4', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#3b82f6'];
            hotWords.forEach((h, i) => {
                h.size = +(0.85 + (maxC === minC ? 0.6 : (h.c - minC) / (maxC - minC)) * 1.5).toFixed(2);
                h.color = palette[i % palette.length];
            });

            // 来源活跃度 Top 12（使用鲜亮调色板，避免个别媒体品牌色为黑/深色时与背景板融合）
            const srcPalette = ['#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#3b82f6', '#ef4444', '#14b8a6', '#f97316', '#a855f7', '#22c55e'];
            const srcCount = {};
            arts.forEach(a => { const s = a.source; if (!s) return; srcCount[s] = (srcCount[s] || 0) + 1; });
            const topSources = Object.entries(srcCount).sort((x, y) => y[1] - x[1]).slice(0, 12)
                .map(([name, c], i) => ({ name, c, color: srcPalette[i % srcPalette.length] }));
            const maxSrc = topSources.length ? topSources[0].c : 1;
            topSources.forEach(s => s.pct = Math.round(s.c / maxSrc * 100));

            // 情感/倾向分布（基于标题+正文关键词匹配）
            const POS = ['增长', '突破', '发布', '利好', '开源', '达成', '领先', '成功', '创新', '上涨', '获奖', '上线', '提升', '合作', '首发', '重磅', '亮眼', '回暖', '加速', '跃升', '新突破'];
            const NEG = ['暴跌', '裁员', '风险', '警告', '危机', '下滑', '下跌', '亏损', '暂停', '泄露', '诉讼', '故障', '关闭', '失败', '争议', '批评', '质疑', '推迟', '下架', '处罚', '造假', '崩盘'];
            let pos = 0, neg = 0, neu = 0;
            arts.forEach(a => {
                const txt = (a.title || '') + ' ' + (a.description || '');
                let p = 0, n = 0;
                POS.forEach(k => { if (txt.includes(k)) p++; });
                NEG.forEach(k => { if (txt.includes(k)) n++; });
                if (p > n) pos++; else if (n > p) neg++; else neu++;
            });
            const sentiment = [
                { label: '正面', value: pos, color: '#10b981' },
                { label: '中性', value: neu, color: '#94a3b8' },
                { label: '负面', value: neg, color: '#ef4444' },
            ];
            const sMax = Math.max(pos, neg, neu, 1);
            sentiment.forEach(s => s.pct = Math.round(s.value / sMax * 100));

            // 内容长度分布
            let short = 0, mid = 0, long = 0;
            lens.forEach(l => { if (l < 100) short++; else if (l <= 400) mid++; else long++; });
            const lengthBuckets = [
                { label: '短 · <100字', value: short, color: '#06b6d4' },
                { label: '中 · 100–400字', value: mid, color: '#6366f1' },
                { label: '长 · >400字', value: long, color: '#f59e0b' },
            ];
            const lMax = Math.max(short, mid, long, 1);
            lengthBuckets.forEach(b => b.pct = Math.round(b.value / lMax * 100));

            const fmt = d => d ? `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '—';

            return {
                total,
                sources: new Set(arts.map(a => a.source).filter(Boolean)).size,
                avgLen, spanDays, minT: fmt(minT), maxT: fmt(maxT),
                hotWords, topSources, sentiment, lengthBuckets,
            };
        });

        const displayedTechNews = computed(() => techNews.value.slice(0, techDisplayCount.value));
        const hasMoreTech = computed(() => {
            // 筛选或搜索时隐藏"加载更多"
            if (techSourceFilter.value !== 'all' || techSearchQuery.value.trim()) return false;
            return techDisplayCount.value < techNews.value.length;
        });

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
                    case 'zhihu': data = await API.fetchZhihuHot(); break;
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
                const res = await API.fetchAllTechNews();
                techNews.value = res.articles || [];
                dataUpdateTime.value = res.updateTime || '';
                updateTimestamp();
            } catch(e) {
                techError.value = e.message || '科技资讯加载失败';
                techNews.value = [];
            } finally { techLoading.value = false; }
        }

        function loadMoreTech() { techDisplayCount.value += techPageSize; }

        function refreshCurrentTab() {
            if (activePanel.value !== 'hotboard') return;
            // 手动刷新：重新拉取服务器已抓取的最新数据（不会触发服务器端抓取，数据新鲜度取决于服务器上次整点抓取）
            API.clearOldCache();
            if (hotboardTab.value === 'social') fetchSocialHotlist();
            else fetchTechNews();
        }

        function updateTimestamp() {
            lastUpdate.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        }

        // 数据源 / 主题源 分组展示（主题源为按主题聚合的视图，与真实数据源区分）
        // 注意：techSources 是普通数组（非 ref），直接用 .filter 即可，不要加 .value
        const themeSources = computed(() => techSources.filter(s => s.group === 'theme'));
        const dataSources = computed(() => techSources.filter(s => s.group !== 'theme'));

        const filteredTechNews = computed(() => {
            // 来源筛选和搜索在全部数据中进行，不受"显示前N条"的限制
            let articles = techNews.value;
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
            // 分页在前：只展示前 N 条（用户主动筛选或搜索时取消分页限制）
            if (techSourceFilter.value === 'all' && !techSearchQuery.value.trim()) {
                articles = articles.slice(0, techDisplayCount.value);
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
                if (diff < 0) return '刚刚'; // 来源时间戳在未来时兜底，避免显示负数
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

        // ========== PPT 生成 ==========
        const pptForm = ref({
            title: '',
            subtitle: '',
            content: '',
            pptType: 'product',
            theme: 'tech',
            maxSlides: 10,
            layout: 'list',
            includeCover: true,
            includeToc: true,
            includeEnd: true,
            wordFileName: '',
            pdfFileName: '',
        });

        const pptInputMode = ref('paste');
        const pptGenerating = ref(false);
        const pptReady = ref(false);
        const pptDownloading = ref(false);
        const pptSlideCount = ref(0);

        // ===== 大纲编辑器 =====
        const outlineSlides = ref([]);
        const totalOutlinePoints = computed(() =>
            outlineSlides.value.reduce((sum, s) => sum + (s.points || []).length, 0)
        );

        function generateOutline() {
            const content = pptForm.value.content;
            if (!content || content.trim().length < 5) {
                alert('请先粘贴文案内容');
                return;
            }
            pptReady.value = false;
            PPTGenerator.clearCache();
            // 使用 AI 生成结构化大纲
            const raw = AIGenerator.generatePPTOutline({
                title: pptForm.value.title,
                content: pptForm.value.content,
                type: pptForm.value.pptType,
                style: 'professional',
                wordCount: 800
            });
            outlineSlides.value = raw.map(s => ({
                title: s.title || '',
                points: (s.points || []).map(p => p),
                collapsed: false
            }));
        }

        function updateOutlineTitle(si, val) {
            outlineSlides.value[si].title = val;
        }
        function updateOutlinePoint(si, pi, val) {
            outlineSlides.value[si].points[pi] = val;
        }
        function addOutlineSlide() {
            outlineSlides.value.push({ title: '新章节', points: ['新要点'] });
        }
        function removeOutlineSlide(si) {
            outlineSlides.value.splice(si, 1);
        }
        // 整体编辑章节要点（从textarea按行解析）
        function updateOutlinePoints(si, text) {
            outlineSlides.value[si].points = text.split('\n').filter(l => l.trim());
        }
        function addOutlinePoint(si) {
            outlineSlides.value[si].points.push('');
        }
        function removeOutlinePoint(si, pi) {
            outlineSlides.value[si].points.splice(pi, 1);
        }
        function toggleOutlineCollapse(si) {
            outlineSlides.value[si].collapsed = !outlineSlides.value[si].collapsed;
        }

        const pptOptions = ref({
            types: [
                { value: 'product', label: '产品发布' },
                { value: 'tech', label: '技术方案' },
                { value: 'report', label: '行业报告' },
                { value: 'marketing', label: '营销策划' },
                { value: 'education', label: '培训课件' },
                { value: 'summary', label: '工作总结' },
            ],
            pageCounts: [5, 10, 15, 20, 30],
            layouts: [
                { value: 'list', label: '要点列表' },
                { value: 'grid', label: '网格卡片' },
                { value: 'text', label: '纯文排版' },
            ],
        });

        const pptThemes = {
            tech: { name: '科技蓝', gradient: 'linear-gradient(135deg, #1A73E8, #00BCD4)' },
            dark: { name: '暗夜黑', gradient: 'linear-gradient(135deg, #1E1E2E, #2D2D3F)' },
            light: { name: '简约白', gradient: 'linear-gradient(135deg, #2563EB, #06B6D4)' },
            nature: { name: '清新绿', gradient: 'linear-gradient(135deg, #059669, #34D399)' },
            warm: { name: '暖橙', gradient: 'linear-gradient(135deg, #EA580C, #FB923C)' },
        };

        // 预估页数
        const estimatedSlides = computed(() => {
            const content = pptForm.value.content;
            if (!content || content.length < 20) return 0;
            const headings = (content.match(/^#{1,3}\s/gm) || []).length;
            const lines = content.split('\n').filter(l => l.trim()).length;
            return Math.max(headings || 1, Math.ceil(lines / 5));
        });

        // Word 上传
        async function handleWordUpload(e) {
            const file = e.target.files[0];
            if (!file) return;
            pptForm.value.wordFileName = file.name;
            const text = await file.text();
            // 简单提取文本（docx是zip格式，这里用基础方式）
            pptForm.value.content = extractPlainText(text) || '无法解析 Word 内容，请尝试粘贴文案方式';
        }

        function handleWordDrop(e) {
            const file = e.dataTransfer.files[0];
            if (file && (file.name.endsWith('.docx') || file.name.endsWith('.doc'))) {
                pptForm.value.wordFileName = file.name;
                const reader = new FileReader();
                reader.onload = async (ev) => {
                    const text = ev.target.result;
                    pptForm.value.content = extractPlainText(text) || '无法解析 Word 内容，请尝试粘贴文案方式';
                };
                reader.readAsText(file);
            }
        }

        // PDF 上传
        async function handlePDFUpload(e) {
            const file = e.target.files[0];
            if (!file) return;
            pptForm.value.pdfFileName = file.name;
            // 使用 pdf.js 提取文本（从 CDN 加载）
            await extractPDFText(file);
        }

        function handlePDFDrop(e) {
            const file = e.dataTransfer.files[0];
            if (file && file.name.endsWith('.pdf')) {
                pptForm.value.pdfFileName = file.name;
                extractPDFText(file);
            }
        }

        async function extractPDFText(file) {
            try {
                // 动态加载 pdf.js
                if (!window.pdfjsLib) {
                    await new Promise((resolve, reject) => {
                        const script = document.createElement('script');
                        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
                        script.onload = resolve;
                        script.onerror = reject;
                        document.head.appendChild(script);
                    });
                }
                const arrayBuffer = await file.arrayBuffer();
                const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                let fullText = '';
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const content = await page.getTextContent();
                    const pageText = content.items.map(item => item.str).join(' ');
                    fullText += pageText + '\n';
                }
                pptForm.value.content = fullText.trim();
            } catch (e) {
                pptForm.value.content = 'PDF 解析失败，请尝试粘贴文案方式。错误：' + e.message;
            }
        }

        function extractPlainText(text) {
            // 去除 XML/二进制噪音，保留中文和常见字符
            return text
                .replace(/<[^>]+>/g, '')
                .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s\.\,\!\?\;\:\#\-\*\/\(\)\[\]\{\}，。！？；：""''、…—\n]/g, '')
                .replace(/\n{3,}/g, '\n\n')
                .trim();
        }

        async function generatePPT() {
            if (!pptForm.value.title && !pptForm.value.content) {
                alert('请至少输入标题或内容');
                return;
            }
            if (!outlineSlides.value.length) {
                generateOutline();
                return; // 先生成大纲让用户确认
            }
            pptGenerating.value = true;
            pptReady.value = false;
            pptSlideCount.value = 0;
            PPTGenerator.clearCache();

            try {
                // 如果是刚从大纲生成，直接传 outline；否则走原流程
                const slidesData = outlineSlides.value.map(s => ({
                    title: s.title || '',
                    points: (s.points || []).filter(p => p.trim())
                })).filter(s => s.title || s.points.length);

                const result = await PPTGenerator.generateFromOutline({
                    title: pptForm.value.title || '科技数码演示文稿',
                    subtitle: pptForm.value.subtitle,
                    slides: slidesData,
                    theme: pptForm.value.theme,
                    pptType: pptForm.value.pptType,
                    maxSlides: pptForm.value.maxSlides,
                    layout: pptForm.value.layout,
                    includeCover: pptForm.value.includeCover,
                    includeToc: pptForm.value.includeToc,
                    includeEnd: pptForm.value.includeEnd,
                });
                // 计算总页数
                let count = 0;
                if (pptForm.value.includeCover) count++;
                if (pptForm.value.includeEnd) count++;
                pptSlideCount.value = count + result.pptx.slides.length;
                pptReady.value = true;
            } catch (e) {
                alert('PPT 生成失败：' + (e.message || '未知错误'));
                pptReady.value = false;
            } finally {
                pptGenerating.value = false;
            }
        }

        async function downloadPPT() {
            if (!pptReady.value || pptDownloading.value) return;
            pptDownloading.value = true;
            try {
                await PPTGenerator.downloadCurrent();
            } catch (e) {
                alert('PPT 下载失败：' + (e.message || '未知错误'));
            } finally {
                pptDownloading.value = false;
            }
        }

        onMounted(() => {
            // 打开即加载两个 tab（social 来自外部热搜 API，tech 来自本地预抓取）
            // 仅加载一次：不注册任何自动刷新（用户要求「禁止自动更新，只手动更新」）
            fetchSocialHotlist();
            fetchTechNews();
        });

        // 可见字符计数：排除空格/制表符/换行等纯空白，更接近「字数」直觉
        function visibleCharCount(text) {
            return (text || '').replace(/\s/g, '').length;
        }

        return {
            activePanel, hotboardTab, socialPlatform, socialHotlist, socialLoading, socialError,
            techNews, techLoading, techError, techSourceFilter, techSearchQuery,
            loading, lastUpdate, dataUpdateTime, dataAgeText, dataUpdateAbsolute, techSources, dataSources, themeSources, totalArticles, sourcesCount, totalSourcesCount,
            filteredTechNews, displayedTechNews, hasMoreTech, styleAnalysis,
            switchHotboardTab, switchSocialPlatform, fetchSocialHotlist, fetchTechNews,
            refreshCurrentTab, loadMoreTech, getTagClass, getSourceColor, formatTime, truncate,
            // AI 文案生成
            aiForm, aiOptions, aiGenerating, aiResult, aiResultTitle, aiResultTime, aiResultBlocks,
            aiResultPlain, aiResultPlainBlocks, aiTab, aiTotalChars, aiShowOutput, aiGeneratingStructured, aiGeneratingPlain,
            aiResultSources, aiResultSourcesMeta, aiResultReferences, aiHistory, aiHistoryOpen, hoveredCite, hoveredSource, citationTooltip,
            isUrl, parseSources, isCiteActive, showCiteTooltip, hideCiteTooltip, scrollToSource,
            toggleHistory, restoreHistory, deleteHistory, clearHistory,
            generateArticle, regenerateArticle, copyResult, downloadResult,
            // AI 文案生成 - API 设置（BYOK）
            aiApi, aiApiStatus, saveApiSettings, clearApiSettings, applyApiSettings, visibleCharCount,
            // PPT 生成
            pptForm, pptOptions, pptInputMode, pptThemes, pptGenerating, estimatedSlides,
            pptReady, pptDownloading, pptSlideCount,
            handleWordUpload, handleWordDrop, handlePDFUpload, handlePDFDrop, generatePPT, downloadPPT,
            // PPT 大纲
            outlineSlides, totalOutlinePoints, generateOutline,
            updateOutlineTitle, updateOutlinePoint, updateOutlinePoints,
            addOutlineSlide, removeOutlineSlide, addOutlinePoint, removeOutlinePoint,
            toggleOutlineCollapse,
        };
    }
});
const aiAppVm = app.mount('#app');
window.aiAppVm = aiAppVm;
