#!/usr/bin/env node
// 把 data/news.json 拆成 data/news-chunks/ 小文件（每片 200 篇 ~182KB），
// 供前端做「分块续传 + 每片存 Cache Storage」——根治慢网整文件 9.4MB 下载必失败。
// 同时把 description 裁到 800 字，整体体积从 ~6.8MB 降到 ~4.8MB，块更小更稳。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'data', 'news.json');
const OUT = path.join(ROOT, 'data', 'news-chunks');
const CHUNK = 200;
const DESC_MAX = 800;

function main() {
  if (!fs.existsSync(SRC)) { console.error('[split] 找不到', SRC); process.exit(0); }
  const d = JSON.parse(fs.readFileSync(SRC, 'utf-8'));
  const arts = d.articles || [];
  const total = arts.length;
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  const chunks = [];
  const sizes = [];
  for (let i = 0; i < total; i += CHUNK) {
    const part = arts.slice(i, i + CHUNK).map(a => {
      const c = { ...a };
      if (c.description && c.description.length > DESC_MAX) c.description = c.description.slice(0, DESC_MAX);
      return c;
    });
    const fn = `part-${String(chunks.length).padStart(3, '0')}.json`;
    const blob = JSON.stringify(part);
    fs.writeFileSync(path.join(OUT, fn), blob);
    chunks.push(fn);
    sizes.push(Buffer.byteLength(blob, 'utf-8'));
  }
  const manifest = { chunks, sizes, total, updateTime: d.updateTime || '', chunk: CHUNK };
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest));
  const mb = (sizes.reduce((a, b) => a + b, 0) / 1048576).toFixed(2);
  console.log(`[split] 完成：${chunks.length} 块 × ${CHUNK} 篇，单片 ${Math.max(...sizes) / 1024}KB，总 ${mb}MB（原 ${ (Buffer.byteLength(JSON.stringify(d)) / 1048576).toFixed(2) }MB）`);
}
main();
