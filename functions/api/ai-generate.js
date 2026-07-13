/**
 * Cloudflare Pages Function — AI 文案生成代理
 * 前端调用同源 /api/ai-generate，本函数持有 API key（仅存在于 Cloudflare 密文，
 * 浏览器/前端代码永远拿不到），转发到 VectorEngine（DeepSeek 代理）并返回结果。
 * 这样 key 不落地、不进前端、不进 git 仓库，同时规避浏览器直连第三方 API 的 CORS 限制。
 */

// 允许的请求来源：留空表示同源即可（Cloudflare Pages 站点本身）。
// 如需跨域（例如 GitHub Pages 站点也想调用本函数），可在此填入允许的 origin。
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

// 预检（浏览器跨域时触发）
export async function onRequestOptions({ request }) {
    const origin = request.headers.get('Origin');
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

export async function onRequestPost({ request, env }) {
    const origin = request.headers.get('Origin');
    const acao = corsHeaders(origin);

    // 1) 解析请求体
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

    // 2) 读取密钥（仅 Cloudflare 环境可见，前端不可见）
    const apiKey = env.VECTOR_ENGINE_KEY || env.DEEPSEEK_API_KEY;
    if (!apiKey) {
        return new Response(JSON.stringify({ error: '服务端未配置 API key（请在 Cloudflare 设置 VECTOR_ENGINE_KEY）' }), { status: 500, headers: acao });
    }

    // 3) 目标 API（默认 VectorEngine 代理；可用 VECTOR_ENGINE_BASE 覆盖为官方 api.deepseek.com）
    const base = (env.VECTOR_ENGINE_BASE || 'https://api.vectorengine.cn/v1').replace(/\/$/, '');
    const model = body.model || env.VECTOR_ENGINE_MODEL || 'deepseek-chat';
    const maxTokens = Math.min(Math.max(parseInt(body.wordCount, 10) || 800, 1) * 3, 4096);

    // 4) 转发到上游
    try {
        const upstream = await fetch(base + '/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey,
            },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.8,
                max_tokens: maxTokens,
            }),
        });

        // 直接透传上游响应（OpenAI / DeepSeek 兼容结构，前端 parseApiResponse 可解析）
        const data = await upstream.text();
        return new Response(data, {
            status: upstream.status,
            headers: { ...acao, 'Content-Type': 'application/json; charset=utf-8' },
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: '上游 API 调用失败：' + e.message }), { status: 502, headers: acao });
    }
}
