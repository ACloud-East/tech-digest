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

    // 2) 读取密钥：优先用「用户自带 key」（BYOK，从请求体带来），其次用站点服务端密文
    const apiKey = (body.apiKey && String(body.apiKey).trim()) || env.VECTOR_ENGINE_KEY || env.DEEPSEEK_API_KEY;
    if (!apiKey) {
        return new Response(JSON.stringify({ error: '未配置 API key：请在本页「API 设置」中填入你自己的 key，或联系站点管理员配置服务端默认 key。' }), { status: 400, headers: acao });
    }

    // 3) 目标 API 地址：优先用户指定 base，其次服务端 VECTOR_ENGINE_BASE，默认 VectorEngine 代理
    const base = (body.base || env.VECTOR_ENGINE_BASE || 'https://api.vectorengine.cn/v1').trim().replace(/\/$/, '');
    if (!/^https:\/\//.test(base)) {
        return new Response(JSON.stringify({ error: 'base 必须是 https 开头的 API 地址' }), { status: 400, headers: acao });
    }
    const model = body.model || env.VECTOR_ENGINE_MODEL || 'deepseek-chat';
    const maxTokens = Math.min(Math.max(parseInt(body.wordCount, 10) || 800, 1) * 3, 4096);

    // 4) 转发到上游（开启流式，实现打字机式输出）
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
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.8,
                max_tokens: maxTokens,
                stream: true,
            }),
        });

        // 上游异常：原样报错
        if (!upstream.ok) {
            const txt = await upstream.text().catch(() => '');
            return new Response(JSON.stringify({ error: '上游 API 调用失败（' + upstream.status + '）：' + txt.slice(0, 300) }),
                { status: 502, headers: { ...acao, 'Content-Type': 'application/json; charset=utf-8' } });
        }

        // 上游不支持流式（无 body / 直接返回 JSON）：兜底为单次事件，前端会做打字机展开
        if (!upstream.body) {
            const txt = await upstream.text();
            let content = txt;
            try {
                const j = JSON.parse(txt);
                content = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || j.content || txt;
            } catch (_) {}
            const sse = 'data: ' + JSON.stringify({ content }) + '\n\n' + 'data: [DONE]\n\n';
            return new Response(sse, {
                status: 200,
                headers: { ...acao, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive' },
            });
        }

        // 流式透传：解析上游 SSE，抽取 delta.content，转成我们自己的 SSE 事件
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        const reader = upstream.body.getReader();
        let buf = '';

        const stream = new ReadableStream({
            async pull(controller) {
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) { flushBuffer(); controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close(); return; }
                        buf += decoder.decode(value, { stream: true });
                        flushBuffer();
                    }
                } catch (e) {
                    controller.enqueue(encoder.encode('data: ' + JSON.stringify({ error: '流读出错：' + e.message }) + '\n\n'));
                    controller.close();
                }
                function flushBuffer() {
                    let idx;
                    while ((idx = buf.indexOf('\n\n')) >= 0) {
                        const raw = buf.slice(0, idx);
                        buf = buf.slice(idx + 2);
                        const dataLine = raw.split('\n').find(l => l.startsWith('data:'));
                        if (!dataLine) continue;
                        const data = dataLine.slice(5).trim();
                        if (!data || data === '[DONE]') continue;
                        let content = '';
                        try {
                            const j = JSON.parse(data);
                            content = (j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content) || j.content || '';
                        } catch (_) { continue; }
                        if (content) controller.enqueue(encoder.encode('data: ' + JSON.stringify({ content }) + '\n\n'));
                    }
                }
            },
            cancel() { try { reader.cancel(); } catch (_) {} },
        });

        return new Response(stream, {
            status: 200,
            headers: { ...acao, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive' },
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: '上游 API 调用失败：' + e.message }), { status: 502, headers: acao });
    }
}
