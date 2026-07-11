/**
 * fetch-news-v3.js - 终极版
 * 标准RSS + 手动XML + Cheerio HTML解析 三位一体
 */
const Parser = require('rss-parser');
const fetch = require('node-fetch');
const { parseStringPromise } = require('xml2js');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const FETCH_TIMEOUT = 8000; // 统一超时8秒（大部分源1-3秒响应，失败快速跳过）
const parser = new Parser({ timeout: FETCH_TIMEOUT, headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml, application/xml, text/xml, */*' }, requestOptions: { rejectUnauthorized: false } });

// ========== 关键词（用于相关性过滤） ==========
// 强科技关键词：具体、指向明确，单条命中即视为科技相关
const STRONG_KEYWORDS = [
    '人工智能','AI','大模型','GPT','ChatGPT','深度学习','机器学习','神经网络','LLM','AIGC','AGI',
    'OpenAI','Claude','Gemini','Copilot','Sora','DeepSeek','通义千问','文心一言','混元','豆包','kimi',
    'Agent','智能体','Codex','Cursor','Windsurf','Devin','Token',
    '手机','iPhone','华为','小米','OPPO','vivo','三星','荣耀','折叠屏','旗舰','智能手机','苹果','Apple',
    'Mate','骁龙','天玑','iOS','Android','鸿蒙','HarmonyOS','Pixel','Galaxy',
    '芯片','半导体','CPU','GPU','NPU','高通','联发科','英特尔','AMD','英伟达','NVIDIA','台积电','光刻',
    '晶圆','3nm','5nm','ASML','ARM','RISC-V','海思','麒麟','昇腾','HBM','中芯国际',
    '新能源','电动车','特斯拉','比亚迪','蔚来','小鹏','理想','电池','充电','自动驾驶','FSD','固态电池',
    '宁德时代','小米汽车','SU7','Cybertruck','换电','800V','碳化硅',
    '游戏','Steam','PS5','Xbox','Switch','电竞','3A','原神','黑神话','王者荣耀','DLSS','光追','虚幻引擎','云游戏',
    '电脑','笔记本','显卡','内存','SSD','主板','显示器','MacBook','ThinkPad','iPad','平板','机械键盘','鼠标','OLED','miniLED','DDR5',
    '软件','App','操作系统','Windows','macOS','浏览器','Chrome','WPS','开源','GitHub','Docker','Linux',
    '字节跳动','腾讯','阿里','百度','美团','拼多多','京东','快手','小红书','B站','知乎','抖音','TikTok',
    '红杉','高瓴',
    '智能硬件','IoT','可穿戴','智能家居','AR','VR','XR','Vision Pro','Quest','机器人','无人机','3D打印','智能手表','Apple Watch','AirPods','扫地机器人',
    '区块链','Web3','比特币','以太坊','NFT','DeFi','加密','数字货币','DAO','智能合约','Solana','数字人民币','元宇宙',
    '航天','火箭','卫星','SpaceX','星舰','商业航天','太空','空间站','探月',
    'Tech','Technology','Google','Microsoft','Meta','Amazon','Tesla','Nvidia','Intel','AMD','Qualcomm','TSMC',
    'OceanBase'
];
// 弱相关关键词：泛化业务/评测词，单独出现多为非科技，需累计≥2或配合强词才相关
const SOFT_KEYWORDS = [
    '评测','开箱','体验','测评','上手','对比','横评','深度','首发',
    '营收','财报','广告','裁员','招聘','上市','融资','IPO','估值','创投','VC','PE','创业','独角兽','科创板','纳斯达克'
];
// 中性词：过于泛化，不计入相关性（避免「微信+投资」之类蒙混过关）
const NEUTRAL_KEYWORDS = new Set([
    '微信','投资','互联网','社交','电商','直播','短视频','平台','应用','数据',
    '公司','企业','用户','市场','行业','产品','服务','网络'
]);
// 标题级非科技排除词（一级：对所有源生效，高精度）
const TITLE_BLOCK_T1 = [
    '总统','选举','外交','移民','难民','游行','抗议','示威','政变',
    '领土','主权','联合国','北约','加沙','哈马斯',
    '疫情','新冠','确诊','疫苗','医院','门诊','医保','养生','癌症','肿瘤',
    '高考','考研','中考','录取','分数线','大学排名','教材',
    '世界杯','奥运','亚运','欧冠','NBA','CBA','足球','篮球','排球','网球','演唱会','票房','电影','综艺','明星','电视剧','小说',
    '台风','暴雨','洪水','地震','干旱','高温','寒潮','灾情','救援',
    '美食','餐厅','菜谱','旅游','景区','游客','民宿',
    '反腐','贪腐','受贿','判刑','逮捕','通缉','诈骗','命案','坠楼'
];
// 标题级非科技排除词（二级：仅对混合源生效，避免误删纯科技源中提及市场的真科技文）
const TITLE_BLOCK_T2 = [
    '议会','国会','股市','A股','美股','港股','散户','涨停','跌停','大盘','上证','深证','金价','原油','期货','外汇',
    '楼市','房价','房地产','限购','首付','房贷','存款','理财','保险','基金',
    '工资','失业','社保','养老','生育','婚姻','离婚','殡葬','南非'
];

// 关键词匹配：短 ASCII 关键词（如 AR/PE/AI/App/NBA）使用单词边界，避免子串误触发
// （"AR" 不能匹配 war/car，"NBA" 不能匹配 OceanBase，"AI" 不能匹配 email/rain）
function kwMatch(text, kw) {
    if (/^[A-Za-z]+$/.test(kw) && kw.length <= 4) {
        return new RegExp('\\b' + kw + '\\b', 'i').test(text);
    }
    return text.toLowerCase().includes(kw.toLowerCase());
}
function countHits(text, list) { let n = 0; for (const k of list) if (kwMatch(text, k)) n++; return n; }

// 相关性判定
//  - 标题命中一级（或混合源命中二级）排除词 → 直接丢弃
//  - 混合源：需命中≥1个强科技词，或≥2个弱相关词（避免「微信+投资」蒙混）
//  - 纯科技源：仅做标题排除，不过度删减（源本身即科技媒体）
function isRelevant(title, full, mixed) {
    if (!full) return false;
    const tl = title.toLowerCase();
    if (TITLE_BLOCK_T1.some(kw => kwMatch(tl, kw))) return false;
    if (mixed && TITLE_BLOCK_T2.some(kw => kwMatch(tl, kw))) return false;
    if (!mixed) return true;
    const strong = countHits(full, STRONG_KEYWORDS);
    const soft = countHits(full, SOFT_KEYWORDS);
    if (strong >= 1) return true;
    return soft >= 2;
}
function extractTags(text) {
    if (!text) return [];
    const map = {
        '人工智能': ['人工智能','ai','大模型','gpt','chatgpt','深度学习','机器学习','llm','aigc','agi','openai','claude','gemini','copilot','sora','deepseek'],
        '手机': ['手机','iphone','华为','小米','oppo','vivo','三星','荣耀','折叠屏','旗舰','智能手机','ios','android','鸿蒙','pixel','galaxy'],
        '芯片/半导体': ['芯片','半导体','cpu','gpu','npu','高通','联发科','英特尔','amd','英伟达','nvidia','台积电','光刻','asml','arm','risc-v','海思','麒麟'],
        '新能源/电动车': ['新能源','电动车','特斯拉','比亚迪','蔚来','小鹏','理想','电池','充电','自动驾驶','fsd','固态电池','cybertruck','换电'],
        '游戏': ['游戏','steam','ps5','xbox','switch','电竞','3a','原神','黑神话','dlss','光追'],
        '电脑硬件': ['电脑','笔记本','显卡','内存','ssd','主板','显示器','macbook','thinkpad','ipad','平板','机械键盘','鼠标','oled','miniled','ddr5'],
        '软件应用': ['软件','app','应用','操作系统','windows','macos','浏览器','chrome','开源','github','docker','linux'],
        '互联网': ['互联网','社交','电商','直播','短视频','字节跳动','腾讯','阿里','百度','美团','拼多多','京东','快手','小红书','b站','知乎','抖音','tiktok'],
        '科技创投': ['融资','ipo','上市','估值','投资','创投','vc','pe','创业','独角兽','科创板','纳斯达克'],
        '智能硬件': ['智能硬件','iot','可穿戴','智能家居','ar','vr','xr','vision pro','quest','机器人','无人机','3d打印','智能手表','airpods'],
        '区块链/Web3': ['区块链','web3','比特币','以太坊','nft','defi','加密','数字货币','dao','智能合约','元宇宙']
    };
    const tags = []; const lt = text.toLowerCase();
    for (const [cat, kws] of Object.entries(map)) { if (kws.some(k => lt.includes(k))) tags.push(cat); }
    return tags.slice(0, 3);
}
function stripHtml(html) { if (!html) return ''; return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }

// 从文本/URL 中解析真实发布时间，支持多种中文站点格式；
// 解析失败返回 ''（缺日期的文章会在新鲜度过滤中被丢弃，绝不再伪造为"现在"）。
// 所有 HTML 源均为中国站点，统一按中国时间(UTC+8)解释，保证在任意时区的
// 运行环境（本地 UTC+8 / GitHub Actions UTC）下结果一致且正确。
function parseDateFromText(text) {
    if (!text) return '';
    const now = new Date();
    const y0 = now.getUTCFullYear(), mo0 = now.getUTCMonth(), d0 = now.getUTCDate();
    const cnUTC = (y, mo, d, h, m) => {
        const dt = new Date(Date.UTC(y, mo - 1, d, (h | 0) - 8, m | 0, 0, 0));
        return isNaN(dt.getTime()) ? null : dt;
    };
    let m;
    // 1) URL 中的 YYYYMMDD（如 news.cn/tech/20260710/...）
    m = text.match(/(20\d{2})(\d{2})(\d{2})/);
    if (m) { const dt = cnUTC(+m[1], +m[2], +m[3]); if (dt) return dt.toISOString(); }
    // 2) 绝对日期+时间 YYYY-MM-DD HH:MM[:SS]（中国时间，如 163 媒体页）
    m = text.match(/(20\d{2})[-/年.](\d{1,2})[-/月.](\d{1,2})\D+(\d{1,2}):(\d{2})/);
    if (m) { const dt = cnUTC(+m[1], +m[2], +m[3], +m[4], +m[5]); if (dt) return dt.toISOString(); }
    // 2b) 绝对日期 YYYY-MM-DD / YYYY/MM/DD / YYYY年MM月DD日
    m = text.match(/(20\d{2})[-/年.](\d{1,2})[-/月.](\d{1,2})/);
    if (m) { const dt = cnUTC(+m[1], +m[2], +m[3]); if (dt) return dt.toISOString(); }
    // 3) 相对：X分钟前 / X小时前（与时区无关）
    m = text.match(/(\d+)\s*分钟前/);
    if (m) return new Date(now.getTime() - (+m[1]) * 60000).toISOString();
    m = text.match(/(\d+)\s*小时前/);
    if (m) return new Date(now.getTime() - (+m[1]) * 3600000).toISOString();
    // 4) 昨天 / 前天（可带 HH:MM，按中国时间）
    const hm = text.match(/(\d{1,2}):(\d{2})/); let hh = 0, mm = 0;
    if (hm) { hh = +hm[1]; mm = +hm[2]; }
    if (/昨天/.test(text)) { const dt = new Date(now.getTime() - 86400000); dt.setUTCHours(hh - 8, mm, 0, 0); return dt.toISOString(); }
    if (/前天/.test(text)) { const dt = new Date(now.getTime() - 2 * 86400000); dt.setUTCHours(hh - 8, mm, 0, 0); return dt.toISOString(); }
    // 5) 今天 HH:MM（中国时间；解析到未来则回退一天）
    if (hm) {
        const dt = new Date(Date.UTC(y0, mo0, d0, hh - 8, mm, 0, 0));
        if (!isNaN(dt.getTime())) { if (dt.getTime() > now.getTime()) dt.setUTCDate(dt.getUTCDate() - 1); return dt.toISOString(); }
    }
    // 6) X日（本月；若大于今天则视为上月）
    m = text.match(/(\d{1,2})\s*日/);
    if (m) {
        const day = +m[1];
        const valid = new Date(Date.UTC(y0, mo0, day)); // 校验该日合法（如 32日→下月1日）
        if (valid.getUTCDate() === day) {
            const dt = new Date(Date.UTC(y0, mo0, day, -8, 0, 0, 0)); // 中国当天零点
            if (dt.getTime() > now.getTime()) dt.setUTCMonth(dt.getUTCMonth() - 1);
            return dt.toISOString();
        }
    }
    // 注：不再支持孤立的 "MM-DD" 解析——"Win11/10""Redmi 12/13" 等版本号会被
    // 误判为日期（如 11/10 → 11月10日），且多为未来日期，反而会触发下面的未来钳制
    // 把旧文伪装成"刚发布"。取不到可靠日期的文章将在新鲜度过滤中被丢弃。
    return '';
}

function makeArticle(source, item) {
    return {
        source: source.name, sourceColor: source.color,
        title: (item.title || '').trim(),
        description: stripHtml(item.description || ''),
        url: item.url || '',
        // 缺日期时绝不回填"当前时间"：旧文会伪装成刚发布并骗过新鲜度过滤。
        // HTML 抓取源必须在 extract 中调用 parseDateFromText 提取真实时间。
        time: item.time || '',
        tags: extractTags(item.title + ' ' + (item.description || ''))
    };
}

// ========== 1. 标准RSS ==========
const standardSources = [
    { name: 'IT之家', url: 'https://www.ithome.com/rss/', color: '#e13b3f' },
    { name: '36氪', url: 'https://36kr.com/feed', color: '#0066ff' },
    { name: '少数派', url: 'https://sspai.com/feed', color: '#d93b3b' },
    { name: '爱范儿', url: 'https://www.ifanr.com/feed', color: '#d4233a' },
    { name: '量子位', url: 'https://www.qbitai.com/feed', color: '#00796b' },
    { name: 'InfoQ', url: 'https://www.infoq.cn/feed', color: '#0277bd' },
    { name: '开源中国', url: 'https://www.oschina.net/news/rss', color: '#43a047' },
    { name: 'Solidot', url: 'https://www.solidot.org/index.rss', color: '#546e7a' },
    { name: '钛媒体', url: 'https://www.tmtpost.com/rss.xml', color: '#ff9800' },
    { name: 'Wired', url: 'https://www.wired.com/feed/rss', color: '#000000' },
    { name: 'ArsTechnica', url: 'http://feeds.arstechnica.com/arstechnica/index', color: '#ff4e00' },
    { name: '9to5Mac', url: 'https://9to5mac.com/feed/', color: '#0a84ff' },
    { name: 'MacRumors', url: 'https://www.macrumors.com/macrumors.xml', color: '#1d4ed8' },
    { name: '超能网', url: 'https://www.expreview.com/rss.php', color: '#00a0e9' },
    { name: '爱搞机', url: 'https://www.igao7.com/feed', color: '#ff6a00' },
    // 以下源HTML抓取不稳定/反爬，保留RSSHub兜底：
    // （RSSHub超时8秒，成功则快于HTML，失败不影响并发总耗时）
    { name: '虎嗅', url: 'https://rsshub.rssforever.com/huxiu/article', color: '#374151' },
    { name: '华尔街见闻', url: 'https://rsshub.rssforever.com/wallstreetcn/news/global', color: '#d32f2f' },
    { name: 'cnBeta', url: 'https://rsshub.rssforever.com/cnbeta', url2: 'https://rsshub.app/cnbeta', color: '#009a61' },
    // 品玩：RSSHub 链接是真实 pingwest.com URL（非 Google News 重定向），可正常点击
    { name: '品玩', url: 'https://rsshub.rssforever.com/pingwest/status', color: '#ff5722' },
    // 极客公园：RSSHub 链接是真实 geekpark.net URL（非 Google News 重定向），可正常点击
    { name: '极客公园', url: 'https://rsshub.rssforever.com/geekpark/breakingnews', color: '#00c4ff' },
    // 国际科技媒体
    { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', color: '#e2127a' },
    { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', color: '#0f9d58' },
    { name: 'Engadget', url: 'https://www.engadget.com/rss.xml', color: '#2b2d32' },
    { name: 'ZDNet', url: 'https://www.zdnet.com/news/rss.xml', color: '#0066cc' },
    { name: 'Hacker News', url: 'https://hnrss.org/frontpage', color: '#ff6600' },
    { name: 'Lobsters', url: 'https://lobste.rs/rss', color: '#b22222' },
    { name: 'Dev.to', url: 'https://dev.to/feed', url2: 'https://rsshub.app/devto', color: '#4b3e99' },
    { name: 'GSMArena', url: 'https://www.gsmarena.com/rss-news-reviews.php3', color: '#d32f2f' },
];

async function fetchStandard(src) {
    try {
        console.log(`[RSS ] ${src.name}`);
        let feed;
        try {
            feed = await parser.parseURL(src.url);
        } catch(e1) {
            // 主URL失败，尝试备用URL
            if (src.url2) {
                console.log(`  -> 主源失败，尝试备用`);
                feed = await parser.parseURL(src.url2);
            } else throw e1;
        }
        // 空 items 重试一次（并发时 RSSHub 可能返回空壳）
        if ((!feed || !feed.items || feed.items.length === 0) && src.url2) {
            feed = await parser.parseURL(src.url2);
        }
        const items = (feed.items || []).map(item => makeArticle(src, {
            title: item.title, description: item.contentSnippet || item.content || item.summary || '',
            url: item.link || item.guid || '', time: item.isoDate || item.pubDate || ''
        }));
        const filtered = items.filter(i => isRelevant(i.title, i.title + ' ' + i.description, MIXED_SOURCES.includes(src.name)));
        console.log(`  => ${items.length}条${MIXED_SOURCES.includes(src.name) ? ', 科技' + filtered.length + '条' : '(纯科技源)'}`);
        return filtered;
    } catch(e) { console.log(`  => FAIL: ${e.message.substring(0,60)}`); return []; }
}

// ========== 2. 手动XML解析 ==========
async function fetchAndParseXML(url) {
    const resp = await fetch(url, { headers: { 'User-Agent': UA }, timeout: FETCH_TIMEOUT });
    let xml = await resp.text();
    xml = xml.replace(/&(?!(amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;))/g, '&amp;');
    xml = xml.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
    return await parseStringPromise(xml, { explicitArray: false, mergeAttrs: true });
}

function extractRSSItems(parsed) {
    let channel = parsed.rss && parsed.rss.channel;
    if (!channel) channel = parsed.feed;
    if (!channel) return [];
    let items = channel.item || channel.entry || [];
    if (!Array.isArray(items)) items = [items];
    return items.map(item => ({
        title: item.title || '',
        description: item.description || item.summary || item.content || '',
        url: item.link || '', time: item.pubDate || item.published || item.updated || item['dc:date'] || ''
    }));
}

const manualSources = [
    { name: 'Odaily', url: 'https://www.odaily.news/feed', color: '#ffb300' },
    // 澎湃新闻已由 HTML 直抓覆盖（channel_119908 + list_27234）
];

async function fetchManual(src) {
    try {
        console.log(`[XML ] ${src.name}`);
        const parsed = await fetchAndParseXML(src.url);
        const items = extractRSSItems(parsed).map(item => makeArticle(src, item));
        const filtered = items.filter(i => isRelevant(i.title, i.title + ' ' + i.description, MIXED_SOURCES.includes(src.name)));
        console.log(`  => ${items.length}条${MIXED_SOURCES.includes(src.name) ? ', 科技' + filtered.length + '条' : '(纯科技源)'}`);
        return filtered;
    } catch(e) { console.log(`  => FAIL: ${e.message.substring(0,60)}`); return []; }
}

// ========== 3. Cheerio HTML页面抓取 ==========
// 增量缓存：避免重复请求文章页提取日期
const CACHE_PATH = path.join(__dirname, '..', 'data', 'fetch-cache.json');
const CACHE_TTL = 24 * 3600 * 1000; // 24小时

function loadCache() {
    try {
        if (fs.existsSync(CACHE_PATH)) {
            const c = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
            if (Date.now() - (c.ts || 0) < CACHE_TTL) return c.articles || {};
        }
    } catch(e) { /* 静默 */ }
    return {};
}

function saveCache(map) {
    try {
        fs.writeFileSync(CACHE_PATH, JSON.stringify({ ts: Date.now(), articles: map }));
    } catch(e) { /* 静默 */ }
}

// 并发限流请求文章页，从 HTML 文本中提取首个 YYYY-MM-DD HH:MM[:SS] 作为发布时间
// 增量模式：已缓存的文章直接复用日期，仅对新文章请求
async function enrichArticleDates(items, batch = 10, delayMs = 300) {
    const cache = loadCache();
    let cached = 0, fetched = 0;
    
    // 先尝试从缓存匹配
    const toFetch = [];
    for (const it of items) {
        const key = `${it.url}`;
        if (cache[key] && cache[key].time) {
            it.time = cache[key].time;
            cached++;
        } else {
            toFetch.push(it);
        }
    }
    
    // 仅对新文章并发请求日期
    for (let i = 0; i < toFetch.length; i += batch) {
        const chunk = toFetch.slice(i, i + batch);
        await Promise.allSettled(chunk.map(async (it) => {
            try {
                const r = await fetch(it.url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN' }, timeout: FETCH_TIMEOUT });
                const h = await r.text();
                const m = h.match(/20\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2}/);
                if (m) it.time = m[0];
            } catch(e) { /* 静默 */ }
        }));
        fetched += chunk.length;
        if (i + batch < toFetch.length) await new Promise(r => setTimeout(r, delayMs));
    }
    
    // 更新缓存
    const newCache = {};
    for (const it of items) {
        if (it.time) newCache[it.url] = { time: it.time };
    }
    saveCache(newCache);
    
    const result = items.filter(it => it.time);
    if (cached > 0 || fetched > 0) {
        console.log(`    日期: 缓存${cached} + 请求${fetched} → ${result.length}篇有效`);
    }
    return result;
}

async function scrapeHTML(src) {
    try {
        console.log(`[HTML] ${src.name}`);
        const resp = await fetch(src.url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' }, timeout: FETCH_TIMEOUT });
        const html = await resp.text();
        const $ = cheerio.load(html);
        // 支持异步 extract（如需要逐个请求文章页获取日期）
        const items = src.asyncExtract ? await src.asyncExtract($, src.url) : src.extract($, src.url);
        const articles = items.map(item => makeArticle(src, item));
        const filtered = articles.filter(i => isRelevant(i.title, i.title + ' ' + i.description, MIXED_SOURCES.includes(src.name)));
        console.log(`  => ${items.length}条${MIXED_SOURCES.includes(src.name) ? ', 科技' + filtered.length + '条' : '(纯科技源)'}`);
        return filtered;
    } catch(e) { console.log(`  => FAIL: ${e.message.substring(0,60)}`); return []; }
}

const htmlSources = [
    {
        name: '快科技', url: 'https://www.mydrivers.com/', color: '#ff6600',
        extract: ($) => {
            const items = [];
            $('a').each((i, el) => {
                const $el = $(el);
                const title = $el.text().trim();
                let href = $el.attr('href') || '';
                if (title.length > 15 && title.length < 120 && href && !title.match(/^(首页|登录|注册|更多|下一页|上一页|搜索)$/)) {
                    if (href.startsWith('/')) href = 'https://www.mydrivers.com' + href;
                    if (!href.startsWith('http')) return;
                    // 时间在同 <li> 内的 <span class="t">（如 16:58 / 8日）
                    const li = $el.closest('li');
                    const ctx = li.length ? li.text() : ($el.text() + ' ' + $el.parent().text());
                    items.push({ title, url: href, time: parseDateFromText(ctx) });
                }
            });
            return items.slice(0, 60);
        }
    },
    {
        name: '雷锋网', url: 'https://www.leiphone.com/', color: '#1890ff',
        extract: ($) => {
            const items = [];
            $('a').each((i, el) => {
                const $el = $(el);
                const title = $el.text().trim();
                let href = $el.attr('href') || '';
                if (title.length > 15 && title.length < 120 && href.includes('leiphone.com') && !title.match(/^(首页|登录|注册|更多|下一页)$/)) {
                    if (href.startsWith('/')) href = 'https://www.leiphone.com' + href;
                    // 时间在同级 <div class="time">（如 13分钟前 / 昨天 21:03）
                    const card = $el.closest('div, li, article');
                    const tm = card.find('.time').first().text().trim();
                    const ctx = (tm || (card.length ? card.text() : $el.text())) + ' ' + href;
                    items.push({ title, url: href, time: parseDateFromText(ctx) });
                }
            });
            return items.slice(0, 60);
        }
    },
    {
        name: 'DoNews', url: 'https://www.donews.com/', color: '#00a971',
        extract: ($) => {
            const items = [];
            $('a').each((i, el) => {
                const $el = $(el);
                const title = $el.text().trim();
                let href = $el.attr('href') || '';
                if (title.length > 15 && title.length < 120 && (href.startsWith('/article/') || href.includes('donews.com'))) {
                    if (href.startsWith('/')) href = 'https://www.donews.com' + href;
                    // 日期在配图 src 中（如 .../2026/07/09/...）
                    const ctx = $el.html() + ' ' + href + ' ' + $el.text();
                    items.push({ title, url: href, time: parseDateFromText(ctx) });
                }
            });
            return items.slice(0, 50);
        }
    },
    {
        name: '新华网科技', url: 'http://www.news.cn/tech/', color: '#003d8c',
        extract: ($) => {
            const items = [];
            $('a').each((i, el) => {
                const $el = $(el);
                const title = $el.text().trim();
                let href = $el.attr('href') || '';
                if (title.length > 15 && title.length < 120 && (href.startsWith('/tech/') || href.includes('news.cn/tech'))) {
                    if (href.startsWith('/')) href = 'http://www.news.cn' + href;
                    // 日期在 URL 路径中（如 /tech/20260710/...）
                    const ctx = href + ' ' + $el.text() + ' ' + $el.parent().text();
                    items.push({ title, url: href, time: parseDateFromText(ctx) });
                }
            });
            return items.slice(0, 50);
        }
    },
    {
        name: '虎嗅', url: 'https://www.huxiu.com/', color: '#374151',
        extract: ($) => {
            const items = [];
            $('a').each((i, el) => {
                const $el = $(el);
                const title = $el.text().trim();
                let href = $el.attr('href') || '';
                if (title.length > 15 && title.length < 120 && href.includes('huxiu.com/article')) {
                    if (href.startsWith('/')) href = 'https://www.huxiu.com' + href;
                    const card = $el.closest('li, div, article');
                    const ctx = (card.length ? card.text() : $el.text()) + ' ' + $el.html() + ' ' + href;
                    items.push({ title, url: href, time: parseDateFromText(ctx) });
                }
            });
            return items.slice(0, 50);
        }
    },
    {
        name: '华尔街见闻', url: 'https://wallstreetcn.com/news/tech', color: '#d32f2f',
        extract: ($) => {
            const items = [];
            $('a').each((i, el) => {
                const $el = $(el);
                const title = $el.text().trim();
                let href = $el.attr('href') || '';
                if (title.length > 15 && title.length < 120 && (href.includes('wallstreetcn.com/articles') || href.startsWith('/articles/'))) {
                    if (href.startsWith('/')) href = 'https://wallstreetcn.com' + href;
                    const card = $el.closest('li, div, article');
                    const ctx = (card.length ? card.text() : $el.text()) + ' ' + $el.html() + ' ' + href;
                    items.push({ title, url: href, time: parseDateFromText(ctx) });
                }
            });
            return items.slice(0, 30);
        }
    },
    {
        name: '品玩', url: 'https://www.pingwest.com/', color: '#ff5722',
        extract: ($) => {
            const items = [];
            $('a').each((i, el) => {
                const $el = $(el);
                const title = $el.text().trim();
                let href = $el.attr('href') || '';
                if (title.length > 15 && title.length < 120 && href.includes('pingwest.com')) {
                    if (href.startsWith('/')) href = 'https://www.pingwest.com' + href;
                    const card = $el.closest('li, div, article');
                    const ctx = (card.length ? card.text() : $el.text()) + ' ' + $el.html() + ' ' + href;
                    items.push({ title, url: href, time: parseDateFromText(ctx) });
                }
            });
            return items.slice(0, 50);
        }
    },
    {
        // 机器之心官网(jiqizhixin.com)已启用反爬，首页/文章页均返回挑战页，无法直爬。
        // 改用其官方网易号「机器之心Pro」媒体页：可直连、含当天最新文章、链接为真实可点文章页。
        name: '机器之心', url: 'https://www.163.com/dy/media/T1473761139764.html', color: '#512da8',
        extract: ($) => {
            const items = [];
            $('a').each((i, el) => {
                const $el = $(el);
                const title = $el.text().trim().replace(/\s+/g, ' ');
                let href = $el.attr('href') || '';
                if (title.length > 15 && title.length < 120 && /163\.com\/dy\/article\//.test(href)) {
                    if (href.startsWith('/')) href = 'https://www.163.com' + href;
                    href = href.split('?')[0]; // 去掉 ?spss= 跟踪参数
                    const card = $el.closest('li, div, article');
                    const ctx = (card.length ? card.text() : $el.text()) + ' ' + href;
                    items.push({ title, url: href, time: parseDateFromText(ctx) });
                }
            });
            return items.slice(0, 60);
        }
    },
    {
        // 网易科技：tech.163.com 科技频道首页为服务端渲染，直链 100% 科技内容（非综合门户）。
        // 日期通过并发请求每篇文章页提取（HTML 中首个 YYYY-MM-DD HH:MM:SS 即发布时间）。
        name: '网易科技', url: 'https://tech.163.com/', color: '#e60012',
        asyncExtract: async ($) => {
            const items = [];
            $('a').each((i, el) => {
                const $el = $(el);
                const title = $el.text().trim().replace(/\s+/g, ' ');
                let href = ($el.attr('href') || '').split('?')[0];
                if (title.length > 10 && title.length < 80 && /\/article\//.test(href) &&
                    !title.includes('查看更多') && !title.includes('下一页') && !title.includes('标签')) {
                    // 清理标题尾部的时间戳（如 "标题 09:26"）
                    const cleanTitle = title.replace(/\s+\d{2}:\d{2}$/, '');
                    if (!items.find(a => a.url === href)) items.push({ title: cleanTitle, url: href, time: '' });
                }
            });
            // 并发限流请求文章页提取日期（增量缓存自动跳过已请求过的文章）
            return (await enrichArticleDates(items)).slice(0, 60);
        }
    },
    {
        // 澎湃新闻：原 RSSHub /thepaper/featured 精选以时政/社会/体育为主，科技含量低。
        // 改为直接抓取科技频道(channel_119908) + 科学湃(list_27234) 两个纯科技栏目。
        name: '澎湃新闻', url: 'https://www.thepaper.cn/channel_119908', color: '#1e88e5',
        asyncExtract: async ($) => {
            const items = [];
            const addFromDoc = ($doc) => {
                $doc('a').each((i, el) => {
                    const $el = $doc(el);
                    let href = $el.attr('href') || '';
                    const title = $el.text().trim().replace(/\s+/g, ' ');
                    if (!href || title.length < 12 || title.length > 90) return;
                    if (!/newsDetail_forward_\d+/.test(href)) return;
                    if (href.startsWith('/')) href = 'https://www.thepaper.cn' + href;
                    if (!items.find(a => a.url === href)) items.push({ title, url: href, time: '' });
                });
            };
            addFromDoc($);
            // 合并科学湃栏目
            try {
                const res2 = await fetch('https://www.thepaper.cn/list_27234', { headers: { 'User-Agent': UA, 'Accept': 'text/html' }, timeout: FETCH_TIMEOUT });
                const html2 = await res2.text();
                addFromDoc(cheerio.load(html2));
            } catch(e) { /* 静默 */ }
            return (await enrichArticleDates(items)).slice(0, 60);
        }
    },
];

// ========== 4. Google News RSS（反爬/无RSS源的可靠兜底） ==========
// 部分源官网反爬严重(如 pingwest)、RSSHub 公共实例频繁 503，直接用 Google News
// 站点检索获取近 3 天真实文章（标题/时间准确，链接为 news.google.com 重定向，
// 点击后在浏览器中解析到原文，不会跳到站点首页）。
const googleNewsSources = [
    // 品玩/极客公园的 Google News 链接会白屏（<about:blank>），已全部改用直连源
    // 保留此数组为空，避免提供无效链接
];

async function fetchGoogleNews(src, existingTitles) {
    try {
        console.log(`[GNews] ${src.name}`);
        const q = encodeURIComponent('site:' + src.site);
        const url = `https://news.google.com/rss/search?q=${q}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
        const feed = await parser.parseURL(url);
        const now = Date.now();
        const items = [];
        for (const it of (feed.items || [])) {
            const t = new Date(it.isoDate || it.pubDate || 0).getTime();
            if (isNaN(t) || (now - t) > 3 * 86400000) continue; // 仅保留近 3 天
            // 去掉 Google News 追加的 " - 站点名" 后缀
            const title = (it.title || '').replace(/\s*-\s*(机器之心|品玩|网易|网易科技|163|极客公园|GeekPark)\s*$/, '').trim();
            if (!title || title === src.name) continue; // 跳过频道/栏目入口
            // 直连源(RSSHub等)已收录的同名文章优先，避免同一篇既显示直链又显示 Google 重定向链
            if (existingTitles.has(title)) continue;
            items.push(makeArticle(src, { title, url: it.link || '', time: it.isoDate || it.pubDate || '' }));
            existingTitles.add(title);
        }
        console.log(`  => ${items.length}条(近3天, 已去重)`);
        return items;
    } catch(e) { console.log(`  => FAIL: ${e.message.substring(0,60)}`); return []; }
}

// ========== 混合源：需经相关性过滤（其余为纯科技源，仅做标题级排除） ==========
const MIXED_SOURCES = ['华尔街见闻', '虎嗅', '品玩', '极客公园'];

// ========== 主流程 ==========
async function main() {
    console.log('=== TechDigest 新闻抓取 v4 (全并发) ===\n');
    const startTime = Date.now();
    let allArticles = [];

    // 全并发：所有源同时抓取，不再逐个等待
    const allTasks = [
        ...standardSources.map(s => ({ type: 'RSS', fn: () => fetchStandard(s) })),
        ...manualSources.map(s => ({ type: 'XML', fn: () => fetchManual(s) })),
        ...htmlSources.map(s => ({ type: 'HTML', fn: () => scrapeHTML(s) })),
        ...googleNewsSources.map(s => ({ type: 'GNews', fn: () => fetchGoogleNews(s, new Set()) })),
    ];
    console.log(`🚀 并发启动 ${allTasks.length} 个抓取任务...\n`);

    const results = await Promise.allSettled(allTasks.map(t => t.fn()));
    let successCount = 0, failCount = 0;
    results.forEach((r, i) => {
        if (r.status === 'fulfilled' && Array.isArray(r.value)) {
            allArticles.push(...r.value);
            successCount++;
        } else {
            failCount++;
            const err = r.status === 'rejected' ? r.reason?.message : 'empty';
            if (err) console.log(`  ⚠️ ${allTasks[i].type} #${i+1} 失败: ${err.substring(0,40)}`);
        }
    });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n📊 抓取完成: ${successCount}/${allTasks.length} 成功, ${failCount} 失败, 耗时 ${elapsed}s`);
    const existingTitles = new Set(allArticles.map(a => a.title));
    for (const src of googleNewsSources) allArticles.push(...(await fetchGoogleNews(src, existingTitles)));

    // 去重
    const seen = new Set();
    let unique = [];
    for (const a of allArticles) {
        const key = (a.title + a.url).slice(0, 120);
        if (!seen.has(key)) { seen.add(key); unique.push(a); }
    }

    unique.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));

    // 非科技硬过滤：统一用 isRelevant 复核（混合源强词要求 + 标题排除词），防御性兜底
    const beforeNonTech = unique.length;
    unique = unique.filter(a => isRelevant(a.title, a.title + ' ' + a.description, MIXED_SOURCES.includes(a.source)));
    if (unique.length < beforeNonTech) console.log(`\n🧹 非科技过滤: ${beforeNonTech} → ${unique.length} 篇`);

    // 合并种子数据（4个反爬源的手动快照）
    const seedPath = path.join(__dirname, '..', 'data', 'seed-sources.json');
    if (fs.existsSync(seedPath)) {
        try {
            const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
            const seedArts = seedData.articles || [];
            let added = 0;
            for (const sa of seedArts) {
                const key = (sa.title + (sa.url || '')).slice(0, 120);
                if (!seen.has(key)) {
                    // 同样经过相关性过滤，避免种子数据混入非科技内容
                    if (isRelevant(sa.title, sa.title + ' ' + (sa.description || ''), MIXED_SOURCES.includes(sa.source))) {
                        seen.add(key);
                        unique.push(sa);
                        added++;
                    }
                }
            }
            if (added > 0) {
                console.log(`\n🌱 合并种子数据: +${added} 篇 (品玩/机器之心/极客公园/网易科技)`);
                unique.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));
            }
        } catch(e) {
            console.log('⚠️ 种子数据读取失败:', e.message);
        }
    }

    // 新鲜度过滤：丢弃旧文，保证看板前列始终是最新内容
    // 标准窗口 3 天；澎湃新闻等更新较慢的源放宽至 7 天；爱搞机/Dev.to 等低频源放宽至 30 天
    const MAX_AGE_MS = 3 * 24 * 3600 * 1000;
    const MAX_AGE_LONG_MS = 7 * 24 * 3600 * 1000;
    const MAX_AGE_MONTH_MS = 30 * 24 * 3600 * 1000;
    const LONG_WINDOW_SOURCES = ['澎湃新闻', '极客公园'];
    const MONTH_WINDOW_SOURCES = ['爱搞机', 'Dev.to'];
    const before = unique.length;
    unique = unique.filter(a => {
        const t = new Date(a.time || 0).getTime();
        if (isNaN(t) || t <= 0) return false; // 日期缺失直接丢弃，避免旧文伪装成最新
        let maxAge = MAX_AGE_MS;
        if (MONTH_WINDOW_SOURCES.includes(a.source)) maxAge = MAX_AGE_MONTH_MS;
        else if (LONG_WINDOW_SOURCES.includes(a.source)) maxAge = MAX_AGE_LONG_MS;
        return (Date.now() - t) <= maxAge;
    });
    console.log(`\n🕒 新鲜度过滤: ${before} → ${unique.length} 篇 (标准3天/澎湃7天/爱搞机Dev.to30天)`);

    // 修正/剔除未来时间戳：部分源（如 InfoQ）会给出未来发布时间，导致文章永久置顶且显示异常；
    // 个别解析误判（如 "Win11/10" 误作 11/10）也会产生未来日期。这些一律直接丢弃，
    // 绝不回填为"现在"（否则旧文会伪装成刚发布——之前 2015 年的快科技旧文即因此被显示成"刚刚"）。
    const nowIso = Date.now();
    let futureFixed = 0;
    unique = unique.filter(a => {
        const t = new Date(a.time || 0).getTime();
        // 允许 1 分钟内的微小误差（解析/时区抖动），超出则视为误判/异常，直接丢弃
        if (!isNaN(t) && t > nowIso + 60000) { futureFixed++; return false; }
        return true;
    });
    if (futureFixed) console.log(`🛠 剔除误判/未来时间戳: ${futureFixed} 篇`);

    unique.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));

    const output = { updateTime: new Date().toISOString(), total: unique.length, articles: unique };
    const outPath = path.join(__dirname, '..', 'data', 'news.json');
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

    const bySource = {};
    unique.forEach(a => { bySource[a.source] = (bySource[a.source] || 0) + 1; });
    const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('\n===== 最终统计 =====');
    console.log('总文章数:', unique.length);
    console.log('总耗时:', totalElapsed + 's');
    Object.entries(bySource).sort((a,b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
    console.log('\n已保存:', outPath);
}

main().catch(e => { console.error(e); process.exit(1); });
