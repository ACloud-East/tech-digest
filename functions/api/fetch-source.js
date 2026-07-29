/**
 * Cloudflare Pages Function — 抓取单个/多个原文链接
 * 纯抓取，不调用大模型，不需要 API Key。
 * 返回每个链接的 { title, text, images, ok, note }，供前端预填充「参考原文内容」并抽图。
 */

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

// 以下函数与 functions/api/ai-generate.js 保持一致，确保同源抓取行为相同

function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function cleanArticleText(text) {
    if (!text) return text;
    // 去掉原文自带的脚注标记 [1] [2]…，避免模型误当成引用编号输出
    text = text.replace(/\s*\[\d+\]\s*/g, ' ');
    // 去掉长篇星号/横线分隔符之后的页脚/声明
    text = text.replace(/\s*[*＊](?:\s*[*＊]){19,}[\s\S]*$/, '');
    text = text.replace(/\s*[-—](?:\s*[-—]){19,}[\s\S]*$/, '');
    // 去掉常见页脚/版权/备案/联系信息及其后的所有内容
    const footerMarkers = ['版权所有', 'ICP备', '京公网安备', '隐私政策', '责任声明', '联系我们', '关于索尼集团公司', '若有合作意向，请填写此', '相关联系方式：', '索尼集团公司是一家'];
    const re = new RegExp('\\s(' + footerMarkers.map(escapeRegExp).join('|') + ')\\s');
    const m = text.match(re);
    if (m) text = text.slice(0, m.index + 1).trim();
    return text.replace(/\s+/g, ' ').trim();
}

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

function extractImagesFromHtml(html, pageUrl, max = 12) {
    const found = [];
    const seen = new Set();

    const push = (raw, ctx = '') => {
        if (!raw) return;
        let u = String(raw).trim();
        if (!u || u.startsWith('data:') || u.startsWith('blob:')) return;
        try { u = new URL(u, pageUrl).href; } catch (_) { return; }
        if (!/^https?:\/\//i.test(u)) return;
        const lc = u.toLowerCase();
        const ctxLc = ctx.toLowerCase();
        // 过滤小图标 / logo / 像素追踪 / 视频相关
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

    const metaRe = /<meta[^>]+(?:property|name)=["'](og:image|og:image:url|og:image:secure_url|twitter:image|twitter:image:src)["'][^>]+content=["']([^"']+)["']/gi;
    let mm;
    while ((mm = metaRe.exec(html))) push(mm[2]);
    const metaRe2 = /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](og:image|og:image:url|og:image:secure_url|twitter:image|twitter:image:src)["']/gi;
    while ((mm = metaRe2.exec(html))) push(mm[1]);

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

async function fetchSourceText(url, timeoutMs = 15000) {
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
        if (!ct.includes('text/html')) return { url, error: `非 HTML 内容 (${ct})` };
        const html = await resp.text();
        const text = extractTextFromHtml(html);
        const title = extractTitleFromHtml(html);
        const images = extractImagesFromHtml(html, url);
        return { url, text: text.slice(0, 16000), title, images, ok: true };
    } catch (e) {
        return { url, error: e.message || '抓取失败', ok: false };
    } finally {
        clearTimeout(timeoutId);
    }
}

export async function onRequestOptions({ request }) {
    const origin = request.headers.get('Origin');
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function onRequestPost({ request }) {
    const origin = request.headers.get('Origin');
    const acao = corsHeaders(origin);

    let body;
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: '请求体必须是 JSON' }), { status: 400, headers: acao });
    }

    const urls = (body.urls || [])
        .map(u => String(u).trim())
        .filter(u => /^https?:\/\//i.test(u))
        .slice(0, 6);

    if (!urls.length) {
        return new Response(JSON.stringify({ error: '缺少 urls 参数或格式非法' }), { status: 400, headers: acao });
    }

    const results = await Promise.all(urls.map(url => fetchSourceText(url)));
    return new Response(JSON.stringify({ results }), { status: 200, headers: acao });
}
