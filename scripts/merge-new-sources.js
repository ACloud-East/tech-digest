#!/usr/bin/env node
/**
 * merge-new-sources.js — 一次性合并脚本（自包含，仅依赖 Node 内置模块）
 *
 * 目的：把 DPReview / CNET / Impress Watch 三个新增筛选源的最新文章
 * 并入现有 data/news.json 归档（保留全部既有生产数据），并重新生成
 * data/news-meta.json 与分块归档 data/news-chunks/（manifest + part-NNN.json）。
 *
 * 三个源均为纯科技站点（相机/影像评测、综合科技、日本 PC/汽车/数码），
 * 因此默认「纯科技直通」——与管线对 The Verge / Engadget 等的处理一致。
 * 其中 CNET 含 wellness / home / money 等非科技栏目，对其标题额外施加
 * 英文强科技词过滤，确保只保留与科技相关的文章。
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const FETCH_TIMEOUT = 15000;
const ARCHIVE_MAX = 8000;

// 与 fetch-news.js / api.js 完全一致的源名与配色，保证前端筛选与徽标配色一致
const NEW_SOURCES = [
    { name: 'DPReview',      color: '#0b66c2', url: 'https://www.dpreview.com/feed/' },
    { name: 'CNET',          color: '#1a73e8', url: 'https://www.cnet.com/rss/news/' },
    { name: 'Impress Watch', color: '#b71c1c', url: 'https://www.watch.impress.co.jp/data/rss/1.0/ipw/feed.rdf' },
    // 修复：36氪 原 36kr.com/feed 已上 WAF 挑战页，改用 www.36kr.com/feed（直连可用）
    { name: '36氪',          color: '#0066ff', url: 'https://www.36kr.com/feed' },
    // 修复：极客公园 原 RSSHub 镜像已失效(503)，改用官网 geekpark.net/rss（直连可用）
    { name: '极客公园',      color: '#00c4ff', url: 'https://www.geekpark.net/rss' },
];

// 仅对 CNET 施加英文强科技词过滤（DPReview / Impress Watch 为纯科技源，直通）
const TECH_FILTER_SOURCES = new Set(['CNET']);
const EN_TECH = [
    'ai', 'artificial intelligence', 'machine learning', 'deep learning', 'llm', 'chatgpt',
    'gemini', 'copilot', 'gpt', 'openai', 'claude', 'meta', 'google', 'apple', 'samsung',
    'sony', 'nikon', 'canon', 'huawei', 'xiaomi', 'microsoft', 'amazon', 'tesla', 'nvidia',
    'intel', 'amd', 'qualcomm', 'android', 'iphone', 'ipad', 'mac', 'pixel', 'galaxy',
    'smartphone', 'phone', 'mobile', 'laptop', 'notebook', 'tablet', 'computer', 'pc',
    'monitor', 'tv', 'television', 'display', 'oled', 'led', 'screen', 'camera', 'cameras',
    'lens', 'lenses', 'sensor', 'sensors', 'mirrorless', 'dslr', 'photography', 'photo',
    'drone', 'headphone', 'headphones', 'earbud', 'earbuds', 'speaker', 'speakers', 'audio',
    'gpu', 'cpu', 'chip', 'chips', 'semiconductor', 'processor', 'ram', 'ssd', 'storage',
    'battery', 'charger', 'charging', 'ev', 'electric vehicle', 'electric', 'robot', 'robots',
    'robotics', 'software', 'app', 'apps', 'windows', 'macos', 'ios', 'linux', 'chrome',
    'browser', 'cyber', 'security', 'hack', 'vr', 'ar', 'xr', 'wearable', 'smartwatch',
    'gadget', 'gadgets', 'graphics', 'game', 'gaming', 'console', 'review', 'reviews',
    'hands-on', 'hands on', 'benchmark', 'unboxing', 'first look', 'preview', 'launch',
    'announce', 'release', 'update', 'upgrade', 'foldable', 'ultrabook', 'desktop',
    'motherboard', 'keyboard', 'mouse', 'router', 'wifi', 'bluetooth', 'usb', 'usb-c',
    'thunderbolt', '5g', '6g', 'network', 'cloud', 'data', 'tech', 'technology', 'digital',
    'electronics', 'hardware', 'electric car', 'self-driving', 'autonomous', 'space',
    'rocket', 'satellite', 'quantum', 'blockchain', 'crypto', 'metaverse', 'web3',
];

function fetchText(url, redirects) {
    redirects = redirects || 0;
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https') ? https : http;
        const req = lib.get(url, {
            headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' }
        }, res => {
            const status = res.statusCode || 0;
            if (status >= 300 && status < 400 && res.headers.location) {
                res.resume();
                if (redirects >= 4) return reject(new Error('重定向次数过多'));
                const next = res.headers.location.startsWith('http')
                    ? res.headers.location
                    : new URL(res.headers.location, url).href;
                return fetchText(next, redirects + 1).then(resolve, reject);
            }
            if (status !== 200) { res.resume(); return reject(new Error('HTTP ' + status)); }
            let data = '';
            res.setEncoding('utf8');
            res.on('data', c => { data += c; });
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.setTimeout(FETCH_TIMEOUT, () => req.destroy(new Error('请求超时')));
    });
}

function unesc(s) {
    return s
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
function stripCdata(s) { return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'); }
function stripHtml(s) {
    if (!s) return '';
    return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
function toIso(d) {
    if (!d) return '';
    let s = d.trim();
    // 兼容 "2026-08-17 11:10:06 +0800"（空格分隔 + 无冒号时区）这类格式
    s = s.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/, '$1T$2');
    s = s.replace(/\s+([+-]\d{2})(\d{2})$/, '$1:$2'); // 去掉时区前的空格并补冒号
    const t = new Date(s);
    return isNaN(t.getTime()) ? '' : t.toISOString();
}

// 解析 RSS 2.0 / RDF(RSS 1.0) / Atom：兼容 <item> 与 <entry>，提取标题/链接/摘要/时间
function parseItems(xml) {
    const items = [];
    const re = /<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi;
    let m;
    while ((m = re.exec(xml))) {
        const b = m[0];
        const get = (tag) => {
            const mm = b.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i'));
            return mm ? stripCdata(unesc(mm[1].trim())) : '';
        };
        // 链接：Atom 用 <link rel="alternate" href="...">，RSS 2.0/RDF 用 <link>文本</link>
        let link = '';
        const linkMatches = [...b.matchAll(/<link\b([^>]*)\/?>/gi)];
        for (const lm of linkMatches) {
            const rel = (lm[1].match(/rel=["']([^"']+)["']/i) || [])[1];
            const h = (lm[1].match(/href=["']([^"']+)["']/i) || [])[1];
            if (!h) continue;
            if (rel === 'alternate') { link = h; break; }
            if (!link) link = h;
        }
        if (!link) link = get('link');

        const title = get('title');
        const descRaw = get('description') || get('summary') || get('content') || get('content:encoded');
        const desc = stripHtml(descRaw).slice(0, 800);
        const dateRaw = get('pubDate') || get('published') || get('updated') || get('dc:date') || get('date');
        const time = toIso(dateRaw);
        if (title && link) items.push({ title, url: link, description: desc, time });
    }
    return items;
}

function relevant(srcName, title) {
    if (TECH_FILTER_SOURCES.has(srcName)) {
        const t = (title || '').toLowerCase();
        return EN_TECH.some(k => t.includes(k));
    }
    return true; // DPReview / Impress Watch 纯科技源直通
}

// 轻量标签（英文/日文源也给出可读主题，便于前端聚合展示）
function extractTags(text) {
    const t = (text || '').toLowerCase();
    const map = [
        ['人工智能', ['ai', 'gpt', 'chatgpt', 'gemini', 'claude', 'llm', 'machine learning', 'artificial intelligence']],
        ['手机', ['iphone', 'android', 'smartphone', 'pixel', 'galaxy', 'samsung', 'huawei', 'xiaomi', 'mobile']],
        ['芯片/半导体', ['chip', 'cpu', 'gpu', 'semiconductor', 'processor', 'nvidia', 'intel', 'amd', 'qualcomm']],
        ['相机/影像', ['camera', 'lens', 'sensor', 'mirrorless', 'dslr', 'photography', 'sony', 'nikon', 'canon']],
        ['电脑硬件', ['laptop', 'notebook', 'tablet', 'monitor', 'pc', 'mac', 'display', 'oled']],
        ['新能源/电动车', ['ev', 'electric vehicle', 'tesla', 'battery', 'self-driving', 'autonomous']],
        ['游戏', ['game', 'gaming', 'console', 'xbox', 'playstation', 'switch']],
        ['软件应用', ['software', 'app', 'windows', 'macos', 'ios', 'linux', 'browser', 'chrome']],
        ['智能硬件', ['headphone', 'earbud', 'speaker', 'wearable', 'smartwatch', 'vr', 'ar', 'drone', 'gadget']],
        ['汽车', ['car', 'automotive']],
        ['AI芯片', ['ai chip', 'npu']],
        ['数码评测', ['review', 'hands-on', 'benchmark', 'unboxing', 'preview']],
    ];
    const tags = [];
    for (const [cat, kws] of map) if (kws.some(k => t.includes(k))) tags.push(cat);
    return tags.slice(0, 3);
}

async function main() {
    const ROOT = path.resolve(__dirname, '..');
    const newsPath = path.join(ROOT, 'data', 'news.json');
    const d = JSON.parse(fs.readFileSync(newsPath, 'utf8'));
    let archive = Array.isArray(d.articles) ? d.articles : [];
    const seen = new Set(archive.map(a => (a.title || '').trim().toLowerCase()));

    let added = 0, dropped = 0;
    const perSource = {};
    for (const s of NEW_SOURCES) {
        let xml;
        try {
            xml = await fetchText(s.url);
        } catch (e) {
            console.log(`[${s.name}] 抓取失败: ${e.message}（跳过该源，不影响既有数据）`);
            continue;
        }
        const items = parseItems(xml);
        console.log(`[${s.name}] 解析到 ${items.length} 条`);
        let srcAdded = 0;
        for (const it of items) {
            const title = (it.title || '').trim();
            if (!title || !it.url) continue;
            if (seen.has(title.toLowerCase())) continue;
            if (!relevant(s.name, title)) { dropped++; continue; }
            const art = {
                source: s.name,
                sourceColor: s.color,
                title,
                description: (it.description || '').slice(0, 800),
                url: it.url,
                time: it.time || '',
                tags: extractTags(title + ' ' + (it.description || '')),
            };
            archive.unshift(art);
            seen.add(title.toLowerCase());
            added++; srcAdded++;
        }
        perSource[s.name] = srcAdded;
        console.log(`[${s.name}] 净新增 ${srcAdded} 篇`);
    }

    // 按时间重排并裁剪到上限（新增置于最新，超出则丢弃最旧）
    archive.sort((a, b) => new Date(b.time || 0).getTime() - new Date(a.time || 0).getTime());
    if (archive.length > ARCHIVE_MAX) archive = archive.slice(0, ARCHIVE_MAX);

    const output = { updateTime: new Date().toISOString(), total: archive.length, articles: archive };
    fs.writeFileSync(newsPath, JSON.stringify(output));

    const rawBytes = Buffer.byteLength(JSON.stringify(output), 'utf8');
    fs.writeFileSync(path.join(ROOT, 'data', 'news-meta.json'),
        JSON.stringify({ size: rawBytes, count: archive.length, updateTime: output.updateTime }));

    // 重新生成分块归档（与 scripts/split-archive.js 逻辑一致）
    const OUT = path.join(ROOT, 'data', 'news-chunks');
    const CHUNK = 200, DESC_MAX = 800;
    const chunks = [], sizes = [];
    for (let i = 0; i < archive.length; i += CHUNK) {
        const part = archive.slice(i, i + CHUNK).map(a => {
            const c = Object.assign({}, a);
            if (c.description && c.description.length > DESC_MAX) c.description = c.description.slice(0, DESC_MAX);
            return c;
        });
        const fn = `part-${String(chunks.length).padStart(3, '0')}.json`;
        const blob = JSON.stringify(part);
        fs.writeFileSync(path.join(OUT, fn), blob);
        chunks.push(fn);
        sizes.push(Buffer.byteLength(blob, 'utf8'));
    }
    fs.writeFileSync(path.join(OUT, 'manifest.json'),
        JSON.stringify({ chunks, sizes, total: archive.length, updateTime: output.updateTime, chunk: CHUNK }));

    console.log(`\n✅ 合并完成: 新增 ${added} 篇, 丢弃(非科技) ${dropped} 篇, 归档总数 ${archive.length}`);
    console.log('   新源计数:', NEW_SOURCES.map(s => `${s.name}=${perSource[s.name] || 0}`).join('  '));
    const bySrc = {};
    archive.forEach(a => { bySrc[a.source] = (bySrc[a.source] || 0) + 1; });
    console.log('   全源总数:', Object.keys(bySrc).length, '个数据源');
}

main().catch(e => { console.error('合并脚本异常:', e); process.exit(1); });
