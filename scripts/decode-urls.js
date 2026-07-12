/**
 * decode-urls.js
 * 对现有 data/news.json 中所有 news.google.com 跳转链接做一次性解码，
 * 替换为真实原文 URL（彻底解决主题源/死源文章点开白屏的问题）。
 * 解码结果写入 data/decode-cache.json 以便 fetch-news.js 后续命中缓存、避免重复解码。
 *
 * 用法：node scripts/decode-urls.js
 */
const fs = require('fs');
const path = require('path');
const { decodeGoogleNews, extractId } = require('./decode-google-news');

const DATA_DIR = path.join(__dirname, '..', 'data');
const NEWS = path.join(DATA_DIR, 'news.json');
const CACHE = path.join(DATA_DIR, 'decode-cache.json');

let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch (_) { /* 无缓存 */ }

const data = JSON.parse(fs.readFileSync(NEWS, 'utf8'));
const arts = data.articles || [];

const targets = arts.filter((a) => (a.url || '').includes('news.google.com/articles/'));
console.log('待解码链接数:', targets.length, '| 已有缓存:', Object.keys(cache).length);

const CONC = 6;
let idx = 0;
let done = 0, ok = 0, fail = 0;

async function worker() {
  while (idx < targets.length) {
    const a = targets[idx++];
    const id = extractId(a.url);
    if (id && cache[id]) {
      a.url = cache[id];
      ok++; done++;
      continue;
    }
    const real = await decodeGoogleNews(a.url);
    if (real) {
      a.url = real;
      if (id) cache[id] = real;
      ok++;
    } else {
      fail++;
    }
    done++;
    if (done % 25 === 0) console.log(`进度 ${done}/${targets.length} 成功${ok} 失败${fail}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

(async () => {
  const t0 = Date.now();
  await Promise.all(Array.from({ length: CONC }, worker));
  fs.writeFileSync(NEWS, JSON.stringify(data));
  fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2));
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`完成(用时${sec}s): 成功${ok} 失败${fail} 缓存条目${Object.keys(cache).length}`);
  // 校验白屏链接
  const remain = arts.filter((a) => (a.url || '').includes('news.google.com/articles/')).length;
  console.log('剩余 news.google.com 链接:', remain);
})();
