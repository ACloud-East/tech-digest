/**
 * Cloudflare Pages Function — 图片代理
 * 前端把原文抽到的图片地址通过 ?u=<encoded> 传过来，本函数服务端代抓后回传字节。
 * 这样可绕过大多数站点的「防盗链」（Referer 校验）：服务端请求不带 Referer，
 * 同时给浏览器返回正确的 Content-Type 与 CORS 头，使文章配图能稳定显示。
 */

const ALLOWED_ORIGINS = [];

function corsHeaders(origin) {
    const headers = {};
    if (origin && (ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin))) {
        headers['Access-Control-Allow-Origin'] = origin;
    }
    return headers;
}

export async function onRequestOptions({ request }) {
    const origin = request.headers.get('Origin');
    return new Response(null, {
        status: 204,
        headers: {
            ...corsHeaders(origin),
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        },
    });
}

export async function onRequestGet({ request }) {
    const origin = request.headers.get('Origin');
    const acao = corsHeaders(origin);

    const url = new URL(request.url);
    const target = (url.searchParams.get('u') || '').trim();

    if (!target || !/^https?:\/\//i.test(target)) {
        return new Response('缺少或非法的 u 参数', { status: 400, headers: acao });
    }

    // 仅允许抓取 http(s) 图片，避免被当成任意代理
    let parsed;
    try { parsed = new URL(target); } catch (_) {
        return new Response('URL 解析失败', { status: 400, headers: acao });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return new Response('仅支持 http/https', { status: 400, headers: acao });
    }

    try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 15000);
        const resp = await fetch(target, {
            signal: ctrl.signal,
            redirect: 'follow',
            headers: {
                // 不带 Referer → 绕过多数防盗链；带常见 UA 模拟浏览器
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
            },
        });
        clearTimeout(tid);

        if (!resp.ok) {
            return new Response('上游图片获取失败：' + resp.status, { status: 502, headers: acao });
        }
        const ct = (resp.headers.get('content-type') || '').toLowerCase();
        if (!ct.startsWith('image/')) {
            return new Response('上游非图片内容：' + ct, { status: 415, headers: acao });
        }
        const buf = await resp.arrayBuffer();
        return new Response(buf, {
            status: 200,
            headers: {
                ...acao,
                'Content-Type': ct,
                'Cache-Control': 'public, max-age=86400',
                'Access-Control-Allow-Origin': origin || '*',
            },
        });
    } catch (e) {
        return new Response('图片代理出错：' + (e.message || '未知错误'), { status: 502, headers: acao });
    }
}
