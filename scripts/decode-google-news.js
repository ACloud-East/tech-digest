/**
 * decode-google-news.js
 * 服务端解码 Google News 文章链接（新版需要调用 Google 的 batchexecute 端点）。
 * 复刻 googlenewsdecoder(new_decoderv3) 的逻辑，纯 Node 原生 https 实现，无需额外依赖。
 *
 * 用法：
 *   const { decodeGoogleNews, extractId } = require('./decode-google-news');
 *   const realUrl = await decodeGoogleNews('https://news.google.com/articles/CBMi...?oc=5');
 *   // -> 'https://original-source.com/article/123' 或 null(失败)
 */
const https = require('https');
const http = require('http');
const { URL } = require('url');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

function getText(targetUrl, options = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: options.headers || { 'User-Agent': UA },
      timeout: 20000,
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const next = new URL(res.headers.location, targetUrl).toString();
        res.resume();
        return resolve(getText(next, options));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    if (options.body) req.write(options.body);
    req.end();
  });
}

function extractId(gnUrl) {
  const m = (gnUrl || '').match(/news\.google\.com\/(?:rss\/)?articles\/([^?]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 解码端点(GOOGLE)对高频请求返回 429。为缓解限流：(1) 相邻解码之间强制最小间隔；
// (2) 遇到 429/网络抖动时指数退避重试，避免一次性丢弃整源文章。
const MIN_GAP_MS = 250;
let lastDecodeAt = 0;

// 带重试的 GET：网络错误时退避重试（最多 maxRetry 次）；但遇 429 限流立即返回，
// 不反复重试（避免单次抓取因大量 429 而长时间挂起超时）。429 在 Actions 独立 IP 上很少出现。
async function getTextRetry(targetUrl, options = {}, maxRetry = 2) {
  let wait = 500;
  for (let attempt = 1; attempt <= maxRetry; attempt++) {
    try {
      const r = await getText(targetUrl, options);
      if (typeof r === 'object' && r.status === 429) return r; // 限流：立即返回，不重试
      return r;
    } catch (e) {
      if (attempt < maxRetry) { await sleep(wait); wait *= 2; continue; }
      throw e;
    }
  }
  return null;
}

async function decodeGoogleNews(gnUrl) {
  const id = extractId(gnUrl);
  if (!id) return null;
  try {
    // 限流保护：相邻解码之间至少间隔 MIN_GAP_MS
    const gap = MIN_GAP_MS - (Date.now() - lastDecodeAt);
    if (gap > 0) await sleep(gap);
    lastDecodeAt = Date.now();

    // 1) GET articles 页，提取 data-n-a-sg / data-n-a-ts（429 时退避重试）
    const htmlRes = await getTextRetry(`https://news.google.com/articles/${id}`);
    const html = (typeof htmlRes === 'object' && htmlRes.body != null) ? htmlRes.body : (htmlRes || '');
    const sg = (html.match(/data-n-a-sg="([^"]+)"/) || [])[1];
    const ts = (html.match(/data-n-a-ts="([^"]+)"/) || [])[1];
    if (!sg || !ts) return null;

    // 2) POST batchexecute 解码（同样带 429 重试）
    const payload = ['Fbv4je', JSON.stringify(['garturlreq', [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1], 'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], id, ts, sg])];
    const body = 'f.req=' + encodeURIComponent(JSON.stringify([[payload]]));
    const respRes = await getTextRetry('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'User-Agent': UA,
      },
      body,
    });
    const resp = (typeof respRes === 'object' && respRes.body != null) ? respRes.body : (respRes || '');

    const parts = resp.split('\n\n');
    if (parts.length < 2) return null;

    // 解析：json.loads(parts[1])[:-2][0][2] -> json.loads -> [1]
    let decoded = null;
    try {
      const parsed = JSON.parse(parts[1]).slice(0, -2);
      decoded = JSON.parse(parsed[0][2])[1];
    } catch (_) {
      // 兜底：不切片再试
      try {
        const parsed = JSON.parse(parts[1]);
        const arr = Array.isArray(parsed) ? parsed : (parsed[0] || []);
        if (arr[0] && arr[0][2]) decoded = JSON.parse(arr[0][2])[1];
      } catch (_) { /* ignore */ }
    }
    return decoded || null;
  } catch (e) {
    return null;
  }
}

module.exports = { decodeGoogleNews, extractId };
