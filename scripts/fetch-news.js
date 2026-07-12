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
// 服务端解码 Google News 跳转链接（news.google.com/articles/...）为真实原文 URL，
// 避免用户网络下 Google 不可达导致点开白屏。复用 decode-cache.json 缓存，仅对新文章解码。
const { decodeGoogleNews, extractId } = require('./decode-google-news');
let decodeCache = {};
try { decodeCache = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'decode-cache.json'), 'utf8')); } catch (_) { /* 无缓存则从空开始 */ }

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
    // 汽车品牌（用户明确要求保留汽车/汽车品牌相关文章，含大众、劳斯莱斯等）
    '大众','劳斯莱斯','宝马','奔驰','奥迪','丰田','本田','福特','通用','吉利','长城','长安','奇瑞',
    '保时捷','法拉利','兰博基尼','沃尔沃','雷克萨斯','凯迪拉克','别克','雪佛兰','日产','马自达',
    '现代','起亚','捷豹','路虎','宾利','迈凯伦','斯巴鲁','三菱','广汽','蔚来','小鹏','理想','问界',
    // 车型/汽车通用词
    '燃油车','混动','增程','SUV','跑车','轿车','皮卡','车展','发动机','变速箱','底盘',
    '智能驾驶','辅助驾驶','车机','座舱','续航','充电桩','汽车品牌',
    // 用户指定主题：数码 / 电子 / 硬件 / 医疗科技 / 大语言模型
    '数码','电子','硬件','大语言模型','数码产品','消费电子','智能设备',
    '医疗科技','医疗AI','数字医疗','医疗器械','生物科技','基因','基因编辑','制药','AI制药','健康科技',
    '半导体','显示面板','传感器','物联网','5G','6G','WiFi','蓝牙','快充','氮化镓','碳化硅',
    '游戏','Steam','PS5','Xbox','Switch','电竞','3A','原神','黑神话','王者荣耀','DLSS','光追','虚幻引擎','云游戏',
    '电脑','笔记本','显卡','内存','SSD','主板','显示器','MacBook','ThinkPad','iPad','平板','机械键盘','鼠标','OLED','miniLED','DDR5',
    '软件','App','操作系统','Windows','macOS','浏览器','Chrome','WPS','开源','GitHub','Docker','Linux',
    '字节跳动','腾讯','阿里','百度','美团','拼多多','京东','快手','小红书','B站','知乎','抖音','TikTok',
    '红杉','高瓴',
    '智能硬件','IoT','可穿戴','智能家居','AR','VR','XR','Vision Pro','Quest','机器人','无人机','3D打印','智能手表','Apple Watch','AirPods','扫地机器人',
    '区块链','Web3','比特币','以太坊','NFT','DeFi','加密','数字货币','DAO','智能合约','Solana','数字人民币','元宇宙',
    '航天','火箭','卫星','SpaceX','星舰','商业航天','太空','空间站','探月',
    'Tech','Technology','Google','Microsoft','Meta','Amazon','Tesla','Nvidia','Intel','AMD','Qualcomm','TSMC',
    'OceanBase',
    // ===== 用户指定「尽量保留」的主题（混合源命中即保留，避免过度过滤）=====
    // 泛科技/数码/电子/硬件
    '科技','数码','电子','硬件','消费电子','数码产品','智能设备','电子设备','工业品','智能制造','工业互联网','工业软件','工业',
    '相机','摄像机','照相机','电影机','微单','单反','运动相机','无人机相机','投影仪','显示器','电视','智能电视',
    '耳机','音箱','智能音箱','智能眼镜','智能手表','智能家电','智能家居','扫地机器人','空调','冰箱','洗衣机','智能门锁','电动牙刷',
    '路由器','充电器','移动电源','数据线','键盘','鼠标','平板','笔记本','台式机','主机','掌机','游戏本',
    '芯片','半导体','显卡','处理器','CPU','GPU','NPU','SOC','主板','内存','SSD','硬盘','电源','散热','机箱',
    '手机','智能手机','iPhone','安卓','鸿蒙','折叠屏','平板手机','老人机','功能机','卫星通信','快充','无线充',
    // AI / 大模型 / 互联网 / 创投 / 上市
    '人工智能','AI','大模型','大语言模型','LLM','AIGC','生成式AI','多模态','智能体','Agent','AI Agent',
    '互联网','科技创投','创投','上市','IPO','融资','估值','独角兽','创业','科创板','纳斯达克','中概股',
    // 汽车 / 新能源（含品牌与车型，见上方汽车小节）
    '汽车','新能源车','智能汽车','自动驾驶','智能驾驶','车联网','飞行汽车','eVTOL',
    // 医疗科技
    '医疗科技','医疗AI','数字医疗','医疗器械','生物科技','基因','基因编辑','制药','AI制药','健康科技','医疗机器人','手术机器人','可穿戴医疗',
    // ===== 用户补充「扩量」主题：网络安全 / AI芯片 / 三星与国际品牌 / 大公司与品牌 / 测评 / 新品 / 专访 / CEO =====
    // 网络安全 / 数据安全
    '网络安全','网络攻击','黑客','黑客攻击','白帽','白客','漏洞','安全漏洞','零日','零日漏洞','勒索软件','勒索病毒',
    '钓鱼','钓鱼邮件','木马','恶意软件','蠕虫','DDoS','供应链攻击','渗透','渗透测试','防火墙','入侵','后门',
    '数据安全','信息安全','隐私','隐私保护','数据泄露','数据泄漏','加密','量子加密','网络安全法','APT','靶场',
    // AI 芯片 / 算力
    'AI芯片','算力芯片','推理芯片','训练芯片','GPU芯片','芯片设计','算力','智算','智算中心','超算','AI算力','异构计算',
    // 三星 / 国际品牌
    '三星','Samsung','Galaxy','索尼','Sony','LG','松下','西门子','博世','惠普','HP','戴尔','Dell','佳能','尼康','任天堂',
    // 知名科技企业与品牌（上市大公司 / 互联网大厂）
    '腾讯','腾讯科技','阿里巴巴','阿里','阿里云','蚂蚁','支付宝','字节跳动','抖音','TikTok','百度','百度智能云',
    '美团','京东','京东科技','拼多多','网易','网易有道','快手','小米集团','小米','联想','联想集团','荣耀','大疆',
    '商汤','科大讯飞','滴滴','携程','微博','哔哩哔哩','B站','哔哩','蔚来','小鹏','理想','比亚迪','宁德时代',
    '寒武纪','地平线','用友','金山','360','搜狐','新浪','新浪科技','搜狐科技','亚马逊','谷歌','微软',
    // 新品发布 / 发布会
    '新品发布','新品','发布会','预售','曝光','官图','渲染图','预热','概念机','概念车','官博',
    // 专访 / 访谈 / 对话
    '专访','访谈','对话','口述','演讲','座谈','圆桌','对谈','自述',
    // 企业高管 / 创始人
    'CEO','董事长','创始人','总裁','高管','掌门人','联合创始人','合伙人','董事','CTO','CFO','COO','首席',
    // 上市 / 财报 / 市值（与创投相关，扩量保留）
    '财报','营收','净利','净利润','市值','股价','季报','年报','中报','分红','回购','路演'
];
// 弱相关关键词：泛化业务/评测词，单独出现多为非科技，需累计≥2或配合强词才相关
const SOFT_KEYWORDS = [
    '评测','开箱','体验','测评','上手','对比','横评','深度','首发','对比评测','深度评测','实拍','样张','首测','众测','官宣',
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
    '反腐','贪腐','受贿','判刑','逮捕','通缉','诈骗','命案','坠楼',
    // ===== 娱乐/明星/追剧/饭圈等非科技屏蔽（用户要求：明显无关科技数码的过滤） =====
    '追星','粉丝','爱豆','偶像','网红','主播','娱乐圈','演艺圈','影视圈','娱记','狗仔','路透','探班','生图','精修','饭拍','应援','饭圈','私生','反黑','控评','打投','CP','cp','粉','超话',
    '追剧','剧集','电视剧','网剧','长剧','剧评','影评','首映','路演','上映','开播','杀青','定档','综艺','真人秀','选秀','话剧','歌剧','音乐剧','相声','小品','脱口秀','纪录片',
    '恋情','分手','复合','出轨','离婚','结婚','婚礼','怀孕','生子','官宣','领证','订婚','同居','绯闻','婚恋','约会','告白','求婚','热恋','劈腿','小三','原配','前夫','前妻','太太','老公','老婆','配偶','伴侣','情侣','夫妻','夫妇','男友','女友','女友粉','老婆粉','丈夫','丈夫娘','秀恩爱',
    '颜值','穿搭','造型','妆容','美妆','发型','写真','街拍','红毯','时尚','减肥','瘦身','身材','腹肌','马甲线','整容','医美','化妆品','护肤品','香水','包包','鞋子','首饰','珠宝','美甲','新娘','婚纱','伴郎','伴娘',
    '球星','运动员','教练','裁判','决赛','半决赛','小组赛','冠军','亚军','季军','金牌','银牌','铜牌','球迷','客场','主场','转会','签约','续约','退役','复出','伤病','禁赛','奥运冠军','亚马尔','首发阵容','首发纪录','不败纪录','VS首发','首发球员',
    // 警方/命案/诈骗/打掉（社会新闻，与科技数码无关）
    '公安','警方','打掉','洗钱','命案','坠楼','诈骗案','抓获','逮捕',
    // 影视/综艺/选秀/演唱会（漫威/漫展/BW用户要求保留，不拦截）
    '剧场版','番剧','动画电影','新片','剧集','首播','首映','路演','上映','开播','杀青','定档','综艺','真人秀','选秀','相声','小品','脱口秀','纪录片','演唱会','歌友会','签售会','握手会',
    // 美容仪/光学美肤/Ulike等
    '光学美肤','美肤仪','脱毛仪','洁面仪','美容仪','Ulike',
    // 美容/护肤/美妆/护肤评测（与科技数码无关）
    '美白','面霜','护肤','敏感肌','敏感肌实测','肌肤','精华液','乳液','肌底液','眼霜','洗面奶',
    // 开嗓/秀恩爱 / 追星应援
    '开嗓','开嗓门','秀恩爱'
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
// 标题中只要出现以下任何明星/娱乐/网红/主播/官宣/配偶/求婚等强娱乐信号 → 立即丢
// （用户明确：破明星、臭官宣、臭女友、臭求婚一律屏蔽；不依赖关键词组合）
const CELEB_TERMS = [
    '周星驰','王俊凯','王源','易烊千玺','马秋元','李泳豪','林青霞','汪峰','章子怡','刘亦菲',
    '杨颖','刘诗诗','赵丽颖','杨幂','迪丽热巴','陈学冬','鹿晗','吴亦凡','蔡徐坤','华晨宇',
    '范丞丞','王一博','肖战','白鹿','虞书欣','许凯','成毅','龚俊','王鹤棣','檀健次',
    '雪野','陈雪','刘宇宁','张新成','刘宇','宋雨琦','鞠婧祎','杨紫','赵露思','白敬亭',
    '赵牧辰','辰咪','蒋龙','贾科梅蒂','李诞','徐志胜','呼兰','周奇墨','毛不易','单依纯',
    '黄子韬','徐艺洋','宋茜','刘雨昕','赵小棠','秦岚','李一桐','蒋勤勤','汤唯','高圆圆',
    '陈建斌','蒋雯丽','倪妮','刘烨','张译','吴京','沈腾','马丽','贾玲','张小斐',
    '王宝强','邓超','孙俪','黄晓明','baby','张杰','谢娜','何炅','汪涵','吴昕',
    '张若昀','唐艺昕','戚薇','李承铉','范志毅','杨鸣','王楚钦','孙颖莎','全红婵','谷爱凌'
];

// 主题源额外强科技词（命中其一即视为科技相关；真科技测评/新品文标题总会含至少一个）
const TOPIC_STRONG_EXTRA = [
    // 设备/产品/品类
    '手机','机型','平板','笔记本','笔记本','台式机','显示器','耳机','音箱','相机','摄像机','微单','单反','镜头',
    '无人机','投影仪','智能手表','智能手环','路由器','充电器','电池','SSD','硬盘','内存','显卡','主板','机箱',
    'CPU','GPU','NPU','芯片','处理器','屏幕','OLED','LCD','miniLED','刷新率','分辨率','像素',
    // 品牌/公司
    '华为','苹果','小米','OPPO','vivo','三星','荣耀','一加','红米','realme','iQOO','努比亚','魅族',
    '联想','惠普','戴尔','华硕','宏碁','微星','雷神','机械革命','神舟','苹果','Apple','iPhone','iPad','MacBook',
    '特斯拉','比亚迪','理想','蔚来','小鹏','问界','小米汽车','极氪','智己','岚图','深蓝',
    '英伟达','NVIDIA','AMD','英特尔','高通','联发科','台积电','ARM','海思','麒麟','骁龙','天玑','苹果','Apple Silicon','M1','M2','M3','M4',
    'OpenAI','ChatGPT','GPT','Claude','Gemini','DeepSeek','通义千问','文心一言','豆包','kimi','智谱','月之暗面','MiniMax','Sora',
    // 数字
    '万元','英寸','毫安','mAh','GHz','nm','3nm','5nm','7nm','Watt','W','Type-C','USB','HDMI','WiFi','Wi-Fi','5G','6G','NFC','AI算力',
    // 动作
    '跑分','评测','测评','开箱','上手','实拍','样张','首测','众测','横评','对比评测','深度评测','拆解','跑分','固件','升级','OTA','推送','发布','上市','发布','发布','发布','价格','起售价','零售价','渠道','预订','预售','开卖','开售'
];

// 强科技相关判断（用于主题源/混合源过滤）：标题或描述中是否含至少 1 个强科技词
// （科技评测文/新品发布文/AI 行业文都必含此类词；纯娱乐文如明星剧/求婚/穿搭/护肤/赛事则不会有）
function hasStrongTech(text) {
    return STRONG_KEYWORDS.some(k => kwMatch(text, k)) || TOPIC_STRONG_EXTRA.some(k => kwMatch(text, k));
}

// 标题娱乐度检测：命中任何 CELEB_TERMS 或娱乐/婚恋/赛事/护肤/募捐等黑词直接返回 true（极强娱乐信号）
const HARD_ENT_TERMS = [
    ...CELEB_TERMS,
    // 婚恋/家庭
    '配偶','老婆','老公','夫妻','丈夫','新娘','伴郎','伴娘','恋爱','失恋','相亲','暗恋','表白','被甩','前夫','前妻','热恋','姐弟恋','闪婚','姐弟','夫妻档','夫妻','萌娃','喜当爹','喜当妈','喜提娃','小公主','小少爷',
    // 赛事/体育
    'NBA','CBA','世界杯','奥运','亚运','欧冠','西甲','意甲','德甲','中超','联赛','欧联','亚冠','UFC','WWE','F1','赛车','车队','积分榜','出线','淘汰赛','半决赛','决赛','MVP','FMVP','助攻王','得分王','射手王','金靴','金球','金手套','最佳阵容','夺冠','卫冕','联赛','赛季','比赛日','对阵','绝杀','逼平','补时','加时','点球','越位','红牌','黄牌','停赛','受伤','复出',
    // 美妆/护肤/医美/瘦身
    '美白','面霜','护肤','敏感肌','精华液','眼霜','洗面奶','乳液','肌底液','防晒霜','祛斑','抗皱','瘦脸','瘦身','减肥','抽脂','隆胸','整形','玻尿酸','肉毒素','水光针','美瞳','种睫毛','美甲','香水',
    // 美食/餐厅/菜谱
    '美食','菜谱','餐厅','饭店','菜系','年夜饭','小吃','甜点','蛋糕','奶茶','咖啡','茶饮','火锅','烧烤','自助餐',
    // 旅游/民宿
    '旅游','景区','游客','民宿','酒店','机票','签证','旅行','度假','跟团游','邮轮','打卡','出片','穷游',
    // 教育/校园
    '高考','考研','中考','录取','分数线','大学排名','教材','开学','期末','学霸','考公',
    // 收藏/博物
    '真迹','藏品','博物馆','博物院','文物','展览馆','大展',
    // 命案/公安
    '公安','打掉','命案','坠楼','诈骗案','抓获','逮捕','通缉','受贿',
    // 选秀/综艺
    '选秀','偶像练习生','创造营','青你','姐姐','哥哥','奔跑吧','极挑','歌手','天赐','全员','剧组','剧组','星女郎','谋女郎','谋男郎','星男郎','星公主','星哥','女郎','男郎'
];

// 简单娱乐词(只用于混合源/主题源的"反向证明非科技"——若标题含强娱乐词而无强科技词，丢弃)
const SOFT_ENT_TERMS = [
    '亮相','首秀','开嗓','开嗓门','开演','开唱','开讲','演讲','讲座','大学演讲','献唱','粉丝团','谢鼎','直击',
    '求婚','官宣','领证','订婚','同居','绯闻','婚恋','告白','热恋','劈腿','小三','原配',
    '剧组','开机','杀青','上映','开播','路演','首映','定档','排片','票房','档期','观影人次',
    '颜值','穿搭','造型','写真','街拍','红毯','时尚','身材','腹肌','马甲线','整容','医美','首饰','珠宝',
    '演唱会','歌友会','签售会','握手会','签售','首唱会','开嗓门','秀恩爱','撒狗粮','秀身材','网友直呼'
];

function countHits(text, list) { let n = 0; for (const k of list) if (kwMatch(text, k)) n++; return n; }
function entHits(text) {
    let n = 0;
    for (const w of HARD_ENT_TERMS) if (kwMatch(text, w)) n++;
    return n;
}
function softEntHits(text) {
    let n = 0;
    for (const w of SOFT_ENT_TERMS) if (kwMatch(text, w)) n++;
    return n;
}

// 相关性判定
//  - 标题命中一级（或混合源命中二级）排除词 → 直接丢弃
//  - 强娱乐信号（明星人名/赛事/婚恋/护肤/收藏/公安等）→ 直接丢弃，所有源一律拦截
//  - 纯科技源：仅做强娱乐/一级排除词拦截，其他都视为科技相关（信任源本身）
//  - 混合源/主题源：需至少 1 个强科技词；否则即便通过娱乐词也丢弃
function isRelevant(title, full, mixed) {
    if (!full) return false;
    const tl = title.toLowerCase();
    // 1) 一级/二级标题屏蔽词
    if (TITLE_BLOCK_T1.some(kw => kwMatch(tl, kw))) return false;
    if (mixed && TITLE_BLOCK_T2.some(kw => kwMatch(tl, kw))) return false;
    // 2) 强娱乐信号：明星人名 / 婚恋 / 赛事 / 护肤 / 博物 / 公安 等所有源一律拦截
    if (entHits(tl) > 0) return false;
    // 3) 混合源/主题源：必须含至少 1 个强科技词（防"开箱"+纯娱乐描述混入）
    if (mixed) {
        if (!hasStrongTech(full)) return false;
    }
    return true;
}
function extractTags(text) {
    if (!text) return [];
    const map = {
        '人工智能': ['人工智能','ai','大模型','gpt','chatgpt','深度学习','机器学习','llm','aigc','agi','openai','claude','gemini','copilot','sora','deepseek'],
        '手机': ['手机','iphone','华为','小米','oppo','vivo','三星','荣耀','折叠屏','旗舰','智能手机','ios','android','鸿蒙','pixel','galaxy'],
        '芯片/半导体': ['芯片','半导体','cpu','gpu','npu','高通','联发科','英特尔','amd','英伟达','nvidia','台积电','光刻','asml','arm','risc-v','海思','麒麟'],
        '新能源/电动车': ['新能源','电动车','特斯拉','比亚迪','蔚来','小鹏','理想','电池','充电','自动驾驶','fsd','固态电池','cybertruck','换电'],
        '汽车': ['汽车','大众','劳斯莱斯','宝马','奔驰','奥迪','丰田','本田','福特','吉利','长城','长安','奇瑞','保时捷','法拉利','沃尔沃','雷克萨斯','凯迪拉克','大众汽车','智能驾驶','辅助驾驶','混动','增程','suv'],
        '游戏': ['游戏','steam','ps5','xbox','switch','电竞','3a','原神','黑神话','dlss','光追'],
        '电脑硬件': ['电脑','笔记本','显卡','内存','ssd','主板','显示器','macbook','thinkpad','ipad','平板','机械键盘','鼠标','oled','miniled','ddr5'],
        '软件应用': ['软件','app','应用','操作系统','windows','macos','浏览器','chrome','开源','github','docker','linux'],
        '互联网': ['互联网','社交','电商','直播','短视频','字节跳动','腾讯','阿里','百度','美团','拼多多','京东','快手','小红书','b站','知乎','抖音','tiktok'],
        '网络安全': ['网络安全','黑客','漏洞','数据泄露','勒索软件','钓鱼','渗透','防火墙','apt','恶意软件','ddos'],
        'AI芯片': ['ai芯片','算力','英伟达','昇腾','寒武纪','gpu','npu'],
        '大公司': ['腾讯','阿里','字节跳动','百度','小米','华为','美团','京东','拼多多','网易','快手','三星','联想','苹果','谷歌','微软','meta','特斯拉','英伟达'],
        '测评/新品': ['测评','评测','上手','开箱','横评','跑分','新品发布','发布会','首发','亮相'],
        '专访': ['专访','访谈','对话','口述','圆桌'],
        '科技创投': ['融资','ipo','上市','估值','投资','创投','vc','pe','创业','独角兽','科创板','纳斯达克','财报','营收','市值'],
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
    // 虎嗅：RSSHub(huxiu/article) 仅 ~20 条且多为综合；板块页为 SPA 空壳、API 被阿里云 WAF 拦截，
    // 故直接改用 Google News(site:huxiu.com) 作为虎嗅主源（见 googleNewsSources），可稳定拉取近 ~100 篇
    // （含前沿科技/3C数码等板块），链接经 Google 服务端代理可在浏览器打开。
    { name: '华尔街见闻', url: 'https://rsshub.rssforever.com/wallstreetcn/news/global', color: '#d32f2f' },
    // 注：cnBeta 原域名 cnbeta.com.tw 已被 MSN 收购，文章链接全部 302 跳转到 msn.cn
    // 的 Cookie 同意墙（用户点击即白屏）。已改为在 htmlSources 中直接抓取存活镜像
    // http://www.cn-beta.com/ 首页，得到真实可点击的 cn-beta.com 文章链接。
    // 品玩：官网(pingwest.com) 已启用 WAF，直连/RSSHub 全部 405/503，无法直爬；
    // 改用 Google News (site:pingwest.com) 兜底（见 googleNewsSources），并由 seed 兜底。
    // 极客公园：RSSHub 链接是真实 geekpark.net URL（非 Google News 重定向），可正常点击
    { name: '极客公园', url: 'https://rsshub.rssforever.com/geekpark/breakingnews', color: '#00c4ff' },
    // 国际科技媒体
    { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml', color: '#e2127a' },
    { name: 'TechCrunch', url: 'https://techcrunch.com/feed/', color: '#0f9d58' },
    { name: 'Engadget', url: 'https://www.engadget.com/rss.xml', color: '#2b2d32' },
    { name: 'ZDNet', url: 'https://www.zdnet.com/news/rss.xml', color: '#0066cc', dead: true },
    { name: 'Hacker News', url: 'https://hnrss.org/frontpage', color: '#ff6600' },
    { name: 'Lobsters', url: 'https://lobste.rs/rss', color: '#b22222' },
    { name: 'Dev.to', url: 'https://dev.to/feed', url2: 'https://rsshub.app/devto', color: '#4b3e99' },
    { name: 'GSMArena', url: 'https://www.gsmarena.com/rss-news-reviews.php3', color: '#d32f2f' },
    // 以下为补充的真实科技媒体（直接 RSS，无 WAF/反爬），用于在不制造"伪主题源"的前提下
    // 真实扩量：Android Authority 覆盖安卓/手机/数码测评，Dark Reading 覆盖网络安全。
    { name: 'Android Authority', url: 'https://www.androidauthority.com/feed/', color: '#a4c639' },
    { name: 'Dark Reading', url: 'https://www.darkreading.com/rss.xml', color: '#1a1a2e' },
    // 以下为补充的真实科技媒体直链 RSS（无需经 Google 解码，规避限流白屏），
    // 作为稳定增量来源：小众软件(效率工具)、阮一峰周刊、酷壳(技术随笔)、美团技术团队。
    { name: '小众软件', url: 'https://www.appinn.com/feed/', color: '#2e7d32' },
    { name: '阮一峰周刊', url: 'https://www.ruanyifeng.com/blog/atom.xml', color: '#1565c0' },
    { name: '酷壳', url: 'https://coolshell.cn/feed', color: '#6a1b9a' },
    { name: '美团技术', url: 'https://tech.meituan.com/feed/', color: '#ff6f00' },
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
        // 合并写入：多个 HTML 源并发抓取时，避免后写的覆盖先写的缓存
        const existing = loadCache();
        const merged = Object.assign({}, existing, map);
        fs.writeFileSync(CACHE_PATH, JSON.stringify({ ts: Date.now(), articles: merged }));
    } catch(e) { /* 静默 */ }
}

    // 并发限流请求文章页，从 HTML 文本中提取首个 YYYY-MM-DD HH:MM[:SS] 作为发布时间
    // 同时补充 <meta name="description"> 内容作为摘要，提升卡片信息完整度。
    // 增量模式：已缓存的文章直接复用日期/摘要，仅对新文章请求。
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
                // 补充摘要：优先 meta description / og:description，否则正文首段
                if (!it.description) {
                    const metaM = h.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']{10,300})["']/i)
                        || h.match(/<meta[^>]*content=["']([^"']{10,300})["'][^>]*name=["']description["']/i)
                        || h.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']{10,300})["']/i);
                    if (metaM) {
                        it.description = stripHtml(metaM[1]).trim();
                    } else {
                        const $h = cheerio.load(h);
                        const firstP = $h('article p, .post-content p, .entry-content p, .article-content p, .content p, .main-content p, p').first().text().trim().slice(0, 220);
                        if (firstP.length >= 10) it.description = stripHtml(firstP).trim();
                    }
                }
            } catch(e) { /* 静默 */ }
        }));
        fetched += chunk.length;
        if (i + batch < toFetch.length) await new Promise(r => setTimeout(r, delayMs));
    }
    
    // 更新缓存
    const newCache = {};
    for (const it of items) {
        if (it.time || it.description) newCache[it.url] = { time: it.time, description: it.description };
    }
    saveCache(newCache);
    
    const result = items.filter(it => it.time);
    if (cached > 0 || fetched > 0) {
        console.log(`    日期: 缓存${cached} + 请求${fetched} → ${result.length}篇有效`);
    }
    return result;
}

// cnBeta 专用：直接抓取 http://www.cn-beta.com/ 镜像首页得到的文章链接可正常点击，
// 但首页无发布时间，需逐个请求文章页提取「YYYY-MM-DD HH:MM」与 meta 摘要。
// （原 cnbeta.com.tw 已被 MSN 收购，链接跳转 MSN Cookie 墙导致白屏，故改用镜像）
async function enrichCnBetaArticles(items, batch = 10, delayMs = 200) {
    const cache = loadCache();
    const toFetch = [];
    for (const it of items) {
        const c = cache[it.url];
        if (c && (c.time || c.description)) {
            it.time = c.time || it.time;
            it.description = c.description || it.description;
        } else {
            toFetch.push(it);
        }
    }
    for (let i = 0; i < toFetch.length; i += batch) {
        const chunk = toFetch.slice(i, i + batch);
        await Promise.allSettled(chunk.map(async (it) => {
            try {
                const r = await fetch(it.url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN' }, timeout: FETCH_TIMEOUT });
                const h = await r.text();
                const dm = h.match(/20\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2}/);
                if (dm) it.time = dm[0];
                const metaM = h.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']{10,300})["']/i)
                    || h.match(/<meta[^>]*content=["']([^"']{10,300})["'][^>]*name=["']description["']/i)
                    || h.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']{10,300})["']/i);
                if (metaM) it.description = stripHtml(metaM[1]).trim();
            } catch(e) { /* 静默 */ }
        }));
        if (i + batch < toFetch.length) await new Promise(r => setTimeout(r, delayMs));
    }
    const newCache = {};
    for (const it of items) {
        if (it.time || it.description) newCache[it.url] = { time: it.time, description: it.description };
    }
    if (Object.keys(newCache).length) saveCache(newCache);
    return items;
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
        const filtered = articles.filter(i => {
            const rel = isRelevant(i.title, i.title + ' ' + i.description, MIXED_SOURCES.includes(src.name));
            if (!rel && process.env.DEBUG_DROP && ['新浪科技', '搜狐科技', '凤凰科技'].includes(src.name)) {
                const tl = (i.title || '').toLowerCase();
                let reason = '标题屏蔽词';
                if (!TITLE_BLOCK_T1.some(kw => kwMatch(tl, kw)) && !(MIXED_SOURCES.includes(src.name) && TITLE_BLOCK_T2.some(kw => kwMatch(tl, kw)))) {
                    reason = '无强科技关键词';
                }
                console.log(`  [DROP ${src.name}|${reason}] ${i.title}`);
            }
            return rel;
        });
        console.log(`  => ${items.length}条${MIXED_SOURCES.includes(src.name) ? ', 科技' + filtered.length + '条' : '(纯科技源)'}`);
        return filtered;
    } catch(e) { console.log(`  => FAIL: ${e.message.substring(0,60)}`); return []; }
}

const htmlSources = [
    {
        name: '快科技', url: 'https://www.mydrivers.com/', color: '#ff6600',
        // 过滤逻辑交给主流程的 isRelevant（快科技已加入 MIXED_SOURCES）
        asyncExtract: async ($) => {
            const items = [];
            const seen = new Set();
            $('a').each((i, el) => {
                const $el = $(el);
                const title = $el.text().trim().replace(/\s+/g, ' ');
                let href = $el.attr('href') || '';
                if (title.length < 15 || title.length > 120 || !href) return;
                if (!href.includes('mydrivers.com') && !href.startsWith('/')) return;
                if (title.match(/^(首页|登录|注册|更多|下一页|上一页|搜索)$/)) return;
                if (href.startsWith('/')) href = 'https://www.mydrivers.com' + href;
                if (!href.startsWith('http')) return;
                if (!seen.has(href)) { seen.add(href); items.push({ title, url: href, time: '', description: '' }); }
            });
            return (await enrichArticleDates(items)).slice(0, 50);
        }
    },
    {
        name: '雷锋网', url: 'https://www.leiphone.com/', color: '#1890ff',
        // 雷锋网：首页无摘要，改为 asyncExtract 请求文章页补全日期+描述。
        asyncExtract: async ($) => {
            const items = []; const seen = new Set();
            $('a').each((i, el) => {
                const $el = $(el);
                const title = $el.text().trim().replace(/\s+/g, ' ');
                let href = $el.attr('href') || '';
                if (title.length < 15 || title.length > 120) return;
                if (!href.includes('leiphone.com')) return;
                if (title.match(/^(首页|登录|注册|更多|下一页)$/)) return;
                if (href.startsWith('/')) href = 'https://www.leiphone.com' + href;
                if (!href.startsWith('http')) return;
                if (!seen.has(href)) { seen.add(href); items.push({ title, url: href, time: '', description: '' }); }
            });
            return (await enrichArticleDates(items)).slice(0, 40);
        }
    },
    {
        name: 'DoNews', url: 'https://www.donews.com/', color: '#00a971',
        // DoNews：首页无摘要，改为 asyncExtract 请求文章页补全日期+描述。
        asyncExtract: async ($) => {
            const items = []; const seen = new Set();
            $('a').each((i, el) => {
                const $el = $(el);
                const title = $el.text().trim().replace(/\s+/g, ' ');
                let href = $el.attr('href') || '';
                if (title.length < 15 || title.length > 120) return;
                if (!(href.startsWith('/article/') || href.includes('donews.com'))) return;
                if (href.startsWith('/')) href = 'https://www.donews.com' + href;
                if (!href.startsWith('http')) return;
                if (!seen.has(href)) { seen.add(href); items.push({ title, url: href, time: '', description: '' }); }
            });
            return (await enrichArticleDates(items)).slice(0, 40);
        }
    },
    {
        name: '新华网科技', url: 'http://www.news.cn/tech/', color: '#003d8c',
        // 新华网科技：首页无摘要，改为 asyncExtract 请求文章页补全日期+描述。
        asyncExtract: async ($) => {
            const items = []; const seen = new Set();
            $('a').each((i, el) => {
                const $el = $(el);
                const title = $el.text().trim().replace(/\s+/g, ' ');
                let href = $el.attr('href') || '';
                if (title.length < 15 || title.length > 120) return;
                if (!(href.startsWith('/tech/') || href.includes('news.cn/tech'))) return;
                if (href.startsWith('/')) href = 'http://www.news.cn' + href;
                if (!href.startsWith('http')) return;
                if (!seen.has(href)) { seen.add(href); items.push({ title, url: href, time: '', description: '' }); }
            });
            return (await enrichArticleDates(items)).slice(0, 40);
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
        // 机器之心官网(jiqizhixin.com)已启用反爬，首页/文章页均返回挑战页，无法直爬。
        // 改用其官方网易号「机器之心Pro」媒体页：可直连、含当天最新文章、链接为真实可点文章页。
        name: '机器之心', url: 'https://www.163.com/dy/media/T1473761139764.html', color: '#512da8',
        // 机器之心：网易号媒体页直链，文章为 163.com 真实页面。改为 asyncExtract 抓文章页补全日期+描述。
        asyncExtract: async ($) => {
            const items = []; const seen = new Set();
            $('a').each((i, el) => {
                const $el = $(el);
                const title = $el.text().trim().replace(/\s+/g, ' ');
                let href = $el.attr('href') || '';
                if (title.length < 15 || title.length > 120) return;
                if (!/163\.com\/dy\/article\//.test(href)) return;
                if (href.startsWith('/')) href = 'https://www.163.com' + href;
                href = href.split('?')[0];
                if (!href.startsWith('http')) return;
                if (!seen.has(href)) { seen.add(href); items.push({ title, url: href, time: '', description: '' }); }
            });
            return (await enrichArticleDates(items)).slice(0, 40);
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
    {
        // cnBeta：原域名 cnbeta.com.tw 已被 MSN 收购，文章链接全部 302 跳转到 msn.cn 的
        // Cookie 同意墙（用户点击即白屏，看不到正文）。改用存活镜像 http://www.cn-beta.com/
        // 直接抓取首页，得到真实可点击的 cn-beta.com 文章链接（如 /redian/52280.html）。
        // 首页无发布时间，需逐个请求文章页提取日期与摘要（enrichCnBetaArticles）。
        name: 'cnBeta', url: 'http://www.cn-beta.com/', color: '#009a61',
        asyncExtract: async ($) => {
            const items = [];
            const seen = new Set();
            const catRe = /cn-beta\.com\/(redian|keji|shouji|youxi|wangluo|shuma|qiye|pingce)\/\d+\.html/i;
            $('a').each((i, el) => {
                const $el = $(el);
                let href = ($el.attr('href') || '').trim();
                if (!catRe.test(href)) return;
                if (href.startsWith('//')) href = 'http:' + href;
                else if (href.startsWith('/')) href = 'http://www.cn-beta.com' + href;
                const title = ($el.attr('title') || $el.text()).trim().replace(/\s+/g, ' ');
                if (title.length < 8 || title.length > 120) return;
                if (!seen.has(href)) { seen.add(href); items.push({ title, url: href, time: '', description: '' }); }
            });
            // 注意：不再回退到 RSSHub cnbeta —— 其链接为已废弃的 cnbeta.com.tw 域名，
            // 点击会 302 跳转 msn.cn 的 Cookie 同意墙（白屏）。镜像不可达时宁可少抓，也不给死链。
            console.log(`    cnBeta 首页直抓 ${items.length} 条`);
            return (await enrichCnBetaArticles(items)).slice(0, 30);
        }
    },
    // 新浪科技：科技频道首页直抓（https://tech.sina.com.cn/），链接为真实文章页，
    // URL 中含发布日期可直接解析，无需经 Google 解码（规避 Google 限流导致白屏/丢文）。
    { name: '新浪科技', url: 'https://tech.sina.com.cn/', color: '#e6162d',
        asyncExtract: async ($) => {
            const items = []; const seen = new Set();
            $('a').each((i, el) => {
                const $el = $(el);
                let href = ($el.attr('href') || '').trim();
                const title = ($el.attr('title') || $el.text() || '').trim().replace(/\s+/g, ' ');
                if (title.length < 8 || title.length > 80) return;
                if (!href) return;
                if (href.startsWith('//')) href = 'https:' + href;
                else if (href.startsWith('/')) href = 'https://tech.sina.com.cn' + href;
                if (!/^https?:\/\//.test(href)) return;
                // 仅保留纯科技版面：tech.sina.com.cn 或 finance.sina.com.cn 的 tech 子频道；
                // 排除 /roll/ 综合滚动（含体育/社会）与 /wm/ 财经理财，避免非科技漏入。
                if (!/tech\.sina\.com\.cn\//.test(href) && !/finance\.sina\.com\.cn\/tech\//.test(href)) return;
                if (seen.has(href)) return;
                seen.add(href);
                const time = parseDateFromText(href); // URL 形如 .../2026-07-10/doc-...shtml
                items.push({ title, url: href, time: time || '', description: '' });
            });
            console.log(`    新浪科技直抓 ${items.length} 条`);
            return items.slice(0, 90);
        }
    },
    // 搜狐科技：it.sohu.com 科技频道首页直抓，文章页为 sohu.com/a/... 真实直链；
    // 过滤 track.sohu.com 广告推广，日期需逐个请求文章页提取（enrichArticleDates）。
    { name: '搜狐科技', url: 'https://it.sohu.com/', color: '#d8402a',
        asyncExtract: async ($) => {
            const items = []; const seen = new Set();
            $('a').each((i, el) => {
                const $el = $(el);
                let href = ($el.attr('href') || '').trim();
                const title = ($el.attr('title') || $el.text() || '').trim().replace(/\s+/g, ' ');
                if (title.length < 8 || title.length > 80) return;
                if (!href) return;
                if (href.startsWith('//')) href = 'https:' + href;
                else if (href.startsWith('/')) href = 'https://it.sohu.com' + href;
                if (!/^https?:\/\//.test(href)) return;
                if (!/sohu\.com\/a\/\d+_/.test(href)) return; // 仅文章页，排除 track.sohu.com 推广
                if (seen.has(href)) return;
                seen.add(href);
                items.push({ title, url: href, time: '', description: '' });
            });
            console.log(`    搜狐科技直抓 ${items.length} 条`);
            return await enrichArticleDates(items.slice(0, 45));
        }
    },
    // 凤凰科技：tech.ifeng.com 科技频道首页直抓，文章页为 tech.ifeng.com/c/... 真实直链；
    // 日期需逐个请求文章页提取（enrichArticleDates）。
    { name: '凤凰科技', url: 'https://tech.ifeng.com/', color: '#1e88e5',
        asyncExtract: async ($) => {
            const items = []; const seen = new Set();
            $('a').each((i, el) => {
                const $el = $(el);
                let href = ($el.attr('href') || '').trim();
                const title = ($el.attr('title') || $el.text() || '').trim().replace(/\s+/g, ' ');
                if (title.length < 8 || title.length > 80) return;
                if (!href) return;
                if (href.startsWith('//')) href = 'https:' + href;
                else if (href.startsWith('/')) href = 'https://tech.ifeng.com' + href;
                if (!/^https?:\/\//.test(href)) return;
                if (!/tech\.ifeng\.com\/c\/[A-Za-z0-9]+/.test(href)) return;
                if (seen.has(href)) return;
                seen.add(href);
                items.push({ title, url: href, time: '', description: '' });
            });
            console.log(`    凤凰科技直抓 ${items.length} 条`);
            return await enrichArticleDates(items.slice(0, 80));
        }
    },
];

// ========== 4. Google News RSS（反爬/无RSS源的可靠兜底） ==========
// 部分源官网反爬严重(如 pingwest)、RSSHub 公共实例频繁 503，直接用 Google News
// 站点检索获取近 3 天真实文章（标题/时间准确，链接为 news.google.com 重定向，
// 点击后在浏览器中解析到原文，不会跳到站点首页）。
const googleNewsSources = [
    // 品玩官网(pingwest.com) 已启用阿里云 WAF，直连/RSSHub 全部 405/503 无法直爬。
    // Google News 的 site:pingwest.com 检索可稳定返回真实文章，且链接经
    // Google 服务端代理，即使 pingwest 被墙在浏览器中仍可正常打开 —— 作为品玩实时源。
    { name: '品玩', site: 'pingwest.com', color: '#ff5722' },
    // 虎嗅：RSSHub(huxiu/article) 仅 ~20 条且多为综合；板块页为 SPA 空壳、API 被阿里云 WAF 拦截。
    // Google News 的 site:huxiu.com 可稳定拉取近 ~100 篇（含前沿科技/3C数码等板块），
    // 链接经 Google 代理可在浏览器打开 —— 作为虎嗅主源（保留 30 天窗口，一个月内的科技文全部保留）。
    { name: '虎嗅', site: 'huxiu.com', color: '#374151' },
    // ZDNet 官网 RSS(news/rss.xml) 已退化（仅 ~1 条），改为 Google News site:zdnet.com 兜底；
    // ZDNet 为英文源，故用 en-US 语言参数拉取真实英文文章（链接已修为 articles/ 格式可正常打开）。
    { name: 'ZDNet', site: 'zdnet.com', color: '#0066cc', hl: 'en-US', gl: 'US', ceid: 'US:en' },
    // ===== 主题源（与上方"数据源"分开归类）：自由检索词，拉取近30天相关科技文 =====
    // 这些不是独立的媒体，而是"按主题聚合"的视图；标记 topic:true 并放宽至 30 天窗口。
    { name: '数码测评', query: '数码评测 OR 手机评测 OR 笔记本评测 OR 相机评测 OR 耳机评测 OR 平板评测 OR 上手体验 OR 开箱 OR 横评 OR 跑分', color: '#e65100', topic: true },
    { name: '新品发布', query: '新品发布 OR 发布会 OR 首发 OR 官宣 OR 新品上市', color: '#ad1457', topic: true },
    { name: '三星', query: '三星 Galaxy 手机 OR 三星 芯片 OR 三星 发布', color: '#0d47a1', topic: true },
    { name: '索尼', query: '索尼 Sony OR 索尼 耳机 OR 索尼 相机 OR PlayStation', color: '#1a1a2e', topic: true },
    { name: '尼康', query: '尼康 Nikon OR 尼康 相机 OR 尼康 Z 系列', color: '#34495e', topic: true },
    { name: '佳能', query: '佳能 Canon OR 佳能 相机 OR 佳能 EOS', color: '#c0392b', topic: true },
    { name: '科技专访', query: '专访 OR 访谈 OR 对话 科技 OR 口述 创始人', color: '#37474f', topic: true },
    { name: '上市科技', query: 'IPO OR 科技公司 上市 OR 科技 财报 OR 独角兽 融资', color: '#1b5e20', topic: true },
    // 以下为补充主题聚合源（30天窗口）：与上方主题源同理，按主题检索近30天科技文，
    // 作为"按主题浏览"的合集扩量；解码依赖 Google 端点，由解码重试+安全护栏兜底（限流时不覆盖旧数据）。
    { name: 'AI大模型', query: '大模型 OR 大语言模型 OR ChatGPT OR 国产大模型 OR 开源大模型 OR 推理模型', color: '#6a1b9a', topic: true },
    { name: '芯片半导体', query: '芯片 OR 半导体 OR 光刻机 OR 英伟达 OR 台积电 OR 华为芯片 OR 先进制程', color: '#004d40', topic: true },
    { name: '智能汽车', query: '智能汽车 OR 自动驾驶 OR 新能源车 OR 小米汽车 OR 特斯拉 OR 飞行汽车', color: '#0d47a1', topic: true },
];

async function fetchGoogleNews(src, existingTitles) {
    try {
        console.log(`[GNews] ${src.name}`);
        // 站点兜底源用 site:domain；主题扩量源用自由检索词（src.query）
        const q = src.query ? src.query : 'site:' + src.site;
        // 语言/地区可逐源覆盖（英文源如 ZDNet 用 en-US，中文源用 zh-CN）
        const hl = src.hl || 'zh-CN', gl = src.gl || 'CN', ceid = src.ceid || 'CN:zh-Hans';
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
        const feed = await parser.parseURL(url);
        const now = Date.now();
        const items = [];
        for (const it of (feed.items || [])) {
            const t = new Date(it.isoDate || it.pubDate || 0).getTime();
            // 放宽至 30 天：虎嗅在 MONTH_WINDOW 中保留一个月内全部科技文；
            // 品玩不在 MONTH_WINDOW，最终仍由主流程窗口裁掉陈旧项。
            if (isNaN(t) || (now - t) > 30 * 86400000) continue;
            // 去掉 Google News 追加的 " - 站点名" 后缀（品玩/虎嗅/网易/极客公园/FreeBuf/36氪等）
            const title = (it.title || '').replace(/\s*-\s*(机器之心|品玩|网易|网易科技|163|极客公园|GeekPark|虎嗅网|虎嗅|huxiu|FreeBuf|安全内参|36氪|钛媒体|雷锋网|量子位|腾讯科技|新浪科技|搜狐科技|搜狐|凤凰网|快科技|爱范儿|界面新闻|第一财经|财新|澎湃新闻|观察者网|站长之家|驱动之家|CSDN|中关村在线|ZOL|IT之家|少数派|亿欧|雷科技|太平洋电脑网|什么值得买|IT之家)\s*$/i, '').trim();
            if (!title || title === src.name || title.length < 4) continue; // 跳过频道/栏目入口与纯站名垃圾项
            // 直连源(RSSHub等)已收录的同名文章优先，避免同一篇既显示直链又显示 Google 重定向链
            if (existingTitles.has(title)) continue;
            // Google News 的 RSS 链接为 news.google.com/rss/articles/...，该格式在浏览器中会白屏；
            // 去掉路径中的 "rss/" 改为 news.google.com/articles/... 即可正常跳转到原文。
            let gurl = it.link || '';
            gurl = gurl.replace('news.google.com/rss/articles/', 'news.google.com/articles/');
            // 服务端解码 Google News 跳转链接为真实原文 URL：用户网络下 Google 不可达，
            // 直接点 news.google.com/articles/ 会白屏；解码后指向原始媒体站点，可直接打开。
            const gid = extractId(gurl);
            let resolved = false;
            if (gid && decodeCache[gid]) {
                gurl = decodeCache[gid];
                resolved = true;
            } else {
                const real = await decodeGoogleNews(gurl);
                if (real) { gurl = real; if (gid) decodeCache[gid] = real; resolved = true; }
            }
            // 解码失败（Google 不可达或文章已失效）：直接跳过，避免用户点开白屏
            if (!resolved) continue;
            const art = makeArticle(src, { title, url: gurl, time: it.isoDate || it.pubDate || '' });
            if (src.topic) art.topic = true; // 标记主题扩量源，新鲜度过滤放宽至 30 天
            items.push(art);
            existingTitles.add(title);
        }
        console.log(`  => ${items.length}条(近30天, 已去重, 最终按源窗口裁切)`);
        return items;
    } catch(e) { console.log(`  => FAIL: ${e.message.substring(0,60)}`); return []; }
}

// ========== 混合源：需经相关性过滤（其余为纯科技源，仅做标题级排除） ==========
// 含站点兜底源(华尔街见闻/虎嗅/品玩/极客公园/快科技) 与 主题源(数码测评/新品发布/三星/索尼/尼康/佳能/科技专访/上市科技)
const MIXED_SOURCES = ['华尔街见闻', '虎嗅', '品玩', '极客公园', '快科技',
    '数码测评', '新品发布', '三星', '索尼', '尼康', '佳能', '科技专访', '上市科技'];

// 主题源集合（用于后续主题强科技过滤与 30 天新鲜度窗口）
const TOPIC_SOURCES = new Set(googleNewsSources.filter(s => s.topic).map(s => s.name));

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

    // 去重
    const seen = new Set();
    let unique = [];
    for (const a of allArticles) {
        const key = (a.title + a.url).slice(0, 120);
        if (!seen.has(key)) { seen.add(key); unique.push(a); }
    }
    // 各源实时抓取条数（用于「种子兜底」：仅在该源实时为 0 时注入种子）
    const liveCountBySource = {};
    unique.forEach(a => { liveCountBySource[a.source] = (liveCountBySource[a.source] || 0) + 1; });

    unique.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));

    // 非科技硬过滤：统一用 isRelevant 复核（混合源强词要求 + 标题排除词），防御性兜底
    const beforeNonTech = unique.length;
    unique = unique.filter(a => {
        const rel = isRelevant(a.title, a.title + ' ' + a.description, MIXED_SOURCES.includes(a.source));
        if (!rel && process.env.DEBUG_DROP && ['新浪科技', '搜狐科技', '凤凰科技'].includes(a.source)) {
            const tl = (a.title || '').toLowerCase();
            let reason = '标题屏蔽词';
            if (!TITLE_BLOCK_T1.some(kw => kwMatch(tl, kw)) && !(MIXED_SOURCES.includes(a.source) && TITLE_BLOCK_T2.some(kw => kwMatch(tl, kw)))) {
                reason = '无强科技关键词(被相关性过滤)';
            }
            console.log(`  [DROP ${a.source}|${reason}] ${a.title}`);
        }
        return rel;
    });
    if (unique.length < beforeNonTech) console.log(`\n🧹 非科技过滤: ${beforeNonTech} → ${unique.length} 篇`);

    // 主题聚合源额外过滤：Google News 自由检索常会匹配到含"开箱/体验/首秀"软词但非科技的内容
    // （如明星剧宣传、娱乐追星、网红八卦、高校开箱）。强制要求标题中至少命中 1 个强科技关键词，
    // 只看标题（不看描述），因为描述常被污染或含泛科技词，标题更可靠。
    const beforeTopicStrong = unique.length;
    unique = unique.filter(a => {
        if (!TOPIC_SOURCES.has(a.source) && !a.topic) return true;
        const strong = countHits(a.title, STRONG_KEYWORDS);
        if (strong >= 1) return true;
        if (process.env.DEBUG_DROP) console.log(`  [DROP topic-strong|${a.source}] ${a.title}`);
        return false;
    });
    if (unique.length < beforeTopicStrong) console.log(`\n🎯 主题源强科技过滤: ${beforeTopicStrong} → ${unique.length} 篇`);

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
                    // 仅在该源「实时抓取为 0」时，才注入种子作为兜底，
                    // 避免与新鲜实时数据重复/陈旧（如虎嗅/极客公园/网易科技有实时数据时不再注入种子）。
                    if ((liveCountBySource[sa.source] || 0) > 0) continue;
                    // 同样经过相关性过滤，避免种子数据混入非科技内容
                    if (isRelevant(sa.title, sa.title + ' ' + (sa.description || ''), MIXED_SOURCES.includes(sa.source))) {
                        seen.add(key);
                        sa.seedFallback = true; // 标记：新鲜度过滤放宽至 30 天（见下方）
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
    // 用户要求只看「新的 / 1天前 / 2天前 / 3天前」——标准窗口收紧为 3 天；
    // 仅对更新极慢的低频源放宽（爱搞机/Dev.to/cnBeta 30天，澎湃新闻 7天），避免它们被饿死。
    const MAX_AGE_MS = 3 * 24 * 3600 * 1000;
    const MAX_AGE_LONG_MS = 7 * 24 * 3600 * 1000;
    const MAX_AGE_MONTH_MS = 30 * 24 * 3600 * 1000;
    const LONG_WINDOW_SOURCES = ['澎湃新闻'];
    const MONTH_WINDOW_SOURCES = ['爱搞机', 'Dev.to', 'cnBeta'];
    // 主题源（自由检索聚合）放宽至 30 天，作为"按主题浏览"的合集；其最新条目仍会进入看板前列
    const before = unique.length;
    unique = unique.filter(a => {
        const t = new Date(a.time || 0).getTime();
        if (isNaN(t) || t <= 0) return false; // 日期缺失直接丢弃，避免旧文伪装成最新
        let maxAge = MAX_AGE_MS;
        // 种子兜底文章（实时为0时注入）同样放宽至 30 天，保证反爬源至少有内容
        if (a.seedFallback) maxAge = MAX_AGE_MONTH_MS;
        else if (TOPIC_SOURCES.has(a.source) || a.topic) maxAge = MAX_AGE_MONTH_MS;
        else if (MONTH_WINDOW_SOURCES.includes(a.source)) maxAge = MAX_AGE_MONTH_MS;
        else if (LONG_WINDOW_SOURCES.includes(a.source)) maxAge = MAX_AGE_LONG_MS;
        return (Date.now() - t) <= maxAge;
    });
    console.log(`\n🕒 新鲜度过滤: ${before} → ${unique.length} 篇 (标准3天/澎湃7天/低频源30天/主题源30天)`);

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
    // 持久化解码缓存（始终保存，供下次抓取命中，仅对新文章解码）
    fs.writeFileSync(path.join(__dirname, '..', 'data', 'decode-cache.json'), JSON.stringify(decodeCache, null, 2));
    // 安全护栏：若本次总量远低于上一次（如 Google 限流导致解码源大面积失效），
    // 不覆盖已有数据，避免把正常的 1300+ 文章误写成残缺数据。解码缓存在上方已保存。
    const prevTotal = (() => { try { return JSON.parse(fs.readFileSync(outPath, 'utf8')).total || 0; } catch (_) { return 0; } })();
    const floor = Math.max(1000, Math.floor(prevTotal * 0.85));
    if (prevTotal && unique.length < floor) {
        console.log(`\n⚠️ 抓取总量 ${unique.length} 远低于上次 ${prevTotal}（疑似 Google 限流致解码源失效），保留旧数据不覆盖。`);
    } else {
        fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
        console.log('\n已保存:', outPath);
    }

    const bySource = {};
    unique.forEach(a => { bySource[a.source] = (bySource[a.source] || 0) + 1; });
    const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('\n===== 最终统计 =====');
    console.log('总文章数:', unique.length);
    console.log('总耗时:', totalElapsed + 's');
    Object.entries(bySource).sort((a,b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
    console.log('\n已保存:', outPath);
}

main()
    .then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1); });
