/**
 * Cloudflare Pages Function �? AI 文案生成代理
 * 前端调用同源 /api/ai-generate，本函数持有 API key（仅存在�? Cloudflare 密文�?
 * 浏览�?/前端代码永远拿不到），转发到 VectorEngine（DeepSeek 代理）并返回结果�?
 * 这样 key 不落地、不进前端、不�? git 仓库，同时规避浏览器直连第三�? API �? CORS 限制�?
 */

// 允许的请求来源：留空表示同源即可（Cloudflare Pages 站点本身）�?
// 如需跨域（例�? GitHub Pages 站点也想调用本函数），可在此填入允许�? origin�?
const ALLOWED_ORIGINS = [];

function corsHeaders(origin) {
    const headers = { 'Content-Type': 'application/json; charset=utf-8' };
    if (origin && (ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin))) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
        headers['Access-Control-Allow-Headers'] = 'Content-Type';
    }
    return headers;
}

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function cleanArticleText(text) {
    if (!text) return text;
    // 去掉原文自带的脚注标�? [1] [2]…，避免模型误当成引用编号输�?
    text = text.replace(/\s*\[\d+\]\s*/g, ' ');
    // 去掉长篇星号/横线分隔符之后的页脚/声明
    text = text.replace(/\s*[*＊](?:\s*[*＊]){19,}[\s\S]*$/, '');
    text = text.replace(/\s*[-—](?:\s*[-—]){19,}[\s\S]*$/, '');
    // 去掉常见页脚/版权/备案/联系信息及其后的所有内�?
    const footerMarkers = ['版权所�?', 'ICP�?', '京公网安�?', '隐私政策', '责任声明', '联系我们', '关于索尼集团公司', '若有合作意向，请填写�?', '相关联系方式�?', '索尼集团公司是一�?'];
    const re = new RegExp('\\s(' + footerMarkers.map(escapeRegExp).join('|') + ')\\s');
    const m = text.match(re);
    if (m) text = text.slice(0, m.index + 1).trim();
    return text.replace(/\s+/g, ' ').trim();
}

// �? HTML 中提取正文：移除脚本/样式/导航/页脚等噪声，优先�? <main>/<article>/<body>
function extractTextFromHtml(html) {
    let cleaned = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
        .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
        .replace(/<header[\s\S]*?<\/header>/gi, ' ')
        .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ');

    const mainMatch = cleaned.match(/<main[\s\S]*?<\/main>/i);
    const articleMatch = cleaned.match(/<article[\s\S]*?<\/article>/i);
    const bodyMatch = cleaned.match(/<body[\s\S]*?<\/body>/i);
    const content = mainMatch ? mainMatch[0] : (articleMatch ? articleMatch[0] : (bodyMatch ? bodyMatch[0] : cleaned));

    const text = content
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
    return cleanArticleText(text);
}

// 提取页面标题（og:title / twitter:title / <title>），用于参考文献与配图说明
function extractTitleFromHtml(html) {
    let m = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    if (m && m[1].trim()) return m[1].trim();
    m = html.match(/<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i)
        || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:title["']/i);
    if (m && m[1].trim()) return m[1].trim();
    m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (m && m[1].trim()) return m[1].replace(/\s+/g, ' ').trim().slice(0, 120);
    return '';
}

// �? HTML 抽取配图链接：优�? og:image / twitter:image，再取正文区�? <img src>�?
// 绝对化相�? URL、去重、过滤图�?/logo/视频封面/非图片，最多返�? max 张�?
function extractImagesFromHtml(html, pageUrl, max = 30) {
    const found = [];
    const seen = new Set();

    const push = (raw, ctx = '') => {
        if (!raw) return;
        let u = String(raw).trim();
        if (!u || u.startsWith('data:') || u.startsWith('blob:')) return;
        try {
            u = new URL(u, pageUrl).href;
        } catch (_) { return; }
        if (!/^https?:\/\//i.test(u)) return;
        const lc = u.toLowerCase();
        const ctxLc = ctx.toLowerCase();
        // 过滤明显的小图标 / logo / 像素追踪 / 视频相关
        if (/\/favicon|\/icon[s]?[\/\._]|logo|tracking|pixel|spacer|blank\.gif|1x1/i.test(lc)) return;
        if (/video|play|poster|plyr|embed|youtube|bilibili|vimeo|youku|\.gif(\?|$)/i.test(lc)) return;
        if (/\b(play|video|poster|plyr|player|embed)\b/.test(ctxLc)) return;
        const hasExt = /\.(jpg|jpeg|png|webp|avif|bmp)(\?|$)/i.test(lc);
        const looksImage = hasExt || /image|img|photo|pic|cover|banner|thumbnail/i.test(lc) || /\/(img|images|photo|photos|media|upload|pics|picture)\//i.test(lc);
        if (!looksImage) return;
        if (seen.has(u)) return;
        seen.add(u);
        found.push(u);
    };

    // 1) og:image / twitter:image（最可能是主图）
    const metaRe = /<meta[^>]+(?:property|name)=["'](og:image|og:image:url|og:image:secure_url|twitter:image|twitter:image:src)["'][^>]+content=["']([^"']+)["']/gi;
    let mm;
    while ((mm = metaRe.exec(html))) push(mm[2]);
    const metaRe2 = /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](og:image|og:image:url|og:image:secure_url|twitter:image|twitter:image:src)["']/gi;
    while ((mm = metaRe2.exec(html))) push(mm[1]);

    // 2) 正文区域 <img src>
    const region = (html.match(/<main[\s\S]*?<\/main>/i) || html.match(/<article[\s\S]*?<\/article>/i) || html.match(/<body[\s\S]*?<\/body>/i) || [null, html])[1] || html;
    const imgRe = /<img\b[^>]*>/gi;
    let im;
    while ((im = imgRe.exec(region))) {
        const tag = im[0];
        const srcMatch = tag.match(/\bsrc=["']([^"']+)["']/i);
        if (!srcMatch) continue;
        // 跳过低分辨率图标/播放按钮
        const width = (tag.match(/\bwidth=["']?(\d+)/i) || ['', ''])[1];
        const height = (tag.match(/\bheight=["']?(\d+)/i) || ['', ''])[1];
        const w = parseInt(width, 10) || 0;
        const h = parseInt(height, 10) || 0;
        if ((w && h && w < 120 && h < 120) || (w && w < 60) || (h && h < 60)) continue;
        push(srcMatch[1], tag);
    }

    return found.slice(0, max);
}

async function fetchSourceText(url, timeoutMs = 10000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const resp = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            },
        });
        if (!resp.ok) return { url, error: `HTTP ${resp.status}` };
        const ct = (resp.headers.get('content-type') || '').toLowerCase();
        if (!ct.includes('text/html')) return { url, error: `�? HTML 内容 (${ct})` };
        const html = await resp.text();
        const text = extractTextFromHtml(html);
        const title = extractTitleFromHtml(html);
        const images = extractImagesFromHtml(html, url);
        return { url, text: text.slice(0, 16000), title, images };
    } catch (e) {
        return { url, error: e.message || '抓取失败' };
    } finally {
        clearTimeout(timeoutId);
    }
}

// 单次检索（一�? query）：优先 Tavily（直接返�? cleaned 正文，最契合 RAG），否则 Brave，再�? Wikipedia�?
async function searchOnce(query, env, n = 5) {
    if (!query || !query.trim()) return [];
    // 1) Tavily
    if (env.TAVILY_API_KEY) {
        try {
            const resp = await fetch('https://api.tavily.com/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.TAVILY_API_KEY },
                body: JSON.stringify({ query, search_depth: 'advanced', max_results: n, include_raw_content: true }),
            });
            if (resp.ok) {
                const j = await resp.json();
                const results = (j.results || []).map(r => ({
                    title: r.title || '',
                    url: r.url,
                    content: (r.content || r.raw_content || '').slice(0, 3500),
                })).filter(r => r.url);
                if (results.length) return results;
            }
        } catch (_) {}
    }
    // 2) Brave
    if (env.BRAVE_API_KEY) {
        try {
            const resp = await fetch('https://api.search.brave.com/res/v1/web/search?q=' + encodeURIComponent(query) + '&count=' + n, {
                headers: { 'Accept': 'application/json', 'X-Subscription-Token': env.BRAVE_API_KEY },
            });
            if (resp.ok) {
                const j = await resp.json();
                const results = ((j.web && j.web.results) || []).map(r => ({
                    title: r.title || '',
                    url: r.url,
                    content: (r.description || '').slice(0, 1200),
                })).filter(r => r.url);
                const top = results.slice(0, 3);
                const fetched = await Promise.all(top.map(r => fetchSourceText(r.url)));
                fetched.forEach((f, i) => { if (f.text) top[i].content = f.text; top[i].images = f.images || []; if (f.title) top[i].title = f.title; });
                if (results.length) return results;
            }
        } catch (_) {}
    }
    // 3) Wikipedia（免费兜底，覆盖面有限但稳定�?
    try {
        const resp = await fetch('https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + encodeURIComponent(query) + '&format=json&srlimit=' + n, {
            headers: { 'User-Agent': 'tech-digest-bot/1.0' },
        });
        if (resp.ok) {
            const j = await resp.json();
            const items = (j.query && j.query.search) || [];
            const results = [];
            for (const it of items) {
                const title = it.title;
                const url = 'https://en.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_'));
                const f = await fetchSourceText(url);
                results.push({ title, url, content: f.text || (it.snippet || '').replace(/<[^>]+>/g, ''), images: f.images || [] });
            }
            if (results.length) return results;
        }
    } catch (_) {}
    return [];
}

// 联网检索：主词命中不足时，用兜底词（型�?/英文名等）重试并合并去重�?
// 返回 [{ title, url, content }]，失败或�? key 时返�? []�?
async function webSearch(query, env, n = 5, fallbackQuery) {
    let results = await searchOnce(query, env, n);
    // 命中少于 3 条时，用兜底词补充（避免「原文前 60 字碎句」这类差查询直接空手而归�?
    if (results.length < 3 && fallbackQuery && fallbackQuery.trim() && fallbackQuery.trim() !== String(query).trim()) {
        const more = await searchOnce(fallbackQuery, env, n);
        const seen = new Set(results.map(r => r.url));
        for (const r of more) { if (!seen.has(r.url)) { results.push(r); seen.add(r.url); } }
    }
    return results.slice(0, n);
}

// —�? 事实护栏：防止模型用训练记忆臆造原文没有的规格/数字/成就 —�?

// �? prompt 中提取「参考原文」（兜底用；优先使用请求体直接带来的 body.content�?
function extractSource(prompt) {
    // 原文位于「草稿正文：/Draft:」之后，直到下一段指令（输出要求/参考文�?/【）之前
    const m = prompt.match(/(?:草稿正文|Draft)\s*[:：]\s*\n([\s\S]*?)(?=\n输出要求|\n以下为|\n【|$) ?/);
    if (m && m[1].trim().length > 20) return m[1].trim();
    return '';
}

// 是否需要触发事实纠正：成稿里出现了原文没有的具体数�?/单位/规格名词，或短原文被扩写成大�?
// isSocial=true 时放宽：社媒语气常见「约90万日元」�?240fps 丝滑」这类口语化改写，不应误判为臆造，
// 仅在「短原文被大幅扩写」（典型臆造信号）时触发，把风格保真交�? correctDraft 的社媒语气约束�?
function needsFactCheck(text, src, isSocial) {
    if (!src) return false;
    if (isSocial) {
        const sl = src.replace(/\s+/g, '').length;
        const tl = text.replace(/\s+/g, '').length;
        return sl < 220 && tl > sl * 2.2;
    }
    const numUnit = /\d+(?:\.\d+)?\s*(?:km\/h|km|fps|ms|μm|µm|mm|cm|kg|g|万日元|日元|万元|美元|美金|usd|\$|%|档|倍|bit|万像素|像素|年|月|日|项|小时|分钟|秒|万次|万张|万部)/gi;
    const specNouns = [/\bExmor\b/gi, /\bCMOS\b/gi, /\bS-Cinetone\b/gi, /\bRAW\b/gi, /\bSDI\b/gi, /\b防抖\b/g, /\b动态范围\b/g, /\bND滤镜\b/g, /\b双基础\s*ISO\b/gi, /\bISO\b/gi, /\b传感器\b/g, /\b处理器\b/g, /\bBIONZ\b/gi, /\bXAVC\b/gi, /\b取景器\b/g, /\b液晶屏\b/g, /\b像素\b/g, /\b帧\b/g];
    let m;
    while ((m = numUnit.exec(text))) { if (!src.includes(m[0].replace(/\s+/g, ''))) return true; }
    for (const p of specNouns) { p.lastIndex = 0; let mm; while ((mm = p.exec(text))) { if (!src.includes(mm[0])) return true; } }
    // 触发�?2：原文极短（一句引�?/短讯），但成稿明显更�? �? 大概率在扩展臆�?
    const sl = src.replace(/\s+/g, '').length;
    const tl = text.replace(/\s+/g, '').length;
    if (sl < 220 && tl > sl * 2.2) return true;
    return false;
}

// 二次纠正：只依据原文重写，剔除所有原文没有的具体参数/数字/成就
async function correctDraft(src, bad, opts) {
    // 社媒（小红书/微博）风格：纠正时仍要保�? emoji、口语化、互动结尾，否则会把种草语气整个抹平
    const socialStyle = (opts && (opts.platform === 'xhs' || opts.platform === 'weibo'))
        ? '你同时必须保持小红书/社媒种草的活泼语气：�? emoji、口语化、分段清晰、结尾抛互动话题并带 #话题标签#，只是把其中臆造的具体参数/数字/成就替换为原文真实内容（或干脆删掉），不要退回成新闻稿或说明书�?'
        : '';
    const sys = `你是严谨的事实编辑。用户提供的【原文】是唯一事实来源。下靀��草稿】混入了一些原文未提及的规格、参数、数字、日期、价格、测试成绩或具体成就（来自模型记忆，属臆造）。请严格只依据原文重写：删除所有原文没有的具体参数/数字/成就，保留原文给出的事实与引语，语言自然流畅�?${socialStyle}若原文只是一句人物引语或一条短讯，则写成简短资讯——介绍人物身份、列出原文提到的作品、原样呈现其评价、做一句中性总结，绝不扩展任何原文未写的内容（不要写该产品拍了哪部电影、取得什么成绩或支持什么参数）。只输出修正后的正文，不要任何解释。`;
    const user = `【原文】\n${src}\n\n【需修正的草稿】\n${bad}\n\n请输出严格基于原文、无任何臆造的修正稿：`;
    try {
        const r = await fetch(opts.base + '/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + opts.apiKey },
            body: JSON.stringify({ model: opts.model, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], temperature: opts.temperature || 0.3, max_tokens: opts.maxTokens, stream: false }),
        });
        if (!r.ok) return null;
        const j = await r.json();
        return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || null;
    } catch (_) { return null; }
}

// 将文本切成小段（按码点，避免切断 emoji），供前端打字机式渲�?
function chunkText(s, size = 24) {
    const cps = Array.from(s || '');
    if (!cps.length) return [''];
    const out = [];
    for (let i = 0; i < cps.length; i += size) out.push(cps.slice(i, i + size).join(''));
    return out;
}

// 预检（浏览器跨域时触发）
export async function onRequestOptions({ request }) {
    const origin = request.headers.get('Origin');
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function onRequestPost({ request, env }) {
    const origin = request.headers.get('Origin');
    const acao = corsHeaders(origin);

    // 1) 解析请求�?
    let body;
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: '请求体必须是 JSON' }), { status: 400, headers: acao });
    }

    const prompt = (body.prompt || '').trim();
    if (!prompt) {
        return new Response(JSON.stringify({ error: '缺少 prompt 字段' }), { status: 400, headers: acao });
    }

    // 2.1) 聚合参考文献：用户提供�? URL + （可选）联网自动检索；注入 prompt 并回传前�?
    let augmentedPrompt = prompt;
    let references = [];   // [{title, url, content, images, ok, note}]，流结束后随 meta 回传前端
    let allImages = [];     // 所有来源抽到的配图 URL（去重汇总，供前端注入正文）
    const addImages = (imgs) => {
        (imgs || []).forEach(u => { if (!allImages.includes(u)) allImages.push(u); });
    };
    const topic = (body.topic || '').toString().slice(0, 200);

    // (a) 用户提供�? URL（作为补充参考文献，并抽取配图）
    const sourceUrls = (body.sources || [])
        .filter(s => /^https?:\/\//i.test(String(s).trim()))
        .slice(0, 6);
    if (sourceUrls.length) {
        const fetched = await Promise.all(sourceUrls.map(url => fetchSourceText(url)));
        fetched.forEach(s => {
            references.push({ title: s.title || s.url, url: s.url, content: s.text || '', images: s.images || [], ok: !s.error, note: s.error || '' });
            addImages(s.images);
        });
    }

    // (b) 联网自动检索（开启且未填 URL 时为主来源；已填 URL 时作为补充）
    if (body.webSearch) {
        try {
            const found = await webSearch(topic || (body.prompt || '').slice(0, 80), env, 6, body.topicFallback);
            for (const r of found) {
                references.push({ title: r.title || r.url, url: r.url, content: r.content || '', images: r.images || [], ok: !!r.content, note: r.content ? '' : '未检索到正文' });
                addImages(r.images);
            }
        } catch (_) {
            // 检索失败不影响生成，退化为基础重写
        }
    }

    // 注入正文（带编号与总量预算上限，降�? 502 概率�?
    if (references.length) {
        const MAX_TOTAL = 40000;
        let budget = MAX_TOTAL;
        augmentedPrompt += '\n\n【附加来源内容】以下是你必须使用的来源网页正文（参考文献），请严格基于这些事实写作，并�? [1]、[2] 等编号标注对应来源：\n';
        references.forEach((s, i) => {
            let text = '';
            if (!s.ok || !s.content) {
                text = s.note ? `（无法获取内容：${s.note}）` : '（无可用正文�?';
            } else {
                const allow = Math.max(400, budget);
                text = s.content.slice(0, allow);
                budget -= text.length;
            }
            augmentedPrompt += `\n[${i + 1}] URL: ${s.url}\n${text}\n`;
        });
        augmentedPrompt += '\n引用规则：每个事实性断言后面都必须紧�? [1]、[2] 等来源编号，与上�? URL 编号对应；如果某个事实无法从上述来源中确认，请在该句末尾标注 [?] 或省略该信息；绝对禁止捏造任何规格参数、硬件型号、数据、价格、发布日期、测试结果、引语或链接�?';
    }

    // 若最终没有任何可用参考文献（联网检索失败且无用户链接），禁止虚构引用编�?
    const hasUsableRefs = references.some(r => r.ok && r.content);
    if (!hasUsableRefs && body.webSearch) {
        augmentedPrompt += '\n\n（本次联网检索未能获取到可用的参考文献正文。因此请不要使用 [1]、[2] 等引用编号，不要添加参考来源小节。）';
    } else if (!hasUsableRefs) {
        augmentedPrompt += '\n\n（本次未提供参考文献，请不要使�? [1]、[2] 等引用编号，也不要添加参考来源小节。你可以使用训练数据中已知的真实参数来充实文章。）';
    }

    // 2) 读取密钥：优先用「用户自�? key」（BYOK，从请求体带来），其次用站点服务端密�?
    const apiKey = (body.apiKey && String(body.apiKey).trim()) || env.VECTOR_ENGINE_KEY || env.DEEPSEEK_API_KEY;
    if (!apiKey) {
        return new Response(JSON.stringify({ error: '未配�? API key：请在本页「API 设置」中填入你自己的 key，或联系站点管理员配置服务端默认 key�?' }), { status: 400, headers: acao });
    }

    // 3) 目标 API 地址：优先用户指�? base，其次服务端 VECTOR_ENGINE_BASE，默�? VectorEngine 代理
    const base = (body.base || env.VECTOR_ENGINE_BASE || 'https://api.vectorengine.cn/v1').trim().replace(/\/$/, '');
    if (!/^https:\/\//.test(base)) {
        return new Response(JSON.stringify({ error: 'base 必须�? https 开头的 API 地址' }), { status: 400, headers: acao });
    }
    const model = body.model || env.VECTOR_ENGINE_MODEL || 'deepseek-v4-flash';
    // 优先使用前端按语言估算�? token 上限（避免生成远超目标字数，防止「夹断」式截断）；
    // 未提供时回退�? wordCount*2 兜底
    const reqMaxTokens = parseInt(body.max_tokens, 10);
    const fallbackMaxTokens = Math.min(Math.max(parseInt(body.wordCount, 10) || 800, 1) * 2, 4096);
    const maxTokens = Math.min(Math.max(reqMaxTokens || fallbackMaxTokens, 50), 8192);

    // 4) 转发到上游生成（先缓冲完整结果，做事实护栏校验，再向客户端做打字机式输出�?
    try {
        const upstream = await fetch(base + '/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey,
                'Accept': 'text/event-stream',
            },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: augmentedPrompt }],
                temperature: (typeof body.temperature === 'number' ? body.temperature : 0.7),
                max_tokens: maxTokens,
                stream: true,
            }),
        });

        // 上游异常：原样报�?
        if (!upstream.ok) {
            const txt = await upstream.text().catch(() => '');
            return new Response(JSON.stringify({ error: '上游 API 调用失败�?' + upstream.status + '）：' + txt.slice(0, 300) }),
                { status: 502, headers: { ...acao, 'Content-Type': 'application/json; charset=utf-8' } });
        }

        // 缓冲完整正文（兼容流式与非流式、以及不同模型的内容字段路径�?
        const pickContent = (j) => {
            if (!j) return '';
            const ch = j.choices && j.choices[0];
            if (ch) {
                if (ch.delta && ch.delta.content) return ch.delta.content;
                if (ch.message && ch.message.content) return ch.message.content;
                if (ch.text) return ch.text;
                if (ch.content) return ch.content;
            }
            return j.content || j.output || j.text || '';
        };
        let firstText = '';
        if (upstream.body) {
            const dec = new TextDecoder();
            const reader = upstream.body.getReader();
            let buf = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += dec.decode(value, { stream: true });
                let idx;
                while ((idx = buf.indexOf('\n\n')) >= 0) {
                    const raw = buf.slice(0, idx); buf = buf.slice(idx + 2);
                    const dl = raw.split('\n').find(l => l.startsWith('data:')); if (!dl) continue;
                    const d = dl.slice(5).trim(); if (!d || d === '[DONE]') continue;
                    try { const c = pickContent(JSON.parse(d)); if (c) firstText += c; } catch (_) {}
                }
            }
            // 上游返回非流�? JSON（无 SSE 分隔）时，整体回退解析
            if (!firstText && buf.trim()) {
                try { firstText = pickContent(JSON.parse(buf.trim())); } catch (_) {}
            }
        } else {
            const txt = await upstream.text();
            try { firstText = pickContent(JSON.parse(txt)); } catch (_) { firstText = txt; }
        }

        // —�? 事实护栏：原文存在时，拦截「原文没有的具体参数/数字/规格/成就�? —�?
        const srcText = (body.content && body.content.trim().length > 20)
            ? body.content.trim()
            : extractSource(augmentedPrompt);
        // 社媒风格（小红书/微博）直接跳过事实纠正：种草 prompt 已要求「不编造素材外内容」，
        // 而纠正步骤会把活泼语气抹平成新闻稿；小红书文案的口语化数字改写（如「约90万日元」）也属正常表达�?
        const isSocial = body.platform === 'xhs' || body.platform === 'weibo';
        const suspicious = !!srcText && !isSocial && needsFactCheck(firstText, srcText, isSocial);
        let finalText = firstText;
        if (suspicious) {
            const corrected = await correctDraft(srcText, firstText, { apiKey, base, model, maxTokens, temperature: 0.3, platform: body.platform });
            if (corrected && corrected.trim().length > 10) finalText = corrected;
        }

        // 向客户端做打字机式输出（将最终正文切成小�? SSE 推送）
        const chunks = chunkText(finalText);
        const metaObj = { references, factChecked: suspicious };
        if (allImages.length) metaObj.images = allImages.slice(0, 30);
        const metaSse = references.length || allImages.length
            ? 'data: ' + JSON.stringify({ meta: metaObj }) + '\n\n'
            : (suspicious ? 'data: ' + JSON.stringify({ meta: { factChecked: true } }) + '\n\n' : '');
        const sse = chunks.map(c => 'data: ' + JSON.stringify({ content: c }) + '\n\n').join('') + metaSse + 'data: [DONE]\n\n';
        return new Response(sse, {
            status: 200,
            headers: { ...acao, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive' },
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: '上游 API 调用失败�?' + e.message }), { status: 502, headers: acao });
    }
}
