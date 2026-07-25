/**
 * Cloudflare Pages Function — AI 插图生成代理（BYOK）
 * 前端把「画面描述 + 风格参数」发到这里，本函数持有用户的图像 API Key
 * （仅存在于浏览器 localStorage / Cloudflare 密文，前端代码永远拿不到），
 * 转发到兼容 OpenAI 图像格式的服务（DALL·E 3 / gpt-image-1 / 通义万相 / 硅基流动 SDXL 等），
 * 并行生成 4 张图，返回 base64，规避浏览器直连第三方 API 的 CORS 限制。
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

// 画面比例 → OpenAI 图像 size（其他兼容端点一般也支持这些枚举）
const RATIO_SIZE = {
    '1:1': '1024x1024',
    '3:4': '1024x1792',
    '9:16': '1024x1792',
    '4:3': '1792x1024',
    '16:9': '1792x1024',
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

async function genOne(base, apiKey, model, prompt, size) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 60000);
    try {
        const resp = await fetch(base.replace(/\/$/, '') + '/images/generations', {
            method: 'POST',
            signal: ctrl.signal,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + apiKey,
            },
            body: JSON.stringify({
                model,
                prompt,
                n: 1,
                size,
                response_format: 'b64_json',
            }),
        });
        if (!resp.ok) {
            const txt = await resp.text().catch(() => '');
            return { ok: false, error: '上游' + resp.status + '：' + txt.slice(0, 200) };
        }
        const j = await resp.json();
        const item = (j.data && j.data[0]) || {};
        if (item.b64_json) return { ok: true, image: 'data:image/png;base64,' + item.b64_json };
        if (item.url) {
            // 部分端点只返回 url，代理抓取后转 base64，避免前端再跨域
            try {
                const r2 = await fetch(item.url);
                const buf = await r2.arrayBuffer();
                const b64 = Buffer.from(buf).toString('base64');
                return { ok: true, image: 'data:image/png;base64,' + b64 };
            } catch (e) {
                return { ok: true, image: item.url };
            }
        }
        return { ok: false, error: '上游未返回图像数据' };
    } catch (e) {
        return { ok: false, error: e.message || '请求失败' };
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
    const ratio = RATIO_SIZE[body.ratio] ? body.ratio : '3:4';
    const size = RATIO_SIZE[ratio];
    const count = 4; // 一次固定 4 张

    const base = (body.base || env.IMAGE_BASE || 'https://api.openai.com/v1').trim().replace(/\/$/, '');
    const apiKey = (body.apiKey || env.IMAGE_KEY || '').trim();
    const model = (body.model || env.IMAGE_MODEL || 'gpt-image-1').trim();
    const seed = body.seed ? parseInt(body.seed, 10) : null;

    if (!apiKey) {
        return new Response(JSON.stringify({ error: '未配置图像 API Key：请在「AI生成插图 → 图像API设置」中填入你的图像模型 Key。' }), { status: 400, headers: acao });
    }

    // 并行生成 4 张（各自带轻微构图变体）
    const tasks = [];
    for (let i = 0; i < count; i++) {
        const p = buildPrompt(text, style, mood, i);
        const payload = { model, prompt: p, n: 1, size, response_format: 'b64_json' };
        if (seed != null) payload.seed = seed + i; // 同种子+偏移，4 张既相关又有差异
        tasks.push(
            fetch(base + '/images/generations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
                body: JSON.stringify(payload),
            }).then(async (resp) => {
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
                        const buf = await r2.arrayBuffer();
                        return { ok: true, image: 'data:image/png;base64,' + Buffer.from(buf).toString('base64') };
                    } catch { return { ok: true, image: item.url }; }
                }
                return { ok: false, error: '上游未返回图像数据' };
            }).catch((e) => ({ ok: false, error: e.message || '请求失败' }))
        );
    }

    const results = await Promise.all(tasks);
    const images = results.filter((r) => r.ok && r.image).map((r) => r.image);
    const errors = results.filter((r) => !r.ok).map((r) => r.error);

    if (images.length === 0) {
        return new Response(JSON.stringify({ error: '图像生成全部失败：' + (errors[0] || '未知错误') + '。请检查图像 API Key / 地址 / 模型是否支持图像生成。' }), { status: 502, headers: acao });
    }

    return new Response(JSON.stringify({ images, errors, ratio, style, mood }), { status: 200, headers: { ...acao, 'Cache-Control': 'no-store' } });
}
