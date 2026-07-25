/**
 * Cloudflare Pages Function — AI 插图生成代理（BYOK）
 * 前端把「画面描述 + 风格参数」发到这里，本函数持有用户的图像 API Key
 * （仅存在于浏览器 localStorage / Cloudflare 密文，前端代码永远拿不到），
 * 转发到兼容 OpenAI 图像格式的服务（DALL·E 3 / gpt-image-1 / 硅基流动 SDXL 等），
 * 或阿里百炼「通义万相」原生异步协议（wanx2.1，仅此协议可用），
 * 并行生成 4 张图，返回 base64，规避浏览器直连第三方 API 的 CORS 限制。
 *
 * 两条路径：
 *   1) OpenAI 兼容：base 含 /compatible-mode/ 或 非 dashscope → POST {base}/images/generations
 *   2) 通义万相原生：base 含 dashscope.aliyuncs.com 且不含 compatible-mode
 *      → POST {base}/api/v1/services/aigc/text2image/image-synthesis (X-DashScope-Async: enable)
 *      → 轮询 GET {base}/api/v1/tasks/{task_id} → 取 output.results[0].url → 转 base64
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

// ArrayBuffer → base64（不依赖 Buffer，兼容 Cloudflare Pages Functions 运行时）
function arrayBufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

// 风格预设 → 英文风格关键词（主导画风，避免中文 prompt 在部分端点失效）
const STYLE_EN = {
    xhs_fresh: 'xiaohongshu (RED) style illustration, soft pastel colors, clean lifestyle aesthetic, bright and inviting, high saturation, cute and trendy, appealing social-media cover',
    jap_film: 'japanese film photography style, muted tones, 35mm film grain, nostalgic, soft natural light',
    flat_minimal: 'minimal flat vector illustration, simple geometric shapes, modern, clean solid background, bold flat colors',
    '3d_cartoon': '3d cartoon render, claymation style, soft rounded shapes, pixar-like, vibrant and playful',
    guochao: 'modern Chinese guochao (national trend) style, traditional motifs with modern twist, rich red and gold, ornamental',
    realistic_ecom: 'professional product e-commerce photography, studio softbox lighting, sharp detail, clean white background',
    watercolor: 'hand-drawn watercolor painting, soft color washes, artistic, visible paper texture',
    cyber_neon: 'cyberpunk neon glow, dark background, vibrant neon lights, futuristic city mood',
};

// 光照/氛围 → 英文
const MOOD_EN = {
    natural: 'natural daylight, soft outdoor lighting',
    studio: 'studio softbox lighting, even illumination',
    night: 'neon night scene, glowing lights, dark moody background',
    warm: 'warm golden-hour sunlight, cozy healing vibe',
};

// OpenAI 兼容端点尺寸（用 x 分隔）
const RATIO_SIZE = {
    '1:1': '1024x1024',
    '3:4': '1024x1792',
    '9:16': '1024x1792',
    '4:3': '1792x1024',
    '16:9': '1792x1024',
};

// 通义万相（wanx2.1）原生端点尺寸：单边长上限 1440，用 * 分隔
const DASHSCOPE_SIZE = {
    '1:1': '1024*1024',
    '3:4': '768*1024',
    '9:16': '720*1280',
    '4:3': '1024*768',
    '16:9': '1280*720',
};

// 同一主体生成 4 张时的轻微构图变体，保证 4 图有差异
const VARIANTS = [
    'centered composition, subject in focus, clean background',
    'wide environmental shot, subject within a real-life scene',
    'close-up detail shot emphasizing texture and material',
    'dynamic angled view, energetic and eye-catching layout',
];

function buildPrompt(text, style, mood, variantIdx) {
    const styleEn = STYLE_EN[style] || STYLE_EN.xhs_fresh;
    const moodEn = MOOD_EN[mood] || '';
    const subject = (text || '').trim().slice(0, 600);
    const variant = VARIANTS[variantIdx % VARIANTS.length];
    // 风格与构图用英文明确保真度，主体内容保留用户原文（中文端点可直接理解，英文端点由风格词主导）
    return [
        styleEn,
        moodEn,
        variant,
        'high quality, detailed, no extraneous text or watermark unless requested.',
        'Subject / theme: ' + subject,
        'Suitable as a Xiaohongshu (RED) cover image.',
    ].filter(Boolean).join('. ') + '.';
}

// 路径 1：OpenAI 兼容 /images/generations
async function genOpenAI(base, apiKey, model, prompt, size, seed) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 60000);
    try {
        const payload = { model, prompt, n: 1, size, response_format: 'b64_json' };
        if (seed != null) payload.seed = seed;
        const resp = await fetch(base.replace(/\/$/, '') + '/images/generations', {
            method: 'POST',
            signal: ctrl.signal,
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
            body: JSON.stringify(payload),
        });
        if (!resp.ok) {
            const txt = await resp.text().catch(() => '');
            return { ok: false, error: '上游' + resp.status + '：' + txt.slice(0, 200) };
        }
        const j = await resp.json();
        const item = (j.data && j.data[0]) || {};
        if (item.b64_json) return { ok: true, image: 'data:image/png;base64,' + item.b64_json };
        if (item.url) {
            try {
                const r2 = await fetch(item.url);
                if (!r2.ok) return { ok: true, image: item.url };
                const buf = await r2.arrayBuffer();
                return { ok: true, image: 'data:image/png;base64,' + arrayBufferToBase64(buf) };
            } catch { return { ok: true, image: item.url }; }
        }
        return { ok: false, error: '上游未返回图像数据' };
    } catch (e) {
        return { ok: false, error: e.message || '请求失败' };
    } finally {
        clearTimeout(tid);
    }
}

// 路径 2：通义万相（阿里百炼）原生异步协议
async function genDashscope(base, apiKey, model, prompt, size, seed) {
    const host = base.replace(/\/$/, '');
    const ctrl = new AbortController();
    const deadline = Date.now() + 90000;
    const tid = setTimeout(() => ctrl.abort(), 90000);
    try {
        // 1) 提交异步任务（带 429 重试退避，避免触发万相每秒速率限制）
        let sub = null;
        for (let attempt = 0; attempt < 4; attempt++) {
            sub = await fetch(host + '/api/v1/services/aigc/text2image/image-synthesis', {
                method: 'POST',
                signal: ctrl.signal,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer ' + apiKey,
                    'X-DashScope-Async': 'enable',
                },
                body: JSON.stringify({
                    model,
                    input: { prompt },
                    parameters: Object.assign({ size, n: 1 }, seed != null ? { seed } : {}),
                }),
            });
            if (sub.ok) break;
            if (sub.status === 429 && attempt < 3) {
                await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
                continue;
            }
            const txt = await sub.text().catch(() => '');
            return { ok: false, error: '万相提交' + sub.status + '：' + txt.slice(0, 200) };
        }
        const sj = await sub.json();
        const taskId = sj.output && sj.output.task_id;
        if (!taskId) return { ok: false, error: '万相未返回 task_id：' + JSON.stringify(sj).slice(0, 200) };

        // 2) 轮询任务结果
        while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 2000));
            const poll = await fetch(host + '/api/v1/tasks/' + taskId, {
                method: 'GET',
                signal: ctrl.signal,
                headers: { Authorization: 'Bearer ' + apiKey },
            });
            if (poll.status === 429) { await new Promise((r) => setTimeout(r, 2000)); continue; }
            if (!poll.ok) {
                const txt = await poll.text().catch(() => '');
                return { ok: false, error: '万相轮询' + poll.status + '：' + txt.slice(0, 200) };
            }
            const pj = await poll.json();
            const status = pj.output && pj.output.task_status;
            if (status === 'SUCCEEDED') {
                const res = (pj.output.results && pj.output.results[0]) || {};
                const url = res.url;
                if (!url) return { ok: false, error: '万相成功但未返回图像 URL' };
                // 3) 下载转 base64（规避前端再跨域；不依赖 Buffer，兼容 Pages 运行时）
                try {
                    const img = await fetch(url, {
                        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://dashscope.aliyuncs.com/' },
                    });
                    if (!img.ok) return { ok: true, image: url };
                    const buf = await img.arrayBuffer();
                    return { ok: true, image: 'data:image/png;base64,' + arrayBufferToBase64(buf) };
                } catch (e) {
                    console.error('WANX_IMG_FETCH_FAIL', e && e.message, String(url).slice(0, 70));
                    return { ok: true, image: url };
                }
            } else if (status === 'FAILED') {
                const msg = (pj.output && pj.output.message) || JSON.stringify(pj).slice(0, 200);
                return { ok: false, error: '万相生成失败：' + msg };
            }
            // PENDING / RUNNING → 继续轮询
        }
        return { ok: false, error: '万相生成超时（90s）' };
    } catch (e) {
        return { ok: false, error: e.message || '万相请求失败' };
    } finally {
        clearTimeout(tid);
    }
}

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: corsHeaders('*') });
}

export async function onRequestPost({ request, env }) {
    const origin = request.headers.get('Origin');
    const acao = corsHeaders(origin);

    let body;
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: '请求体必须是 JSON' }), { status: 400, headers: acao });
    }

    const text = (body.text || '').trim();
    if (!text) {
        return new Response(JSON.stringify({ error: '请先输入画面描述（或先从 AI 文案导入参考原文）' }), { status: 400, headers: acao });
    }

    const style = body.style || 'xhs_fresh';
    const mood = body.mood || 'natural';
    const count = 4; // 一次固定 4 张

    const base = (body.base || env.IMAGE_BASE || 'https://api.openai.com/v1').trim().replace(/\/$/, '');
    const apiKey = (body.apiKey || env.IMAGE_KEY || '').trim();
    const model = (body.model || env.IMAGE_MODEL || 'gpt-image-1').trim();

    if (!apiKey) {
        return new Response(JSON.stringify({ error: '未配置图像 API Key：请在「AI生成插图 → 图像API设置」中填入你的图像模型 Key（站点已预置通义万相，留空即用站点默认）。' }), { status: 400, headers: acao });
    }

    // 判定路径：base 含 dashscope 且非 compatible-mode → 通义万相原生协议
    const isDashScope = base.includes('dashscope.aliyuncs.com') && !base.includes('/compatible-mode/');
    const sizeMap = isDashScope ? DASHSCOPE_SIZE : RATIO_SIZE;
    const ratio = sizeMap[body.ratio] ? body.ratio : '3:4';
    const size = sizeMap[ratio];
    const seed = body.seed ? parseInt(body.seed, 10) : null;

    // 并行（通义万相错开提交）生成 4 张，逐张以 SSE 流式返回，便于前端展示进度条
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const send = (obj) => {
                try { controller.enqueue(encoder.encode('data: ' + JSON.stringify(obj) + '\n\n')); } catch (_) {}
            };
            let done = 0;
            let failCount = 0;
            let firstError = '';
            const jobs = [];
            for (let i = 0; i < count; i++) {
                if (isDashScope && i > 0) await new Promise((r) => setTimeout(r, 1500));
                const p = buildPrompt(text, style, mood, i);
                const seedOff = seed != null ? seed + i : null;
                const job = (isDashScope
                    ? genDashscope(base, apiKey, model, p, size, seedOff)
                    : genOpenAI(base, apiKey, model, p, size, seedOff)
                ).then((res) => {
                    done++;
                    if (res.ok) {
                        send({ type: 'image', index: i, ok: true, image: res.image, done, total: count });
                    } else {
                        failCount++;
                        if (!firstError) firstError = res.error || '生成失败';
                        send({ type: 'image', index: i, ok: false, image: null, error: res.error, done, total: count });
                    }
                }).catch((e) => {
                    done++;
                    failCount++;
                    if (!firstError) firstError = e.message || '生成失败';
                    send({ type: 'image', index: i, ok: false, image: null, error: e.message || '生成失败', done, total: count });
                });
                jobs.push(job);
            }
            await Promise.all(jobs);
            send({ type: 'done', done, total: count, allFailed: failCount === count, firstError });
            controller.close();
        },
    });

    return new Response(stream, {
        status: 200,
        headers: {
            ...acao,
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-store',
            'Connection': 'keep-alive',
        },
    });
}
