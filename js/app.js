/**
 * TechDigest v4 - 主应用
 * 新增 AI 文案生成面板
 */
const { createApp, ref, computed, onMounted, onBeforeUnmount, nextTick } = Vue;

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
        // 加载进度（阶段 + 百分比 + 已下载字节）：驱动进度条与状态文字，避免长加载时毫无反馈
        // percent: 0~100 为确定进度；-1 表示服务端分块压缩传输、总大小未知，走不确定动画
        const techLoadProgress = ref({ stage: 'idle', label: '', percent: 0, indeterminate: false, loaded: 0, total: 0 });
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
            autoRatio: null,   // 仅「新品谍报/速递」预设使用（0.6 → 目标字数≈原文×60%）；其它预设为 null
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
            wordCounts: ['auto', 300, 500, 800, 1000, 1500, 2000],
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

        // ====== 平台 / 文体预设：一键套用对应平台的文体与字数，便于多平台分发 ======
        const platformPresets = [
            { key: 'press', label: '发布会新闻稿', icon: 'fa-newspaper',
              set: { type: 'event', style: 'professional', audience: 'experts', wordCount: 1200,
                extraInstructions: '写成一篇标准发布会新闻稿：含导语、核心发布信息、关键规格参数、上市与价格信息、结语，客观正式、信息准确，不臆造。' } },
            { key: 'scoop', label: '新品谍报/速递', icon: 'fa-bolt',
              set: { type: 'release', style: 'lively', audience: 'tech_fans', wordCount: 'auto', autoRatio: 0.6,
                extraInstructions: '写成一篇新品谍报/速递风格文章：网感强、节奏快、突出最抓眼球的卖点，可略带悬念感，但数据必须来自原文。' } },
            { key: 'weibo', label: '新品谍报微博', icon: 'fa-weibo',
              set: { type: 'news', style: 'social', audience: 'general', wordCount: 300, plain: true, platform: 'weibo', language: 'zh_casual',
                extraInstructions: '写成微博科技爆料/资讯：网感接地气、像数码博主爆料，用「微博透露/博主表示/据网友爆料/评论区有用户问…博主回复…」这类写法，传闻保留「据传/疑似/预计」语气；带 1-2 个 emoji 与话题标签 #索尼电影机#，不要小红书种草腔（禁用姐妹们/种草/谁懂啊），不堆参数表、不使用 ## 小标题。' } },
            { key: 'xhs', label: '小红书笔记', icon: 'fa-book-open',
              set: { type: 'release', style: 'social', audience: 'general', wordCount: 500, plain: true, platform: 'xhs', language: 'zh_casual',
                extraInstructions: '写成小红书图文笔记：吸睛带 emoji 的标题、开篇用姐妹们/宝子们喊话、每段配 emoji、口语化有亲和力、把卖点揉进个人体验、结尾抛互动话题并带 #话题标签#，禁止 ## 小标题和参数表堆砌。' } },
        ];
        function applyPlatformPreset(p) {
            // 先重置社媒专属字段，否则非社媒预设会继承前一次点过的 platform/plain/zh_casual
            aiForm.value.platform = null;
            aiForm.value.plain = false;
            aiForm.value.language = 'zh_professional';
            Object.assign(aiForm.value, JSON.parse(JSON.stringify(p.set)));
            // autoRatio 仅「新品谍报/速递」预设使用（0.6），其它预设不携带该字段时必须清掉，
            // 否则会污染后续预设的「自动」字数逻辑（残留 0.6 会让发布会新闻稿也变短）。
            if (!('autoRatio' in p.set)) delete aiForm.value.autoRatio;
        }

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
        const aiResultFactChecked = ref(false); // 服务端事实护栏是否触发（原文存在且经过校验/纠正）
        const aiResultImages = ref([]);   // 本次生成从原文抽到的配图 URL（原始地址），注入正文时会再走代理
        const aiImageCaptionOn = ref(false);   // 配图是否显示名称/说明（默认关：图片不显示标题）
        const aiHistory = ref([]);        // 历史记录
        const aiHistoryOpen = ref(false); // 历史面板是否展开
        const contentFileInput = ref(null); // 原文上传的隐藏 file input
        const contentParsing = ref(false);  // 正在解析 Word/PDF
        const contentDragover = ref(false); // 拖拽悬停态
        const hoveredCite = ref(null);    // 当前鼠标悬停的内联引用编号
        const hoveredSource = ref(null);  // 当前悬停的来源列表项编号
        const citationTooltip = ref({ visible: false, cite: null, source: '', top: 0, left: 0 }); // 引用上标 tooltip

        // ====== API 设置（BYOK：用户自带 key，仅存本机 localStorage） ======
        const aiApi = ref({
            show: false,
            key: '',
            basePreset: 'vectorengine', // vectorengine(站点默认=官方DeepSeek) | deepseek | custom
            customBase: '',
            model: 'deepseek-v4-flash',
            showKey: false,
        });

        // ===== AI 生成插图（BYOK 图像模型） =====
        const aiImageText = ref('');
        const aiImageStyle = ref('xhs_fresh');
        const aiImageRatio = ref('3:4');
        const aiImageMood = ref('natural');
        const aiImageSeed = ref('');
        const aiImageResults = ref([]); // 每张图占一个槽位：null=等待中, string=图片, {error}=失败
        const aiImageGenerating = ref(false);
        const aiImageError = ref('');
        const aiImageProgress = ref({ done: 0, total: 4 });
        const aiImageParsing = ref(false);
        const aiImageFileInput = ref(null);

        const aiImageStyles = [
            { key: 'xhs_fresh', label: '小红书清新', icon: 'fa-solid fa-heart' },
            { key: 'jap_film', label: '日系胶片', icon: 'fa-solid fa-camera-retro' },
            { key: 'flat_minimal', label: '极简扁平', icon: 'fa-solid fa-shapes' },
            { key: '3d_cartoon', label: '3D卡通', icon: 'fa-solid fa-cube' },
            { key: 'guochao', label: '国潮', icon: 'fa-solid fa-dragon' },
            { key: 'realistic_ecom', label: '写实电商', icon: 'fa-solid fa-box-open' },
            { key: 'watercolor', label: '水彩手绘', icon: 'fa-solid fa-paintbrush' },
            { key: 'cyber_neon', label: '赛博霓虹', icon: 'fa-solid fa-bolt' },
        ];
        const aiImageRatios = [
            { value: '1:1', label: '1:1 方图' },
            { value: '3:4', label: '3:4 竖图' },
            { value: '9:16', label: '9:16 竖屏' },
            { value: '4:3', label: '4:3 横图' },
            { value: '16:9', label: '16:9 横图' },
        ];
        const aiImageMoods = [
            { value: 'natural', label: '自然光' },
            { value: 'studio', label: '棚拍柔光' },
            { value: 'night', label: '霓虹夜景' },
            { value: 'warm', label: '暖阳治愈' },
        ];

        const LS_IMG_KEY = 'td_img_api_v1';
        const aiImgApi = ref({ show: false, key: '', base: 'https://dashscope.aliyuncs.com', model: 'wanx2.1-t2i-turbo', showKey: false });
        function loadImgApiSettings() {
            try {
                const raw = localStorage.getItem(LS_IMG_KEY);
                if (raw) {
                    const o = JSON.parse(raw);
                    if (o.key) aiImgApi.value.key = o.key;
                    if (o.base) aiImgApi.value.base = o.base;
                    if (o.model) aiImgApi.value.model = o.model;
                }
            } catch (_) {}
        }
        function saveImgApiSettings() {
            const payload = {
                key: (aiImgApi.value.key || '').trim(),
                base: (aiImgApi.value.base || '').trim() || 'https://dashscope.aliyuncs.com',
                model: (aiImgApi.value.model || '').trim() || 'wanx2.1-t2i-turbo',
            };
            try { localStorage.setItem(LS_IMG_KEY, JSON.stringify(payload)); } catch (_) {}
            alert('已保存图像 API 设置（仅本机浏览器）。生成时将使用你配置的 Key。');
        }
        function clearImgApiSettings() {
            aiImgApi.value.key = '';
            aiImgApi.value.base = 'https://dashscope.aliyuncs.com';
            aiImgApi.value.model = 'wanx2.1-t2i-turbo';
            try { localStorage.removeItem(LS_IMG_KEY); } catch (_) {}
        }
        function importFromAiContent() {
            const src = (aiForm.value.content || '').trim();
            if (!src) { alert('「AI文案生成」的参考原文框为空，无法导入。请先在 AI 文案生成中填写参考原文内容。'); return; }
            aiImageText.value = src;
            activePanel.value = 'ai-image';
            aiImageError.value = '';
            alert('已从「AI文案生成 · 参考原文」导入内容到画面描述。可补充细节后点击「生成 4 张插图」。');
        }
        async function generateImages() {
            const text = (aiImageText.value || '').trim();
            if (!text) { aiImageError.value = '请先输入画面描述，或点「从AI文案导入参考原文」。'; return; }
            const key = (aiImgApi.value.key || '').trim();
            // 若前端未填 Key，则由服务端预设的 IMAGE_KEY 兜底（通义万相站点默认）
            aiImageGenerating.value = true;
            aiImageError.value = '';
            aiImageProgress.value = { done: 0, total: 4 };
            // 预置 4 个等待槽位，逐张填充，形成可见进度
            aiImageResults.value = [null, null, null, null];
            try {
                const resp = await fetch('/api/ai-image', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text,
                        style: aiImageStyle.value,
                        ratio: aiImageRatio.value,
                        mood: aiImageMood.value,
                        seed: aiImageSeed.value || '',
                        apiKey: key,
                        base: (aiImgApi.value.base || '').trim(),
                        model: (aiImgApi.value.model || '').trim(),
                    }),
                });
                if (!resp.ok) {
                    const data = await resp.json().catch(() => ({}));
                    aiImageError.value = data.error || ('生成失败（' + resp.status + '）');
                    aiImageResults.value = [];
                    aiImageGenerating.value = false;
                    return;
                }
                // 解析 SSE 流：每张图完成即推送，前端实时填充 + 进度条
                const reader = resp.body.getReader();
                const decoder = new TextDecoder();
                let buf = '';
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buf += decoder.decode(value, { stream: true });
                    let idx;
                    while ((idx = buf.indexOf('\n\n')) !== -1) {
                        const chunk = buf.slice(0, idx);
                        buf = buf.slice(idx + 2);
                        const line = chunk.split('\n').find((l) => l.startsWith('data:'));
                        if (!line) continue;
                        let payload;
                        try { payload = JSON.parse(line.slice(5).trim()); } catch (_) { continue; }
                        if (payload.type === 'image') {
                            const arr = aiImageResults.value.slice();
                            arr[payload.index] = payload.ok ? payload.image : { error: payload.error };
                            aiImageResults.value = arr;
                            aiImageProgress.value = { done: payload.done, total: payload.total };
                        } else if (payload.type === 'done') {
                            if (payload.allFailed) {
                                aiImageError.value = '图像生成全部失败：' + (payload.firstError || '未知错误');
                                aiImageResults.value = [];
                            } else if (payload.firstError) {
                                aiImageError.value = '部分失败：' + payload.firstError;
                            }
                        }
                    }
                }
            } catch (e) {
                aiImageError.value = '网络错误：' + (e.message || e);
            } finally {
                aiImageGenerating.value = false;
            }
        }
        function triggerImageFileInput() {
            if (aiImageFileInput.value) aiImageFileInput.value.click();
        }
        async function handleImageFileUpload(e) {
            const file = e.target.files && e.target.files[0];
            if (aiImageFileInput.value) aiImageFileInput.value.value = ''; // 允许重复选同一文件
            if (!file) return;
            const name = file.name.toLowerCase();
            aiImageParsing.value = true;
            try {
                let text = '';
                if (name.endsWith('.txt')) {
                    text = await file.text();
                } else if (name.endsWith('.docx')) {
                    text = await extractDocxText(file);
                } else if (name.endsWith('.pdf')) {
                    text = await extractPdfText(file);
                } else {
                    throw new Error('仅支持 Word（.docx）、PDF（.pdf）、纯文本（.txt）');
                }
                text = (text || '').replace(/\r\n/g, '\n').trim();
                if (!text) throw new Error('未能从该文件提取到文本，可能为空文件或扫描件（图片型 PDF 无法识别）');
                const existing = (aiImageText.value || '').trim();
                aiImageText.value = existing ? existing + '\n\n' + text : text;
                aiImageError.value = '';
            } catch (err) {
                alert('解析失败：' + (err && err.message ? err.message : err));
            } finally {
                aiImageParsing.value = false;
            }
        }
        const aiImageHasResults = computed(() => aiImageResults.value.some((x) => x));
        const aiImgApiStatus = computed(() => {
            const k = (aiImgApi.value.key || '').trim();
            if (k) {
                const masked = k.length > 10 ? (k.slice(0, 6) + '…' + k.slice(-4)) : k;
                return { cls: 'ok', icon: 'fa-solid fa-circle-check', text: '正在使用你自己的图像 Key：' + masked };
            }
            const baseIsDs = (aiImgApi.value.base || '').includes('dashscope');
            const isWanx = (aiImgApi.value.model || '').includes('wanx');
            if (baseIsDs && isWanx) {
                return { cls: 'ok', icon: 'fa-solid fa-circle-check', text: '站点已预置通义万相（wanx2.1），可直接生成；也可填自己的 Key 覆盖' };
            }
            return { cls: 'warn', icon: 'fa-solid fa-circle-info', text: '未填 Key：请在下方填入图像模型 Key 后保存' };
        });
        loadImgApiSettings();

        const LS_KEY = 'td_ai_api_v1';

        function basePresetToUrl(preset, custom) {
            if (preset === 'deepseek') return 'https://api.deepseek.com/v1';
            if (preset === 'custom') return (custom || '').trim();
            return ''; // vectorengine → 留空，由代理函数用默认地址
        }

        // 各服务商对应的默认模型名（官方 DeepSeek 最新 API 仅支持 deepseek-v4-pro / deepseek-v4-flash）
        const PRESET_DEFAULT_MODEL = { vectorengine: 'deepseek-v4-flash', deepseek: 'deepseek-v4-flash', custom: '' };

        function onPresetChange() {
            // 切换服务商时，把模型名重置为该服务商的默认（用户仍可手动改）
            aiApi.value.model = PRESET_DEFAULT_MODEL[aiApi.value.basePreset] || '';
            applyApiSettings();
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
                    if (o.model) {
                        // 官方最新 API 已弃用 deepseek-chat / deepseek-v3，自动升级到 v4 系列
                        const DEPRECATED = ['deepseek-chat', 'deepseek-v3', 'deepseek-coder'];
                        aiApi.value.model = DEPRECATED.includes(o.model) ? 'deepseek-v4-flash' : o.model;
                    }
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
                model: (a.model || '').trim() || 'deepseek-v4-flash',
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
            return { cls: 'warn', icon: 'fa-solid fa-circle-info', text: '未填 key：将使用站点默认 API（官方 DeepSeek）' };
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
                // 图片行：![alt](url) —— 由原文抽图注入正文后渲染为配图
                if (/^!\[[^\]]*\]\([^)]*\)$/.test(line.trim())) {
                    const m = line.trim().match(/^!\[([^\]]*)\]\(([^)]*)\)$/);
                    blocks.push({ type: 'image', alt: m ? m[1] : '', url: m ? m[2] : '' });
                    return;
                }
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

        // 将原文抽到的图片地址改写为「经本站代理」的 URL，绕过防盗链，使配图稳定显示
        function proxiedImageUrl(u) {
            try { return '/api/img-proxy?u=' + encodeURIComponent(u); } catch (_) { return u; }
        }

        // 把配图注入文章正文：第一张作封面，其余按段落比例均匀分布，避免扎堆。
        // 配图名称优先取所在章节标题，不再用“配图1/2/3”。
        function injectImagesIntoContent(content, images) {
            if (!content) return content;
            const imgs = (images || []).map(proxiedImageUrl).filter(Boolean);
            if (!imgs.length) return content;
            const lines = content.split('\n');

            // 识别可插入位置：非空段落行（非标题、非列表项）
            const paraLines = [];
            const headingLines = [];
            lines.forEach((line, idx) => {
                const isHeading = /^#{1,3}\s/.test(line);
                const isList = /^[-*!]\s/.test(line) || /^\d+[\.、]\s/.test(line);
                const isEmpty = line.trim().length === 0;
                if (isHeading) headingLines.push({ idx, title: line.replace(/^#+\s*/, '').trim() });
                else if (!isEmpty && !isList) paraLines.push(idx);
            });
            if (!paraLines.length) return content;

            // 计算每张图的插入行（按比例分布，封面插在首段后）
            const insertMap = new Map(); // lineIdx -> [image indices]
            const placeImg = (imgIdx, targetParaIndex) => {
                const paraIdx = Math.max(0, Math.min(paraLines.length - 1, targetParaIndex));
                let lineIdx = paraLines[paraIdx];
                // 如果目标段前紧邻标题，则把图放在标题后，显得更贴合章节
                const prevHeading = headingLines.filter(h => h.idx < lineIdx).pop();
                if (prevHeading && lineIdx - prevHeading.idx <= 2) lineIdx = prevHeading.idx;
                if (!insertMap.has(lineIdx)) insertMap.set(lineIdx, []);
                insertMap.get(lineIdx).push(imgIdx);
            };
            placeImg(0, 0); // 封面
            const restImgs = imgs.length - 1;
            const restParas = Math.max(1, paraLines.length - 1);
            for (let i = 1; i < imgs.length; i++) {
                const ratio = restImgs === 1 ? 1 : (i - 1) / (restImgs - 1);
                const paraIndex = Math.round(ratio * restParas);
                placeImg(i, paraIndex);
            }

            const makeCaption = (imgIdx, currentHeading) => {
                if (imgIdx === 0) {
                    const firstTitle = lines.find(l => /^#+\s+/.test(l));
                    if (firstTitle) return firstTitle.replace(/^#+\s*/, '').trim().slice(0, 36) + ' - 封面';
                    return '封面';
                }
                if (currentHeading) return currentHeading.slice(0, 36) + ' - 图' + (imgIdx + 1);
                return '图' + (imgIdx + 1);
            };

            const out = [];
            let currentHeading = '';
            for (let idx = 0; idx < lines.length; idx++) {
                const line = lines[idx];
                out.push(line);
                if (/^#{1,3}\s+/.test(line)) currentHeading = line.replace(/^#+\s*/, '').trim();
                if (insertMap.has(idx)) {
                    for (const imgIdx of insertMap.get(idx)) {
                        out.push('![' + makeCaption(imgIdx, currentHeading) + '](' + imgs[imgIdx] + ')');
                    }
                }
            }
            return out.join('\n');
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

        // 与 WPS/Word「字数」口径保持一致：
        // - 每个 CJK 字符算 1
        // - 每个连续英文/数字串算 1 个词
        // - 每个 CJK 全角标点（，。、；：？！「」『』【】《》（）等）算 1
        // 基于已渲染块计算，不计 Markdown 标记、不计隐藏的图片 URL。
        function wordCountLikeWord(text) {
            if (!text) return 0;
            const re = /[\u4e00-\u9fa5\u3040-\u309f\u30a0-\u30ff\u3400-\u4dbf]|[a-zA-Z0-9_]+|[\u3000-\u303f\uff01-\uff60\uffe0-\uffee\ufe10-\ufe1f\ufe30-\ufe4f]/g;
            let c = 0, m;
            while ((m = re.exec(text))) c++;
            return c;
        }
        const aiTotalChars = computed(() => {
            const blocks = aiTab.value === 'plain' ? aiResultPlainBlocks.value : aiResultBlocks.value;
            let count = wordCountLikeWord(aiResultTitle.value);
            for (const b of (blocks || [])) {
                if (b.type === 'image') {
                    if (aiImageCaptionOn.value && b.alt) count += wordCountLikeWord(b.alt);
                    continue;
                }
                for (const seg of (b.segments || [])) {
                    count += wordCountLikeWord(seg.text);
                    if (seg.cites && seg.cites.length) count += seg.cites.length;
                }
            }
            return count;
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
            aiForm.value.autoRatio = item.autoRatio || null;
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
            aiResultImages.value = (item.images && Array.isArray(item.images)) ? item.images : [];
            aiResultReferences.value = (item.references && Array.isArray(item.references) && item.references.length)
                ? item.references
                : aiResultSources.value.map(u => ({ title: u, url: u, ok: true, note: '' }));
            aiTab.value = 'structured';
            const outputEl = document.querySelector('.ai-output-section');
            if (outputEl) outputEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        function toggleHistory() { aiHistoryOpen.value = !aiHistoryOpen.value; }
        function closeHistory() { aiHistoryOpen.value = false; }

        // ====== 原文 Word / PDF 上传：前端提取文本填入「参考原文内容」 ======
        function triggerContentFile() { if (contentFileInput.value) contentFileInput.value.click(); }

        function onContentFile(e) {
            const file = e.target.files && e.target.files[0];
            if (file) handleContentFile(file);
            e.target.value = '';
        }
        function onContentDrop(e) {
            contentDragover.value = false;
            const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            if (file) handleContentFile(file);
        }
        async function handleContentFile(file) {
            contentParsing.value = true;
            try {
                const name = (file.name || '').toLowerCase();
                let text = '';
                if (name.endsWith('.pdf')) text = await extractPdfText(file);
                else if (name.endsWith('.docx')) text = await extractDocxText(file);
                else throw new Error('仅支持 Word（.docx）与 PDF（.pdf）文件，旧版 .doc 暂不支持');
                text = (text || '').replace(/\r\n/g, '\n').trim();
                if (!text) throw new Error('未能从该文件提取到文本，可能为空文件或扫描件（图片型 PDF 无法识别）');
                const existing = (aiForm.value.content || '').trim();
                aiForm.value.content = existing ? existing + '\n\n' + text : text;
            } catch (err) {
                alert('解析失败：' + (err && err.message ? err.message : err));
            } finally {
                contentParsing.value = false;
            }
        }
        function extractDocxText(file) {
            return new Promise((resolve, reject) => {
                if (typeof mammoth === 'undefined') { reject(new Error('文档解析库未加载，请刷新页面后重试')); return; }
                const reader = new FileReader();
                reader.onload = async () => {
                    try {
                        const res = await mammoth.extractRawText({ arrayBuffer: reader.result });
                        resolve(res.value || '');
                    } catch (e) { reject(e); }
                };
                reader.onerror = () => reject(new Error('读取文件失败'));
                reader.readAsArrayBuffer(file);
            });
        }
        async function extractPdfText(file) {
            if (typeof pdfjsLib === 'undefined') throw new Error('PDF 解析库未加载，请刷新页面后重试');
            const buf = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
            let text = '';
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const content = await page.getTextContent();
                text += content.items.map(it => it.str).join(' ') + '\n';
            }
            return text;
        }

        // 预抓取「原文链接」中的正文与配图，填入参考原文框，确保无论云端/本地生成都基于真实内容
        async function prefetchSourceUrls() {
            const urls = parseSources(aiForm.value.sources);
            if (!urls.length) return;
            try {
                const resp = await fetch('/api/fetch-source', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ urls }),
                    signal: AbortSignal.timeout(20000),
                });
                if (!resp.ok) return;
                const data = await resp.json();
                const texts = [];
                const imgs = [];
                for (const r of (data.results || [])) {
                    if (!r.ok) continue;
                    if (r.title) texts.push(r.title);
                    if (r.text) texts.push(r.text);
                    (r.images || []).forEach(u => { if (!imgs.includes(u)) imgs.push(u); });
                }
                // 把抓取到的正文填入「参考原文内容」框（若已有内容则追加）
                const existing = (aiForm.value.content || '').trim();
                const fetchedText = texts.join('\n\n').trim();
                if (fetchedText) {
                    aiForm.value.content = existing ? existing + '\n\n' + fetchedText : fetchedText;
                }
                // 保存抽到的图（后续统一注入正文）
                if (imgs.length) aiResultImages.value = imgs.slice(0, 12);
            } catch (e) {
                console.warn('[prefetchSourceUrls] 抓取失败:', e.message);
            }
        }

        // AI 生成文章（结构式优先流式打字展示，非结构式随后流式填充）
        async function generateArticle() {
            updateAILabels();
            aiGenerating.value = true;
            aiShowOutput.value = true;
            aiResult.value = '';
            aiResultPlain.value = '';
            aiResultTitle.value = '';
            aiResultImages.value = [];
            aiTab.value = 'structured';
            // 立即展示来源框：只要用户填了来源 URL 或开启联网搜索，框就出现，避免后续某次生成失败时整框丢失
            aiResultSources.value = parseSources(aiForm.value.sources);
            aiResultReferences.value = aiResultSources.value.map(u => ({ title: u, url: u, ok: true, note: '' }));

            // 先把原文链接里的正文/图片预抓出来，再生成（云端失败走本地模板时也有料可写）
            await prefetchSourceUrls();

            try {
                // 结构式：逐字流式展示（默认可见 tab）
                aiGeneratingStructured.value = true;
                const onToken = (partial) => {
                    if (partial && partial.title) aiResultTitle.value = partial.title;
                    if (partial && partial.content !== undefined) aiResult.value = partial.content;
                };
                const result = await AIGenerator.generate(aiForm.value, onToken);
                // 优先用云端回传的图；若云端失败，使用预抓取到的图
                if (result.images && result.images.length) aiResultImages.value = result.images;
                aiResult.value = injectImagesIntoContent(result.content, aiResultImages.value);
                aiResultTitle.value = result.title;
                aiResultFactChecked.value = !!result.factChecked;
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
                // 保险：若模型仍生成 [1]/[?] 引用编号，在非结构式中强制移除
                const plainTextNoCite = (plainResult.content || '').replace(/\[(\d+|\?)\]/g, '');
                aiResultPlain.value = injectImagesIntoContent(plainTextNoCite, aiResultImages.value);
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
                    autoRatio: aiForm.value.autoRatio,
                    inputTitle: aiForm.value.title,
                    inputContent: aiForm.value.content,
                    inputSources: aiForm.value.sources,
                    references: aiResultReferences.value,
                    sourcesMeta: aiResultSourcesMeta.value,
                    images: aiResultImages.value,
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

        // —— 导出为 Word（.doc，图片内嵌 base64，离线可见）——
        function escapeHtml(s) {
            return String(s == null ? '' : s)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }
        function blobToDataURL(blob) {
            return new Promise((resolve, reject) => {
                const fr = new FileReader();
                fr.onload = () => resolve(fr.result);
                fr.onerror = reject;
                fr.readAsDataURL(blob);
            });
        }
        // 把经本站代理的配图 URL 还原为原始绝对地址（base64 抓取失败时，让 Word 尝试联网加载）
        function originalFromProxied(url) {
            try {
                const m = String(url).match(/[?&]u=([^&]+)/);
                if (m) return decodeURIComponent(m[1]);
            } catch (_) {}
            return url;
        }
        // 把结构化块渲染为 Word 可识别的 HTML 片段（标题/列表/引用/配图）
        function renderBlocksToWordHtml(blocks, b64map, title) {
            const showCap = aiImageCaptionOn.value;
            const renderSegments = (segs) => {
                let h = '';
                for (const s of (segs || [])) {
                    h += escapeHtml(s.text || '');
                    if (s.cites && s.cites.length) h += '<sup>[' + s.cites.join(',') + ']</sup>';
                }
                return h;
            };
            let body = '';
            let inList = false;
            const closeList = () => { if (inList) { body += '</ul>'; inList = false; } };
            for (const b of blocks) {
                if (b.type === 'image') {
                    closeList();
                    const src = (b64map && b64map[b.url]) || originalFromProxied(b.url);
                    body += '<p style="text-align:center"><img src="' + escapeHtml(src) + '" style="max-width:100%;max-height:460px;border-radius:8px"></p>';
                    if (showCap && b.alt) body += '<p style="text-align:center;font-size:9pt;color:#888">' + escapeHtml(b.alt) + '</p>';
                } else if (b.type === 'h2') {
                    closeList();
                    body += '<h2>' + renderSegments(b.segments) + '</h2>';
                } else if (b.type === 'h3') {
                    closeList();
                    body += '<h3>' + renderSegments(b.segments) + '</h3>';
                } else if (b.type === 'li') {
                    if (!inList) { body += '<ul>'; inList = true; }
                    body += '<li>' + renderSegments(b.segments) + '</li>';
                } else {
                    closeList();
                    body += '<p>' + renderSegments(b.segments) + '</p>';
                }
            }
            closeList();
            return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">' +
                '<head>' +
                '<meta charset="utf-8"><title>' + escapeHtml(title) + '</title>' +
                '<xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml>' +
                '<style>' +
                '@page { size: 210mm 297mm; margin: 2cm; } ' +
                'body { font-family: "Microsoft YaHei", "SimHei", "PingFang SC", sans-serif; font-size: 12pt; line-height: 1.75; color: #222; } ' +
                'h1 { font-size: 20pt; text-align: center; margin-bottom: 24pt; } ' +
                'h2 { font-size: 15pt; margin-top: 20pt; margin-bottom: 10pt; } ' +
                'h3 { font-size: 13pt; margin-top: 14pt; margin-bottom: 8pt; } ' +
                'p { margin: 8pt 0; text-align: justify; } ' +
                'ul { margin: 8pt 0; padding-left: 24pt; } ' +
                'li { margin: 4pt 0; } ' +
                'img { display: block; margin: 12pt auto; max-width: 100%; }' +
                '</style>' +
                '</head>' +
                '<body><h1>' + escapeHtml(title) + '</h1>' + body + '</body></html>';
        }

        async function downloadResult() {
            const title = aiResultTitle.value || 'AI生成文章';
            const blocks = aiTab.value === 'plain' ? aiResultPlainBlocks.value : aiResultBlocks.value;
            // 先把所有配图抓为 base64 内嵌（失败则保留在线 URL，Word 会尝试联网加载）
            const imgBlocks = (blocks || []).filter(b => b.type === 'image');
            const b64map = {};
            await Promise.all(imgBlocks.map(async (b) => {
                try {
                    const r = await fetch(b.url);
                    if (r.ok) { const blob = await r.blob(); b64map[b.url] = await blobToDataURL(blob); }
                } catch (_) {}
            }));
            const html = renderBlocksToWordHtml(blocks, b64map, title);
            // 带 BOM 的 UTF-8，确保中文不乱码；保存为 .doc，Word/WPS 可直接打开
            const blob = new Blob(['﻿' + html], { type: 'application/msword;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = title + '.doc';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
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
            // 初始进度（覆盖上一次残留），让进度条从 0 起步
            techLoadProgress.value = { stage: 'start', label: '准备加载科技资讯…', percent: 0, indeterminate: false, loaded: 0, total: 0 };
            // 看门狗：最后兜底。即使底层 fetch 因任何原因未能在预算内结束，
            // 也保证超时后强制清除转圈（底层已并行+超时，正常情况下远早于此时限）。
            // 必须晚于 api.js 中最长的单项预算（BASE_MS=60s），否则会在归档还在传输时
            // 提前把转圈关掉，让用户误以为"只有实时那几百条"。故设为 70s。
            const watchdog = setTimeout(() => { techLoading.value = false; }, 70000);
            try {
                const res = await API.fetchAllTechNews((p) => { techLoadProgress.value = p; });
                techNews.value = res.articles || [];
                dataUpdateTime.value = res.updateTime || '';
                updateTimestamp();
            } catch(e) {
                techError.value = e.message || '科技资讯加载失败';
                techNews.value = [];
            } finally {
                clearTimeout(watchdog);
                techLoading.value = false;
            }
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
        // 字节 → 友好体积（用于进度条「已下载 X MB」展示）
        function formatMB(bytes) {
            const b = Number(bytes) || 0;
            if (b >= 1048576) return (b / 1048576).toFixed(2) + ' MB';
            if (b >= 1024) return (b / 1024).toFixed(0) + ' KB';
            return b + ' B';
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
                        script.src = 'vendor/pdf.min.js';
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
            // 按 Esc 也可关闭生成历史面板
            window.addEventListener('keydown', onKeydown);
            // PDF.js worker 指向同源 CDN，避免跨域加载失败
            if (typeof pdfjsLib !== 'undefined') {
                pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
            }
        });
        onBeforeUnmount(() => {
            window.removeEventListener('keydown', onKeydown);
        });
        function onKeydown(e) { if (e.key === 'Escape') aiHistoryOpen.value = false; }

        // 可见字符计数：排除空格/制表符/换行等纯空白，更接近「字数」直觉
        function visibleCharCount(text) {
            return (text || '').replace(/\s/g, '').length;
        }

        return {
            activePanel, hotboardTab, socialPlatform, socialHotlist, socialLoading, socialError,
            techNews, techLoading, techError, techLoadProgress, techSourceFilter, techSearchQuery,
            loading, lastUpdate, dataUpdateTime, dataAgeText, dataUpdateAbsolute, techSources, dataSources, themeSources, totalArticles, sourcesCount, totalSourcesCount,
            filteredTechNews, displayedTechNews, hasMoreTech, styleAnalysis,
            switchHotboardTab, switchSocialPlatform, fetchSocialHotlist, fetchTechNews,
            refreshCurrentTab, loadMoreTech, getTagClass, getSourceColor, formatTime, formatMB, truncate,
            // AI 文案生成
            aiForm, aiOptions, platformPresets, applyPlatformPreset, aiGenerating, aiResult, aiResultTitle, aiResultTime, aiResultBlocks,
            aiResultPlain, aiResultPlainBlocks, aiTab, aiTotalChars, aiShowOutput, aiGeneratingStructured, aiGeneratingPlain,
            aiResultSources, aiResultSourcesMeta, aiResultReferences, aiResultFactChecked, aiResultImages, aiImageCaptionOn, aiHistory, aiHistoryOpen, hoveredCite, hoveredSource, citationTooltip,
            contentFileInput, contentParsing, contentDragover,
            isUrl, parseSources, isCiteActive, showCiteTooltip, hideCiteTooltip, scrollToSource,
            toggleHistory, closeHistory, restoreHistory, deleteHistory, clearHistory,
            triggerContentFile, onContentFile, onContentDrop,
            generateArticle, regenerateArticle, copyResult, downloadResult,
            // AI 文案生成 - API 设置（BYOK）
            aiApi, aiApiStatus, saveApiSettings, clearApiSettings, applyApiSettings, visibleCharCount, wordCountLikeWord,
            // AI 生成插图
            aiImageText, aiImageStyle, aiImageRatio, aiImageMood, aiImageSeed,
            aiImageResults, aiImageGenerating, aiImageError, aiImageProgress, aiImageParsing, aiImageFileInput, aiImageHasResults,
            aiImageStyles, aiImageRatios, aiImageMoods,
            aiImgApi, aiImgApiStatus, saveImgApiSettings, clearImgApiSettings, importFromAiContent, generateImages, triggerImageFileInput, handleImageFileUpload,
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
