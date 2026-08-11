/**
 * Cloudflare Pages Function — 历史归档代理
 *
 * 背景：前端直接 fetch 静态资源 data/news.json / data/news-parts/* 时，
 * 部分浏览器/网络（尤其 Chrome 无痕窗口）对「大体积静态文件」的长连接不稳定，
 * 经常整段中断，导致归档加载失败、看板只剩实时抓取的几百篇。
 * 而同站点的 Function（如 /api/news）在这些环境下却能正常访问。
 *
 * 本接口由服务端（Cloudflare 内部网络，稳定）读取静态归档，再流式透传给浏览器，
 * 让浏览器只需走「能正常工作的 Function 通路」即可拿到完整归档，绕开静态资源被挡的问题。
 */

export async function onRequestGet(context) {
    const { request, env } = context;
    try {
        const url = new URL('/data/news.json', request.url);
        // env.ASSETS 是 Pages 提供的静态资源读取器，从 Cloudflare 内部网络取文件，稳定且快
        const resp = await env.ASSETS.fetch(url.toString());
        if (!resp.ok) throw new Error('assets responded ' + resp.status);
        // 直接透传响应体（流式），不在函数内缓冲 12MB，避免内存/超时压力
        return new Response(resp.body, {
            status: resp.status,
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-cache',
            },
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: String((e && e.message) || e) }), {
            status: 502,
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
    }
}
