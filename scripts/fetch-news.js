/**
 * fetch-news.js
 * 抓取各科技媒体RSS，生成静态数据文件 data/news.json
 * 供前端直接读取（绕过浏览器CORS限制）
 */
const Parser = require('rss-parser');
const fs = require('fs');
const path = require('path');

const parser = new Parser({
    timeout: 10000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
    },
    requestOptions: { rejectUnauthorized: false }
});

// 数据源配置：名称 + 主RSS地址 + 备用RSSHub地址 + 颜色
const sources = [
    { name: 'IT之家', rss: 'https://www.ithome.com/rss/', rsshub: 'https://rsshub.app/ithome/rss', color: '#e13b3f' },
    { name: '36氪', rss: 'https://36kr.com/feed', rsshub: 'https://rsshub.app/36kr/hot-list', color: '#0066ff' },
    { name: '少数派', rss: 'https://sspai.com/feed', rsshub: null, color: '#d93b3b' },
    { name: '爱范儿', rss: 'https://www.ifanr.com/feed', rsshub: 'https://rsshub.app/ifanr', color: '#d4233a' },
    { name: '虎嗅', rss: 'https://www.huxiu.com/rss/0.xml', rsshub: 'https://rsshub.app/huxiu/article', color: '#374151' },
    { name: '雷锋网', rss: 'https://www.leiphone.com/rss', rsshub: 'https://rsshub.app/leiphone/latest', color: '#1890ff' },
    { name: '网易科技', rss: 'https://www.163.com/dy/media/T1348631808562.rss', rsshub: 'https://rsshub.app/163/dy/T1348631808562', color: '#e60012' },
    { name: '快科技', rss: 'https://rss.mydrivers.com/', rsshub: 'https://rsshub.app/mydrivers/new', color: '#ff6600' },
    { name: 'DoNews', rss: 'https://www.donews.com/rss', rsshub: 'https://rsshub.app/donews', color: '#00a971' },
    { name: '极客公园', rss: 'https://www.geekpark.net/rss', rsshub: 'https://rsshub.app/geekpark/breakingnews', color: '#00c4ff' },
    { name: '品玩', rss: 'https://www.pingwest.com/feed', rsshub: 'https://rsshub.app/pingwest/status', color: '#ff5722' },
    { name: 'cnBeta', rss: 'https://www.cnbeta.com/backend.php', rsshub: 'https://rsshub.app/cnbeta', color: '#009a61' },
    { name: '知客', rss: 'https://www.zaeke.com/feed', rsshub: null, color: '#9c27b0' },
    { name: 'Odaily', rss: 'https://www.odaily.news/feed', rsshub: null, color: '#ffb300' },
    { name: '华尔街见闻', rss: 'https://wallstreetcn.com/rss/tech', rsshub: 'https://rsshub.app/wallstreetcn/news/global', color: '#d32f2f' },
    { name: '机器之心', rss: 'https://www.jiqizhixin.com/rss', rsshub: 'https://rsshub.app/jiqizhixin', color: '#512da8' },
    { name: '量子位', rss: 'https://www.qbitai.com/feed', rsshub: null, color: '#00796b' },
    { name: 'InfoQ', rss: 'https://www.infoq.cn/feed', rsshub: null, color: '#0277bd' },
    { name: '开源中国', rss: 'https://www.oschina.net/news/rss', rsshub: null, color: '#43a047' },
    { name: 'Solidot', rss: 'https://www.solidot.org/index.rss', rsshub: null, color: '#546e7a' },
    { name: '新华网科技', rss: 'https://www.xinhuanet.com/tech/xhxtech.xml', rsshub: null, color: '#003d8c' },
    { name: '钛媒体', rss: 'https://www.tmtpost.com/rss.xml', rsshub: null, color: '#ff9800' },
    { name: '科技猎', rss: 'https://www.kejilie.com/feed', rsshub: null, color: '#795548' },
    { name: '澎湃科技', rss: 'https://www.thepaper.cn/rss_24.xml', rsshub: 'https://rsshub.app/thepaper/featured', color: '#1e88e5' },
    // 新增更多源
    { name: '知乎热榜', rss: null, rsshub: 'https://rsshub.app/zhihu/hot', color: '#0084ff' },
    { name: 'V2EX', rss: null, rsshub: 'https://rsshub.app/v2ex/topics/latest', color: '#e8a719' },
    { name: '掘金前端', rss: null, rsshub: 'https://rsshub.app/juejin/category/frontend', color: '#1e80ff' },
    { name: 'TechCrunch中国', rss: null, rsshub: 'https://rsshub.app/techcrunch/latest', color: '#0f9d58' },
    { name: 'Wired', rss: 'https://www.wired.com/feed/rss', rsshub: null, color: '#000000' },
    { name: 'TheVerge', rss: 'https://www.theverge.com/rss/index.xml', rsshub: null, color: '#e2127a' },
    { name: 'ArsTechnica', rss: 'http://feeds.arstechnica.com/arstechnica/index', rsshub: null, color: '#ff4e00' },
    { name: 'Engadget中文', rss: null, rsshub: 'https://rsshub.app/engadget/cn', color: '#2b2d32' },
    { name: '9to5Mac', rss: 'https://9to5mac.com/feed/', rsshub: null, color: '#0a84ff' },
    { name: 'MacRumors', rss: 'https://www.macrumors.com/macrumors.xml', rsshub: null, color: '#1d4ed8' },
    { name: 'AndroidPolice', rss: 'https://www.androidpolice.com/feed/', rsshub: null, color: '#3ddc84' },
    { name: 'Gizmodo', rss: 'https://gizmodo.com/rss', rsshub: null, color: '#ff6b6b' },
    { name: '数字尾巴', rss: 'https://www.dgtle.com/rss', rsshub: null, color: '#ff7a00' },
    { name: 'ZEALER', rss: 'https://www.zealer.com/rss', rsshub: null, color: '#ff0050' },
    { name: '超能网', rss: 'https://www.expreview.com/rss.php', rsshub: null, color: '#00a0e9' },
    { name: '什么值得买', rss: 'https://www.smzdm.com/feed', rsshub: 'https://rsshub.app/smzdm/ranking/pinlei/11/3', color: '#ff6b00' },
    { name: '中关村在线', rss: 'http://desk.zol.com.cn/rss.xml', rsshub: 'https://rsshub.app/zol/diy', color: '#315efb' },
];

// 科技领域关键词
const techKeywords = [
    '人工智能','AI','大模型','GPT','ChatGPT','深度学习','机器学习','神经网络','LLM','AIGC','AGI',
    'OpenAI','Claude','Gemini','Copilot','Sora','DeepSeek','通义千问','文心一言','混元','豆包','kimi',
    '手机','iPhone','华为','小米','OPPO','vivo','三星','荣耀','折叠屏','旗舰','智能手机','苹果','Apple',
    'Mate','骁龙','天玑','iOS','Android','鸿蒙','HarmonyOS','Pixel','Galaxy',
    '芯片','半导体','CPU','GPU','NPU','高通','联发科','英特尔','AMD','英伟达','NVIDIA','台积电','光刻',
    '晶圆','3nm','5nm','ASML','ARM','RISC-V','海思','麒麟','昇腾','HBM','中芯国际',
    '新能源','电动车','特斯拉','比亚迪','蔚来','小鹏','理想','电池','充电','自动驾驶','FSD','固态电池',
    '宁德时代','小米汽车','SU7','Cybertruck','换电','800V','碳化硅',
    '评测','开箱','体验','测评','上手','对比','横评','深度','首发',
    '游戏','Steam','PS5','Xbox','Switch','电竞','3A','原神','黑神话','王者荣耀','DLSS','光追','虚幻引擎','云游戏',
    '电脑','笔记本','显卡','内存','SSD','主板','显示器','MacBook','ThinkPad','iPad','平板','机械键盘','鼠标','OLED','miniLED','DDR5',
    '软件','App','应用','操作系统','Windows','macOS','浏览器','Chrome','WPS','开源','GitHub','Docker','Linux',
    '互联网','社交','电商','直播','短视频','字节跳动','腾讯','阿里','百度','美团','拼多多','京东','快手','小红书','B站','知乎','微信','抖音','TikTok',
    '融资','IPO','上市','估值','投资','创投','VC','PE','创业','独角兽','红杉','高瓴','科创板','纳斯达克',
    '智能硬件','IoT','可穿戴','智能家居','AR','VR','XR','Vision Pro','Quest','机器人','无人机','3D打印','智能手表','Apple Watch','AirPods','扫地机器人',
    '区块链','Web3','比特币','以太坊','NFT','DeFi','加密','数字货币','DAO','智能合约','Solana','数字人民币','元宇宙',
    'Tech','Technology','Apple','Google','Microsoft','Meta','Amazon','Tesla','Nvidia','Intel','AMD','Qualcomm','TSMC'
];

function isRelevant(text) {
    if (!text) return false;
    const t = text.toLowerCase();
    return techKeywords.some(k => t.includes(k.toLowerCase()));
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
    const tags = [];
    const lt = text.toLowerCase();
    for (const [cat, kws] of Object.entries(map)) {
        if (kws.some(k => lt.includes(k))) tags.push(cat);
    }
    return tags.slice(0, 3);
}

function stripHtml(html) {
    if (!html) return '';
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchOneSource(source) {
    const urls = [source.rss, source.rsshub].filter(Boolean);
    let lastError = null;
    for (const url of urls) {
        try {
            console.log(`[Fetch] ${source.name} <- ${url}`);
            const feed = await parser.parseURL(url);
            const items = (feed.items || []).map(item => ({
                source: source.name,
                sourceColor: source.color,
                title: item.title || '',
                description: stripHtml(item.contentSnippet || item.content || item.summary || ''),
                url: item.link || item.guid || '',
                time: item.pubDate || item.isoDate || '',
                tags: extractTags(item.title + ' ' + (item.contentSnippet || item.content || ''))
            }));
            const filtered = items.filter(i => isRelevant(i.title + ' ' + i.description));
            console.log(`[OK] ${source.name}: ${items.length} 条，科技相关 ${filtered.length} 条`);
            return filtered;
        } catch (e) {
            lastError = e;
            console.log(`[Retry] ${source.name} 主源失败，尝试备用: ${e.message}`);
        }
    }
    console.log(`[FAIL] ${source.name}: ${lastError ? lastError.message : 'no url'}`);
    return [];
}

async function main() {
    console.log('开始抓取科技资讯...\n');

    // 串行抓取，避免网络拥堵
    const allArticles = [];
    for (const source of sources) {
        const articles = await fetchOneSource(source);
        allArticles.push(...articles);
    }

    // 去重
    const seen = new Set();
    const unique = [];
    for (const a of allArticles) {
        const key = (a.title + a.url).slice(0, 120);
        if (!seen.has(key)) { seen.add(key); unique.push(a); }
    }

    // 按时间排序
    unique.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));

    const output = {
        updateTime: new Date().toISOString(),
        total: unique.length,
        articles: unique
    };

    const outPath = path.join(__dirname, '..', 'data', 'news.json');
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

    // 统计
    const bySource = {};
    unique.forEach(a => { bySource[a.source] = (bySource[a.source] || 0) + 1; });
    console.log('\n===== 统计 =====');
    console.log('总文章数:', unique.length);
    Object.entries(bySource).sort((a,b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
    console.log('数据已保存:', outPath);
}

main().catch(e => { console.error(e); process.exit(1); });
