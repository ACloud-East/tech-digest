/**
 * Cloudflare Pages Function — 历史归档代理
 *
 * 背景：前端加载 12MB 的 data/news.json 整包时，Chrome 无痕窗口对「大体积响应」的长连接极不稳，
 * 经常整段中断，只能拿到几百篇（其他浏览器正常 8000）。而同站点的 Function（/api/news）小响应在
 * 无痕里是通的。
 *
 * 解决：本接口把归档拆成小分片（data/news-parts/part-NNN.json，每片 ~1000 篇），服务端读取后
 * 由 Cloudflare 边缘自动 gzip 压缩（每片线上下行 ~300KB），前端并行拉 8 个分片即可稳定凑齐 8000。
 *
 * 路由：
 *   /api/archive?meta=1            -> 返回 data/news-parts/manifest.json（极小，含总分片数/总篇数/每片字节数）
 *   /api/archive?part=part-NNN.json-> 返回对应分片（交给 Cloudflare 自动 gzip）
 *   /api/archive（无参数）          -> 返回整包 data/news.json（兜底用）
 *
 * 注意：不要在此处手动 gzip！实测 Cloudflare 会对响应再做一次自动压缩，导致「双重 gzip」——
 * 浏览器只解压一次，拿到仍是 gzip 二进制，JSON.parse 直接报错。故这里只透传原始 body，
 * 压缩交由 Cloudflare 边缘完成（已验证会对 Function 响应加 content-encoding: gzip）。
 */

const SAFE_PART = /^part-\d+\.json$/;
const SAFE_NAME = /^[\w.-]+$/;

export async function onRequestGet(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const part = url.searchParams.get('part');
    const meta = url.searchParams.get('meta');

    let assetPath;
    if (meta === '1') {
        assetPath = '/data/news-parts/manifest.json';
    } else if (part) {
        // 防目录穿越：仅允许形如 part-NNN.json 的白名单文件名
        if (!SAFE_NAME.test(part) || !SAFE_PART.test(part)) {
            return new Response(JSON.stringify({ error: 'invalid part name' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
            });
        }
        assetPath = '/data/news-parts/' + part;
    } else {
        assetPath = '/data/news.json';
    }

    try {
        const assetUrl = new URL(assetPath, request.url).toString();
        const resp = await env.ASSETS.fetch(assetUrl);
        if (!resp.ok) throw new Error('assets responded ' + resp.status);

        // 透传原始 body，压缩交给 Cloudflare 边缘（避免双重 gzip）。
        // 转发上游 Content-Length（若有）供前端参考；前端分片进度统一用 manifest.sizes
        // （未压缩预期字节）计算，与压缩无关。
        const headers = {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-cache',
        };
        const cl = resp.headers.get('content-length');
        if (cl) headers['Content-Length'] = cl;
        return new Response(resp.body, { status: resp.status, headers });
    } catch (e) {
        return new Response(JSON.stringify({ error: String((e && e.message) || e) }), {
            status: 502,
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
    }
}
