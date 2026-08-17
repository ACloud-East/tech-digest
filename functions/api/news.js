/**
 * Cloudflare Pages Function — 实时科技资讯抓取
 * 前端「刷新」按钮直接调用本接口，每次都实时拉取各源 RSS（不再依赖陈旧的静态 news.json）。
 * 失败时前端回退到 data/news.json；本接口自身对单源失败容错（跳过即可）。
 */

const FEEDS = [
    { key: 'ithome',        name: 'IT之家',        color: '#e13b3f', url: 'https://www.ithome.com/rss/' },
    { key: '36kr',          name: '36氪',          color: '#0066ff', url: 'https://www.36kr.com/feed', fallback: ['https://rsshub.rssforever.com/36kr/news', 'https://hub.slarker.me/36kr/news', 'https://rsshub.ktachibana.party/36kr/news'] },
    { key: 'netease',       name: '网易科技',      color: '#e60012', url: 'https://tech.163.com/', type: 'netease' },
    { key: 'oschina',       name: '开源中国',      color: '#e67e22', url: 'https://www.oschina.net/news/rss' },
    { key: 'leiphone',      name: '雷锋网',        color: '#0a8f3c', url: 'https://www.leiphone.com/feed' },
    { key: 'tmtpost',       name: '钛媒体',        color: '#d4202a', url: 'https://www.tmtpost.com/rss' },
    { key: 'sspai',         name: '少数派',        color: '#d93b3b', url: 'https://sspai.com/feed' },
    { key: 'ifanr',         name: '爱范儿',        color: '#d4233a', url: 'https://www.ifanr.com/feed' },
    { key: 'qbitai',        name: '量子位',        color: '#00796b', url: 'https://www.qbitai.com/feed' },
    { key: 'solidot',       name: 'Solidot',       color: '#546e7a', url: 'https://www.solidot.org/index.rss' },
    { key: 'wallstreetcn',  name: '华尔街见闻',    color: '#c8161d', url: 'https://feeds.crabpi.com/wallstreetcn/live', type: 'json' },
    { key: 'theverge',      name: 'The Verge',     color: '#e2127a', url: 'https://www.theverge.com/rss/index.xml' },
    { key: 'techcrunch',    name: 'TechCrunch',    color: '#0f9d58', url: 'https://techcrunch.com/feed/' },
    { key: 'engadget',      name: 'Engadget',      color: '#2b2d32', url: 'https://www.engadget.com/rss.xml' },
    { key: 'macrumors',     name: 'MacRumors',     color: '#1d4ed8', url: 'http://feeds.macrumors.com/MacRumors-Front' },
    { key: '9to5mac',       name: '9to5Mac',       color: '#0a84ff', url: 'https://9to5mac.com/feed/' },
    { key: 'androidauth',   name: 'AndroidAuthority', color: '#a4c639', url: 'https://www.androidauthority.com/feed/' },
    { key: 'lobsters',      name: 'Lobsters',      color: '#b22222', url: 'https://lobste.rs/rss' },
    { key: 'devto',         name: 'Dev.to',        color: '#4b3e99', url: 'https://dev.to/feed' },
    { key: 'darkreading',   name: 'Dark Reading',  color: '#1a1a2e', url: 'https://www.darkreading.com/rss.xml' },
    { key: 'zdnet',         name: 'ZDNet',         color: '#0066cc', url: 'https://www.zdnet.com/news/rss.xml' },
    // ── 用户反馈缺失的 5 大科技源（已逐一验证 RSS 可达且可解析）──
    { key: 'geekpark',      name: '极客公园',       color: '#00c4ff', url: 'https://www.geekpark.net/rss' },
    { key: 'dpreview',      name: 'DPReview',       color: '#0b66c2', url: 'https://www.dpreview.com/feed/' },
    { key: 'cnet',          name: 'CNET',          color: '#1a73e8', url: 'https://www.cnet.com/rss/news/' },
    { key: 'impresswatch',  name: 'Impress Watch', color: '#b71c1c', url: 'https://www.watch.impress.co.jp/data/rss/1.0/ipw/feed.rdf' },
];

function decodeEntities(s) {
    return (s || '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
        .replace(/&nbsp;/g, ' ');
}
function stripHtml(s) {
    // 必须先把 &lt; &gt; 等实体还原成 < >，再剥标签，否则 RSS 里编码过的 HTML 会原样残留
    const decoded = decodeEntities(s || '');
    return decoded.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
function inner(block, tag) {
    const m = block.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
    if (!m) return '';
    let c = m[1].trim();
    c = c.replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '');
    return c;
}
function getLink(block) {
    const self = block.match(/<link\s+[^>]*href="([^"]+)"/i);
    if (self) return self[1];
    const c = inner(block, 'link');
    if (c && /^https?:/.test(c)) return c;
    const idm = inner(block, 'id');
    if (idm && /^https?:/.test(idm)) return idm;
    return '';
}
function getTime(block) {
    const raw = inner(block, 'pubDate') || inner(block, 'published') || inner(block, 'updated') || inner(block, 'dc:date');
    if (raw) {
        const t = Date.parse(raw);
        if (!isNaN(t)) return new Date(t).toISOString();
    }
    return new Date().toISOString();
}
function getDesc(block) {
    const raw = inner(block, 'description') || inner(block, 'summary') || inner(block, 'content:encoded') || inner(block, 'content');
    const s = stripHtml(raw);
    return s.length > 220 ? s.slice(0, 220) + '…' : s;
}

function parseXmlFeed(xml, feed) {
    const blocks = xml.split(/<item[\s>]/i).slice(1).map(b => '<item' + b)
        .concat(xml.split(/<entry[\s>]/i).slice(1).map(b => '<entry' + b));
    const out = [];
    for (const b of blocks) {
        const title = stripHtml(inner(b, 'title'));
        const url = getLink(b);
        if (!title || !url) continue;
        out.push({
            source: feed.name,
            sourceColor: feed.color,
            title,
            description: getDesc(b),
            url,
            time: getTime(b),
            tags: [],
        });
    }
    return out;
}

// 兼容 JSON Feed（jsonfeed.org 规范，如华尔街见闻快讯第三方镜像）
function parseJsonFeed(raw, feed) {
    try {
        const j = JSON.parse(raw);
        const items = Array.isArray(j.items) ? j.items : [];
        const out = [];
        for (const it of items) {
            const title = stripHtml(it.title || '');
            const url = it.url || it.external_url || '';
            if (!title || !url) continue;
            let desc = it.content_text || '';
            if (!desc) desc = stripHtml(it.content_html || '');
            if (!desc) desc = stripHtml(it.summary || '');
            if (desc.length > 220) desc = desc.slice(0, 220) + '…';
            let time = new Date().toISOString();
            if (it.date_published) {
                const t = Date.parse(it.date_published);
                if (!isNaN(t)) time = new Date(t).toISOString();
            }
            out.push({
                source: feed.name,
                sourceColor: feed.color,
                title,
                description: desc,
                url,
                time,
                tags: [],
            });
        }
        return out;
    } catch (e) {
        return [];
    }
}

// 网易科技无公开 RSS，改为解析首页「最新列表」(newest-lists) 区块的 HTML
function parseNeteaseHtml(html, feed) {
    try {
        let zone = html.split('class="newest-lists"').pop();
        zone = zone.split('</ul>')[0];
        const blocks = zone.split('<li class="list_item">').slice(1);
        const out = [];
        const now = new Date();
        const y = now.getUTCFullYear();
        const m = String(now.getUTCMonth() + 1).padStart(2, '0');
        const d = String(now.getUTCDate()).padStart(2, '0');
        for (const b of blocks) {
            const mUrl = b.match(/href="(https:\/\/www\.163\.com\/(?:tech|dy)\/article\/[A-Z0-9]+\.html)"/);
            const mTitle = b.match(/class="nl-title">([\s\S]*?)<em class="nl-time">/);
            const mTime = b.match(/class="nl-time">([^<]+)</);
            if (!mUrl || !mTitle) continue;
            const url = mUrl[1];
            const title = stripHtml(mTitle[1]).replace(/&nbsp;/g, ' ').trim();
            if (!title) continue;
            // nl-time 为北京时间(UTC+8)，转成 UTC ISO 以便统一排序；
            // 跨天处理：若 nl-time 的时:分晚于当前北京时间，说明是「昨天」发布
            let time = new Date().toISOString();
            if (mTime) {
                const tm = mTime[1].trim().match(/(\d{1,2}):(\d{2})/);
                if (tm) {
                    const h = parseInt(tm[1], 10), min = parseInt(tm[2], 10);
                    const bjMs = Date.now() + 8 * 3600 * 1000; // 当前北京时间
                    const bj = new Date(bjMs);
                    const curH = bj.getUTCHours(), curM = bj.getUTCMinutes();
                    let ay = bj.getUTCFullYear(), amo = bj.getUTCMonth(), ad = bj.getUTCDate();
                    if (h > curH || (h === curH && min > curM)) { // 晚于现在 → 昨天
                        const yest = new Date(bjMs - 24 * 3600 * 1000);
                        ay = yest.getUTCFullYear(); amo = yest.getUTCMonth(); ad = yest.getUTCDate();
                    }
                    time = new Date(Date.UTC(ay, amo, ad, h, min, 0, 0) - 8 * 3600 * 1000).toISOString();
                }
            }
            out.push({
                source: feed.name,
                sourceColor: feed.color,
                title,
                description: '',
                url,
                time,
                tags: [],
            });
        }
        return out;
    } catch (e) {
        return [];
    }
}

async function fetchOne(url, feed, timeoutMs) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
            'Accept': 'application/rss+xml, application/xml, text/xml, application/json, */*',
        };
        if (url.includes('36kr.com')) headers['Referer'] = 'https://36kr.com/';
        const resp = await fetch(url, {
            signal: ctrl.signal,
            headers,
        });
        if (!resp.ok) return null;
        const raw = await resp.text();
        if (!raw || raw.length < 200) return null; // 太短 = 反爬页面（JS Challenge 等）
        // 网易科技：HTML 解析首页最新列表
        if (feed.type === 'netease') return parseNeteaseHtml(raw, feed);
        // JSON Feed（显式 type:'json' 或响应体以 { 开头）；其余按 RSS/Atom 处理
        if (feed.type === 'json' || /^\s*\{/.test(raw)) return parseJsonFeed(raw, feed);
        return parseXmlFeed(raw, feed);
    } catch (e) {
        return null;
    } finally {
        clearTimeout(tid);
    }
}

async function fetchFeed(feed, timeoutMs = 5000) {
    let result = await fetchOne(feed.url, feed, timeoutMs);
    // 主源失败时依次尝试 fallback URL 列表（支持多镜像容错）
    if ((!result || result.length === 0) && feed.fallback) {
        const fbs = Array.isArray(feed.fallback) ? feed.fallback : [feed.fallback];
        for (const fb of fbs) {
            result = await fetchOne(fb, feed, timeoutMs);
            if (result && result.length) break;
        }
    }
    return result || [];
}

export async function onRequestGet() {
    // 整体执行预算：超过此时间就返回已收集到的部分结果，绝不无限等待。
    // 防止多个源同时变慢时函数体跑到 Cloudflare 函数超时上限，导致前端一直转圈。
    const OVERALL_MS = 9000;
    const deadline = Date.now() + OVERALL_MS;
    const buckets = new Array(FEEDS.length);
    await Promise.race([
        Promise.all(FEEDS.map((f, i) => {
            // 单源超时收紧到 5s（上限），整体预算 9s：多数源 1~3s 即可返回，
            // 个别被阻断的慢源（如部分境外 RSS）不再拖累整体到 12s+，让接口更快回包。
            const budget = Math.min(5000, Math.max(3000, deadline - Date.now()));
            return fetchFeed(f, budget)
                .then(r => { buckets[i] = r || []; })
                .catch(() => { buckets[i] = []; });
        })),
        // 兜底：预算耗尽即返回已完成的源（剩余源在当前批次被丢弃，下次刷新再补）
        new Promise(res => setTimeout(res, OVERALL_MS + 800)),
    ]);
    const results = buckets.filter(Array.isArray);
    const seen = new Set();
    let articles = [];
    for (const list of results) {
        for (const a of list) {
            if (seen.has(a.title)) continue;
            seen.add(a.title);
            articles.push(a);
        }
    }
    articles.sort((x, y) => new Date(y.time) - new Date(x.time));
    // 安全上限（不是配额）：原值 500 过低，真实抓取池已稳定超过该值，
    // 导致每次都被削平到恰好 500，前端总数因此永远是同一个常数、刷新也不变。
    // 放宽到 3000 后，返回量随各源实际产出浮动，数字才真实反映抓取情况。
    const LIVE_MAX = 3000;
    if (articles.length > LIVE_MAX) articles = articles.slice(0, LIVE_MAX);
    return new Response(JSON.stringify({ articles, updateTime: new Date().toISOString(), live: true, partial: results.length < FEEDS.length }), {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
}
