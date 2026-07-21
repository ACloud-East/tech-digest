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

// 从 HTML 中提取正文：移除脚本/样式/导航/页脚等噪声，优先取 <main>/<article>/<body>
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

    return content
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
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
        if (!ct.includes('text/html')) return { url, error: `非 HTML 内容 (${ct})` };
        const html = await resp.text();
        const text = extractTextFromHtml(html);
        return { url, text: text.slice(0, 3500) };
    } catch (e) {
        return { url, error: e.message || '抓取失败' };
    } finally {
        clearTimeout(timeoutId);
    }
}

// 单次检索（一个 query）：优先 Tavily（直接返回 cleaned 正文，最契合 RAG），否则 Brave，再次 Wikipedia。
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
                fetched.forEach((f, i) => { if (f.text) top[i].content = f.text; });
                if (results.length) return results;
            }
        } catch (_) {}
    }
    // 3) Wikipedia（免费兜底，覆盖面有限但稳定）
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
                results.push({ title, url, content: f.text || (it.snippet || '').replace(/<[^>]+>/g, '') });
            }
            if (results.length) return results;
        }
    } catch (_) {}
    return [];
}

// 联网检索：主词命中不足时，用兜底词（型号/英文名等）重试并合并去重。
// 返回 [{ title, url, content }]，失败或无 key 时返回 []。
async function webSearch(query, env, n = 5, fallbackQuery) {
    let results = await searchOnce(query, env, n);
    // 命中少于 3 条时，用兜底词补充（避免「原文前 60 字碎句」这类差查询直接空手而归）
    if (results.length < 3 && fallbackQuery && fallbackQuery.trim() && fallbackQuery.trim() !== String(query).trim()) {
        const more = await searchOnce(fallbackQuery, env, n);
        const seen = new Set(results.map(r => r.url));
        for (const r of more) { if (!seen.has(r.url)) { results.push(r); seen.add(r.url); } }
    }
    return results.slice(0, n);
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

    // 2.1) 聚合参考文献：用户提供的 URL + （可选）联网自动检索；注入 prompt 并回传前端
    let augmentedPrompt = prompt;
    let references = [];   // [{title, url, content, ok, note}]，流结束后随 meta 回传前端
    const topic = (body.topic || '').toString().slice(0, 200);

    // (a) 用户提供的 URL（作为补充参考文献）
    const sourceUrls = (body.sources || [])
        .filter(s => /^https?:\/\//i.test(String(s).trim()))
        .slice(0, 6);
    if (sourceUrls.length) {
        const fetched = await Promise.all(sourceUrls.map(url => fetchSourceText(url)));
        fetched.forEach(s => references.push({ title: s.url, url: s.url, content: s.text || '', ok: !s.error, note: s.error || '' }));
    }

    // (b) 联网自动检索（开启且未填 URL 时为主来源；已填 URL 时作为补充）
    if (body.webSearch) {
        try {
            const found = await webSearch(topic || (body.prompt || '').slice(0, 80), env, 6, body.topicFallback);
            for (const r of found) {
                references.push({ title: r.title || r.url, url: r.url, content: r.content || '', ok: !!r.content, note: r.content ? '' : '未检索到正文' });
            }
        } catch (_) {
            // 检索失败不影响生成，退化为基础重写
        }
    }

    // 注入正文（带编号与总量预算上限，降低 502 概率）
    if (references.length) {
        const MAX_TOTAL = 18000;
        let budget = MAX_TOTAL;
        augmentedPrompt += '\n\n【附加来源内容】以下是你必须使用的来源网页正文（参考文献），请严格基于这些事实写作，并按 [1]、[2] 等编号标注对应来源：\n';
        references.forEach((s, i) => {
            let text = '';
            if (!s.ok || !s.content) {
                text = s.note ? `（无法获取内容：${s.note}）` : '（无可用正文）';
            } else {
                const allow = Math.max(400, budget);
                text = s.content.slice(0, allow);
                budget -= text.length;
            }
            augmentedPrompt += `\n[${i + 1}] URL: ${s.url}\n${text}\n`;
        });
        augmentedPrompt += '\n引用规则：每个事实性断言后面都必须紧跟 [1]、[2] 等来源编号，与上方 URL 编号对应；如果某个事实无法从上述来源中确认，请在该句末尾标注 [?] 或省略该信息；绝对禁止捏造任何规格参数、硬件型号、数据、价格、发布日期、测试结果、引语或链接。';
    }

    // 若最终没有任何可用参考文献（联网检索失败且无用户链接），禁止虚构引用编号
    const hasUsableRefs = references.some(r => r.ok && r.content);
    if (!hasUsableRefs && body.webSearch) {
        augmentedPrompt += '\n\n（本次联网检索未能获取到可用的参考文献正文。因此请不要使用 [1]、[2] 等引用编号，不要添加参考来源小节。）';
    } else if (!hasUsableRefs) {
        augmentedPrompt += '\n\n（本次未提供参考文献，请不要使用 [1]、[2] 等引用编号，也不要添加参考来源小节。你可以使用训练数据中已知的真实参数来充实文章。）';
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
    const model = body.model || env.VECTOR_ENGINE_MODEL || 'deepseek-v3';
    // 优先使用前端按语言估算的 token 上限（避免生成远超目标字数，防止「夹断」式截断）；
    // 未提供时回退到 wordCount*2 兜底
    const reqMaxTokens = parseInt(body.max_tokens, 10);
    const fallbackMaxTokens = Math.min(Math.max(parseInt(body.wordCount, 10) || 800, 1) * 2, 4096);
    const maxTokens = Math.min(Math.max(reqMaxTokens || fallbackMaxTokens, 50), 8192);

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
                messages: [{ role: 'user', content: augmentedPrompt }],
                temperature: (typeof body.temperature === 'number' ? body.temperature : 0.7),
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
            const metaSse = references.length ? 'data: ' + JSON.stringify({ meta: { references } }) + '\n\n' : '';
            const sse = 'data: ' + JSON.stringify({ content }) + '\n\n' + metaSse + 'data: [DONE]\n\n';
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
                        if (done) {
                            flushBuffer();
                            if (references.length) controller.enqueue(encoder.encode('data: ' + JSON.stringify({ meta: { references } }) + '\n\n'));
                            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                            controller.close();
                            return;
                        }
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
