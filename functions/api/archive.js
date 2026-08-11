/**
 * Cloudflare Pages Function — 历史归档代理
 *
 * 背景：前端加载 12MB 的 data/news.json 整包时，Chrome 无痕窗口对「大体积响应」的长连接极不稳，
 * 经常整段中断，只能拿到几百篇（其他浏览器正常 8000）。而同站点的 Function（/api/news）小响应在
 * 无痕里是通的。
 *
 * 解决：本接口把归档拆成小分片（data/news-parts/part-NNN.json，每片 ~1MB、~1000 篇），
 * 服务端读取后 gzip 压缩（每片线上下行 ~300KB），前端并行拉 8 个分片即可稳定凑齐 8000。
 *
 * 路由：
 *   /api/archive?meta=1            -> 返回 data/news-parts/manifest.json（极小，含总分片数/总篇数）
 *   /api/archive?part=part-NNN.json-> 返回对应分片（gzip 压缩），前端按片并行加载、单片重试
 *   /api/archive（无参数）          -> 返回整包 data/news.json（兜底用，转发 Content-Length 供进度条）
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

        // 分片走 gzip 压缩：每片从 ~1MB 压到 ~300KB，无痕里也能稳定下完；
        // 浏览器会自动解压，前端用「分片数进度」展示，不依赖字节大小。
        if (meta !== '1' && part) {
            const gzipped = new Response(
                resp.body.pipeThrough(new CompressionStream('gzip')),
                {
                    status: resp.status,
                    headers: {
                        'Content-Type': 'application/json; charset=utf-8',
                        'Content-Encoding': 'gzip',
                        'Cache-Control': 'no-cache',
                    },
                }
            );
            return gzipped;
        }

        // 清单 / 整包：转发上游 Content-Length，让进度条显示真实文件大小与百分比
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
