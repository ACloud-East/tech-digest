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
    // 去掉 CMS 图片占位符「图1 / 图 3 / 图12：」等图注标记，避免模型照抄成「新闻要点 - 图3」垃圾
    text = text.replace(/图\s*\d+\s*[-—:：]?/g, ' ');
    // 去掉分享/UI 噪声词（share、分享、收藏、上一篇、相关阅读…），这些不是正文内容。
    // 注意：中文词不能用 \b 边界——JS 的 \b 只对 ASCII \w 生效，套上 \b 会永远匹配不到中文。
    text = text.replace(/(?:share|分享|收藏|点赞|评论|上一篇|下一篇|相关阅读|热门推荐|返回顶部|加载更多|扫码|二维码|关注我们)/gi, ' ');
    // 去掉长篇星号/横线分隔符之后的页脚/声明
    text = text.replace(/\s*[*＊](?:\s*[*＊]){19,}[\s\S]*$/, '');
    text = text.replace(/\s*[-—](?:\s*[-—]){19,}[\s\S]*$/, '');
    // 去掉常见页脚/版权/备案/联系信息及其后的所有内�?
    const footerMarkers = ['版权所�?', 'ICP�?', '京公网安�?', '隐私政策', '责任声明', '联系我们', '关于索尼集团公司', '若有合作意向，请填写�?', '相关联系方式�?', '索尼集团公司是一�?'];
    const re = new RegExp('\\s(' + footerMarkers.map(escapeRegExp).join('|') + ')\\s');
    const m = text.match(re);
    if (m) text = text.slice(0, m.index + 1).trim();
    // 折叠 ≥15 字连续重复（原文英雄区/标题被重复嵌入正文导致的雷同片段），普通正文不会触发
    text = text.replace(/(.{15,})\1+/g, '$1');
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

// 单次检索（一个 query）：优先 Tavily（直接返回 cleaned 正文，最契合 RAG），否则 Brave，再 Wikipedia 兜底。
// 为减少"去年的旧新闻"问题：对含"最新/新/发布/更新"等词的查询追加当前年份，并限制 Tavily 只取近一年结果。
async function searchOnce(query, env, n = 5) {
    if (!query || !query.trim()) return [];
    const nowYear = new Date().getFullYear();
    const wantsLatest = /最新|新|发布|更新|推出|上线|news|update|release|latest|new\s/i.test(query);
    const hasYear = /\b20\d{2}\b/.test(query);
    const biasedQuery = (wantsLatest && !hasYear) ? `${query} ${nowYear}` : query;

    // 1) Tavily
    if (env.TAVILY_API_KEY) {
        try {
            const resp = await fetch('https://api.tavily.com/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.TAVILY_API_KEY },
                body: JSON.stringify({ query: biasedQuery, search_depth: 'advanced', max_results: n, include_raw_content: true, time_range: 'year' }),
            });
            if (resp.ok) {
                const j = await resp.json();
                const results = (j.results || []).map(r => ({
                    title: r.title || '',
                    url: r.url,
                    content: (r.content || r.raw_content || '').slice(0, 3500),
                    published_date: r.published_date || '',
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
                    published_date: r.published_date || r.page_age || '',
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
                    results.push({ title, url, content: f.text || (it.snippet || '').replace(/<[^>]+>/g, ''), images: f.images || [], published_date: '' });
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

// 将引用编号按文章中的首次出现顺序重新编号，并把 references 列表同步重排。
// 模型可能先引用 [3] 再引用 [1]，这会让读者/审稿人困惑。重排后：第一个出现的引用就是 [1]，第二个是 [2]……
function renumberCitations(text, references) {
    if (!text || !references || references.length === 0) return { text, references };
    // 按文本中首次出现的顺序收集原编号
    const seen = new Set();
    const order = [];
    const regex = /\[(\d+)\]/g;
    let m;
    while ((m = regex.exec(text))) {
        const n = parseInt(m[1], 10);
        if (n >= 1 && n <= references.length && !seen.has(n)) {
            seen.add(n);
            order.push(n);
        }
    }
    if (order.length === 0) return { text, references };
    // 生成映射：原编号 -> 新编号
    const map = {};
    order.forEach((oldN, idx) => { map[oldN] = idx + 1; });
    // 未在文中出现的引用放到最后（保持原相对顺序）
    for (let i = 1; i <= references.length; i++) {
        if (!map[i]) { map[i] = order.length + 1; order.push(i); }
    }
    // 重排 references
    const newRefs = order.map(oldN => references[oldN - 1]);
    // 替换文中所有 [N]
    const newText = text.replace(/\[(\d+)\]/g, (_, n) => {
        const nn = parseInt(n, 10);
        return '[' + (map[nn] || nn) + ']';
    });
    return { text: newText, references: newRefs };
}

// 调用上游模型并缓冲完整正文（兼容流式/非流式、以及不同模型的内容字段路径）。
// 上游返回非 200 时抛错；返回 200 但正文为空时返回 ''（由调用方决定重试）。
async function generateText(augmentedPrompt, opts) {
    const { apiKey, base, model, maxTokens, temperature } = opts;
    // v3103：给上游模型调用加 22s 客户端超时（预留 8s 给网络握手/重排，守住 Pages Functions 30s 墙钟上限）。
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 22000);
    let upstream;
    try {
        upstream = await fetch(base + '/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey, 'Accept': 'text/event-stream' },
            body: JSON.stringify({ model, messages: [{ role: 'user', content: augmentedPrompt }], temperature, max_tokens: maxTokens, stream: true }),
            signal: ctrl.signal,
        });
    } finally { clearTimeout(to); }
    if (!upstream.ok) {
        const txt = await upstream.text().catch(() => '');
        throw new Error('上游 API 调用失败（' + upstream.status + '）：' + txt.slice(0, 300));
    }
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
    let text = '';
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
                try { const c = pickContent(JSON.parse(d)); if (c) text += c; } catch (_) {}
            }
        }
        if (!text && buf.trim()) { try { text = pickContent(JSON.parse(buf.trim())); } catch (_) {} }
    } else {
        const txt = await upstream.text();
        try { text = pickContent(JSON.parse(txt)); } catch (_) { text = txt; }
    }
    return text;
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

// ===== 编辑态扩展：revise（对话式改稿）/ proofread（校对 AI 精校）=====
// 复用下方统一的密钥/base/代理/重试逻辑，不另起端点，避免密钥与代理逻辑漂移。
async function handleMode({ body, env, acao }) {
    const apiKey = (body.apiKey && String(body.apiKey).trim()) || env.VECTOR_ENGINE_KEY || env.DEEPSEEK_API_KEY;
    if (!apiKey) {
        return new Response(JSON.stringify({ error: '未配置 API key：请在本页「API 设置」中填入你自己的 key，或联系站点管理员配置服务端默认 key' }), { status: 400, headers: acao });
    }
    const base = (body.base || env.VECTOR_ENGINE_BASE || 'https://api.vectorengine.cn/v1').trim().replace(/\/$/, '');
    if (!/^https:\/\//.test(base)) {
        return new Response(JSON.stringify({ error: 'base 必须为 https 开头的 API 地址' }), { status: 400, headers: acao });
    }
    const model = body.model || env.VECTOR_ENGINE_MODEL || 'deepseek-v4-flash';

    // 通用：带重试地调用上游，缓冲完整结果
    async function gen(promptText, maxTokens, temperature) {
        let text = '', lastErr = null;
        for (let attempt = 0; attempt < 2; attempt++) {
            try { text = await generateText(promptText, { apiKey, base, model, maxTokens, temperature }); }
            catch (e) { lastErr = e; }
            if (text && text.trim().length > 0) break;
            await new Promise(r => setTimeout(r, 300));
        }
        if (!text || !text.trim().length) throw new Error('模型返回为空（已重试 2 次）：' + (lastErr ? lastErr.message : '上游未返回任何内容'));
        return text;
    }

    // —— revise：对话式改稿，流式返回整篇修订稿 ——
    if (body.mode === 'revise') {
        const article = (body.article || '').trim();
        const instruction = (body.instruction || '').trim();
        if (!article) return new Response(JSON.stringify({ error: '缺少 article（当前文章）' }), { status: 400, headers: acao });
        if (!instruction) return new Response(JSON.stringify({ error: '缺少 instruction（修改指令）' }), { status: 400, headers: acao });
        const maxTokens = Math.min(Math.max(parseInt(body.max_tokens, 10) || 4000, 50), 8192);
        const userPrompt = generateRevisePrompt(article, instruction, body.history, body.references);
        let revised;
        try { revised = await gen(userPrompt, maxTokens, 0.5); }
        catch (e) { return new Response(JSON.stringify({ error: '上游 API 调用失败：' + e.message }), { status: 502, headers: acao }); }
        const chunks = chunkText(revised);
        const sse = chunks.map(c => 'data: ' + JSON.stringify({ content: c }) + '\n\n').join('') + 'data: [DONE]\n\n';
        return new Response(sse, {
            status: 200,
            headers: { ...acao, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive' },
        });
    }

    // —— proofread：AI 精校，返回结构化事实清单（纯 JSON）——
    if (body.mode === 'proofread') {
        const article = (body.article || '').trim();
        if (!article) return new Response(JSON.stringify({ error: '缺少 article（当前文章）' }), { status: 400, headers: acao });
        const refs = Array.isArray(body.references) ? body.references : [];
        const userPrompt = generateProofreadPrompt(article, refs);
        let raw;
        try { raw = await gen(userPrompt, 4000, 0.2); }
        catch (e) { return new Response(JSON.stringify({ error: '上游 API 调用失败：' + e.message }), { status: 502, headers: acao }); }
        const facts = parseFactsJson(raw);
        if (!facts) return new Response(JSON.stringify({ error: '模型未返回有效的事实清单 JSON' }), { status: 502, headers: acao });
        return new Response(JSON.stringify({ facts }), {
            status: 200,
            headers: { ...acao, 'Content-Type': 'application/json; charset=utf-8' },
        });
    }

    return new Response(JSON.stringify({ error: '未知 mode' }), { status: 400, headers: acao });
}

// 拼装「对话式改稿」prompt：保持文体/结构/[n] 引用，按指令改并返回整篇。
function generateRevisePrompt(article, instruction, history, references) {
    const sys = '你是资深科技文案编辑。用户会给你一篇已生成的文章和一条修改指令，请严格按指令修改，并【返回完整修改后的全文】（不要只返回改动片段）。保持原文的文体、段落结构与引用标注 [1][2]；若指令涉及事实/数据，以原文已有内容为准，不要臆造新的参数、型号或价格。只输出正文，不要任何解释或「好的，已修改」之类前缀。';
    let user = '';
    if (Array.isArray(history) && history.length) {
        user += '【对话历史】\n' + history.map(m => (m.role === 'user' ? '用户：' : '助手：') + (m.text || '')).join('\n') + '\n\n';
    }
    user += '【当前文章】\n' + article + '\n\n【修改指令】\n' + instruction + '\n\n请输出修改后的完整文章：';
    if (Array.isArray(references) && references.length) {
        user += '\n\n【可用参考文献】（如需调整引用，按编号对应；不要编造新来源）\n' + references.map((r, i) => `[${i + 1}] ${r.title || r.url || ''} ${r.url || ''}`).join('\n');
    }
    return sys + '\n\n' + user;
}

// 拼装「校对 AI 精校」prompt：让模型抽结构化事实清单（数值/型号/日期等）。
function generateProofreadPrompt(article, refs) {
    const sys = '你是严谨的事实核查员。请从下面的文章中抽取所有「参数/数据类」事实断言——包括价格、百分比、尺寸、重量、容量（mAh/GB/TB）、频率、分辨率、功率、速率、温度、时长、版本号、硬件型号、发布日期、屏幕比例、镜头数、代数等具体数值或型号。';
    const fmt = `请严格只输出一个 JSON 数组，不要任何额外文字、不要 Markdown 代码块围栏。每条格式：
{"value":"抽取到的数值或型号原文，如 4999 元 / 120Hz / A19 Pro / 2026年6月9日 / 16:9","category":"价格|百分比|尺寸|重量|电池|屏幕|性能|版本|型号|日期|其他","context":"包含该数值的整句原文（尽量完整）","cite":1}
其中 cite 是该数值在文中对应的引用编号（[1]→1，[?] 或没有引用→0）；无法判断来源填 0。只输出 JSON 数组，不要输出其它内容。`;
    let user = sys + '\n\n' + fmt + '\n\n【文章】\n' + article;
    if (Array.isArray(refs) && refs.length) user += '\n\n【参考文献】\n' + refs.map((r, i) => `[${i + 1}] ${r.title || r.url || ''}`).join('\n');
    return user;
}

// 从模型返回中解析事实清单 JSON（容忍 ```json 围栏与前后多余文字）。
function parseFactsJson(raw) {
    if (!raw) return null;
    let s = String(raw).trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    // 退一步：截取第一个 [ 到最后一个 ]
    if (!s.startsWith('[')) {
        const a = s.indexOf('['), b = s.lastIndexOf(']');
        if (a >= 0 && b > a) s = s.slice(a, b + 1);
    }
    try {
        const arr = JSON.parse(s);
        if (Array.isArray(arr)) return arr;
    } catch (_) {}
    return null;
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

    // ===== 模式分支：revise / proofread（编辑态对话改稿 & 校对面板 AI 精校）=====
    // 必须放在「缺少 prompt」校验之前：revise/proofread 不需要 prompt 字段。
    // 复用统一的密钥/base/代理/重试/CORS 逻辑，避免在 ai-writer 之外再起一套端点。
    if (body.mode === 'revise' || body.mode === 'proofread') {
        return await handleMode({ body, env, acao });
    }

    if (!prompt) {
        return new Response(JSON.stringify({ error: '缺少 prompt 字段' }), { status: 400, headers: acao });
    }

    // 2.1) 聚合参考文献：用户提供�? URL + （可选）联网自动检索；注入 prompt 并回传前�?
    let augmentedPrompt = prompt;
    let references = [];   // [{title, url, content, images, ok, note}]，流结束后随 meta 回传前端
    let backgroundSources = []; // 鏈紑鍚仈缃戞悳绱㈡椂鐨勭敤鎴风珯鍘熸枃锛堜綔涓鸿儗鏅祫鏂欙紝涓嶇敓鎴愬紩鐢ㄧ紪鍙凤級
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
            if (body.webSearch) {
                references.push({ title: s.title || s.url, url: s.url, content: s.text || '', images: s.images || [], ok: !s.error, note: s.error || '', published_date: '' });
            } else {
                backgroundSources.push({ title: s.title || s.url, url: s.url, content: s.text || '', note: s.error || '' });
            }
            addImages(s.images);
        });
    }

    // (b) 联网自动检索（开启且未填 URL 时为主来源；已填 URL 时作为补充）
    if (body.webSearch) {
        try {
            const found = await webSearch(topic || (body.prompt || '').slice(0, 80), env, 4, body.topicFallback);
            for (const r of found) {
                references.push({ title: r.title || r.url, url: r.url, content: r.content || '', images: r.images || [], ok: !!r.content, note: r.content ? '' : '未检索到正文', published_date: r.published_date || '' });
                addImages(r.images);
            }
        } catch (_) {
            // 检索失败不影响生成，退化为基础重写
        }
    }

    // 注入正文（带编号与总量预算上限，降�? 502 概率�?
    if (references.length) {
        const MAX_TOTAL = 7000;
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
            augmentedPrompt += `\n[${i + 1}] URL: ${s.url}${s.published_date ? '\n发布时间: ' + s.published_date : ''}\n${text}\n`;
        });
        augmentedPrompt += '\n引用规则：每个事实性断言后面都必须紧�? [1]、[2] 等来源编号，与上�? URL 编号对应；如果来源标注了「发布时间」，请在正文相应处一并写出该官方时间（例如「苹果于 2026 年 6 月 9 日发布……」），以增强可信度；如果某个事实无法从上述来源中确认，请在该句末尾标注 [?] 或省略该信息；绝对禁止捏造任何规格参数、硬件型号、数据、价格、发布日期、测试结果、引语或链接�?';
    }

    // 若最终没有任何可用参考文献（联网检索失败且无用户链接），禁止虚构引用编�?

    // 鏈紑鍚仈缃戞悳绱㈡椂锛屽皢鐢ㄦ埛鎻愪緵鐨勫師鏂囬摼鎺ヤ綔涓鸿儗鏅祫鏂欏紩鍏ワ紝涓嶇敓鎴愬紩鐢ㄧ紪鍙?
    if (backgroundSources.length && !body.webSearch) {
        const MAX_BG = 16000;
        const noDraft = !(body.content && String(body.content).trim().length > 50);
        augmentedPrompt += noDraft
            ? '\n\n【抓取原文·本文核心素材】以下是系统抓取的网页正文（上方未提供草稿，因此这些是本文唯一核心素材）：\n'
            : '\n\n【参考原文/背景资料】以下是你可参考的原文内容（仅用于了解背景和提取配图，不要在正文中标注 [1]、[2] 等引用编号，也不要写「参考来源」小节）：\n';
        backgroundSources.forEach((s, i) => {
            const text = s.content ? s.content.slice(0, MAX_BG) : '';
            augmentedPrompt += `\n[背景${i + 1}] URL: ${s.url}\n${text}\n`;
        });
        augmentedPrompt += noDraft
            ? '\n提示：上方没有草稿，请【严格以以上抓取的原文内容为主体】撰写文章——把其中的产品、规格、发布信息、引语等如实组织成一篇完整、连贯、有信息量的文章；正文中不要使用 [1]、[2] 等引用编号，也不要写「参考来源」小节。绝对禁止捏造原文没有的规格/参数/数据/价格/日期。'
            : '\n提示：以上材料仅供参考，请严格联合上方打稿和主要素材写作，不要在正文中使用引用编号或列出来源。';
    }
    const hasUsableRefs = references.some(r => r.ok && r.content);
    if (!hasUsableRefs && body.webSearch) {
        augmentedPrompt += '\n\n（本次联网检索未能获取到可用的参考文献正文。因此请不要使用 [1]、[2] 等引用编号，不要添加参考来源小节。）';
    } else if (!hasUsableRefs && !body.webSearch && !backgroundSources.length) {
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
    // v3103：模型代理（vectorengine / deepseek）对大 prompt 偶发返回空流，做最多 3 次重试，
    // 避免用户在联网检索成功、却拿到空白正文的情况。
    try {
    const temperature = (typeof body.temperature === 'number' ? body.temperature : 0.7);
    let firstText = '';
    let lastErr = null;
    // 重试上限设为 2：模型代理偶发空流通常很快返回（<1s），2 次足够对冲；
    // 再多会叠加每次调用耗时，逼近 Cloudflare Pages Functions 执行时间上限（报错 1102）。
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            firstText = await generateText(augmentedPrompt, { apiKey, base, model, maxTokens, temperature });
        } catch (e) { lastErr = e; }
        if (firstText && firstText.trim().length > 0) break;
        await new Promise(r => setTimeout(r, 300));
    }
    if (!firstText || !firstText.trim().length) {
        return new Response(JSON.stringify({ error: '模型返回为空（已重试 2 次）：' + (lastErr ? lastErr.message : '上游未返回任何内容') }),
            { status: 502, headers: { ...acao, 'Content-Type': 'application/json; charset=utf-8' } });
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

        // v3103：把引用编号按【文中首次出现顺序】重排，避免 [3] 出现在 [1][2] 之前这种不合常理的编号
        if (references.length) {
            const reordered = renumberCitations(finalText, references);
            finalText = reordered.text;
            references = reordered.references;
        }

        // 向客户端做打字机式输出（将最终正文切成小�? SSE 推送）
        const chunks = chunkText(finalText);
        const metaObj = { references, factChecked: suspicious };
        // 小红书/微博输出要求不带图，避免社媒文案被正文图片打断阅读流
        const noImages = body.platform === 'xhs' || body.platform === 'weibo';
        if (allImages.length && !noImages) metaObj.images = allImages.slice(0, 30);
        const metaSse = references.length || (allImages.length && !noImages)
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
