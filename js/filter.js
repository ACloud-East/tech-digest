/**
 * TechDigest 内容过滤模块
 * 确保所有展示的内容都与科技数码领域相关
 *
 * 过滤策略：加权判定
 *  - 硬科技类别（ai/phone/chip/ev/game/pc/software/internet/vc/iot/web3）命中任意关键词即相关（权重 2）
 *  - 软相关类别（review 评测类、internetBiz 泛化业务词）权重 1，需累计 ≥2 或配合硬词才相关
 * 这样可避免「安全/体验/广告」等泛化词单独把非科技热搜放进来，也避免漏掉「大疆/航天」等科技品牌
 */

const TechFilter = {
    /**
     * 相关领域关键词库
     */
    keywords: {
        // 人工智能/AI
        ai: [
            '人工智能', 'AI', '大模型', 'GPT', 'ChatGPT', '深度学习', '机器学习', '神经网络',
            'LLM', 'AIGC', 'AGI', '生成式AI', 'Copilot', 'Gemini', 'Claude', 'OpenAI',
            'Anthropic', 'Stable Diffusion', 'Midjourney', 'Sora', '自然语言处理', 'NLP',
            '计算机视觉', '强化学习', 'Transformer', '扩散模型', '多模态', '智能体', 'Agent',
            '具身智能', '人形机器人', 'AI芯片', '训练', '推理', 'token', '参数', '对齐',
            'prompt', '提示词', '微调', '预训练', '开源模型', 'Llama', '通义千问', '文心一言',
            '混元', '豆包', 'kimi', 'deepseek', '深度求索', '月之暗面', '智谱', '百川',
            '零一万物', 'MiniMax', '阶跃星辰', 'AI搜索', 'AI绘画', 'AI写作', 'AI编程',
            'AI助手', 'AI客服', 'AI医疗', 'AI教育', 'AI金融', '自动驾驶AI', '具身智能',
            '商汤', '科大讯飞'
        ],

        // 手机
        phone: [
            '手机', 'iPhone', '华为', '小米', 'OPPO', 'vivo', '三星', '荣耀', '一加',
            '折叠屏', '旗舰', '智能手机', '5G', '卫星通信', '快充', '无线充电',
            'iOS', 'Android', '鸿蒙', 'HarmonyOS', 'HyperOS', 'ColorOS', 'OriginOS',
            '骁龙', '天玑', 'A系列芯片', '苹果', 'Apple', 'Mate', 'P系列', 'Nova',
            'Redmi', 'realme', 'iQOO', '努比亚', '魅族', '摩托罗拉', '索尼手机',
            'Pixel', 'Galaxy', 'Ultra', 'Pro', 'Max', 'SE', '影像旗舰', '拍照',
            '屏幕指纹', '屏下摄像头', '高刷屏', 'LTPO', 'AMOLED', '钛金属'
        ],

        // 芯片/半导体
        chip: [
            '芯片', '半导体', 'CPU', 'GPU', 'NPU', 'TPU', '高通', '联发科', '英特尔',
            'AMD', '英伟达', 'NVIDIA', '台积电', '光刻', '晶圆', '制程', '3nm', '5nm',
            '7nm', 'EUV', 'DUV', 'ASML', 'ARM', 'RISC-V', 'x86', '海思', '麒麟',
            '昇腾', '寒武纪', '地平线', '摩尔线程', '壁仞', '天数智芯', '龙芯', '飞腾',
            '兆芯', '申威', 'HBM', 'DDR5', 'PCIe', '封装', 'chiplet',
            '先进封装', 'CoWoS', '存储芯片', 'NAND', 'DRAM', '三星电子',
            'SK海力士', '美光', '中芯国际', '华虹', '长江存储', '长鑫存储', 'EDA',
            '芯片设计', '流片', '良率', '制裁', '出口管制', '实体清单'
        ],

        // 新能源/电动车
        ev: [
            '新能源', '电动车', '特斯拉', '比亚迪', '蔚来', '小鹏', '理想', '电池',
            '充电', '自动驾驶', 'FSD', '固态电池', '锂电', '钠电', '宁德时代', '比亚迪刀片',
            '4680', 'CTC', '换电', '超充', '800V', '碳化硅', 'SiC', '问界', '极氪',
            '零跑', '哪吒', '高合', '小米汽车', 'SU7', 'Cybertruck', 'Model', 'NIO',
            'XPeng', 'Li Auto', 'Rivian', 'Lucid', '极越', '智界', '享界', '阿维塔',
            '深蓝', '启源', '仰望', '方程豹', '腾势', '银河', '极星', 'Polestar',
            '新能源车', '混合动力', '插混', '增程', '氢能源', '燃料电池', '光伏', '储能',
            '充电桩', 'V2G', '智能座舱', '城市NOA', '高速NOA', '端到端', 'Occupancy'
        ],

        // 数码评测（软相关：仅评测类强指向词，需配合/累计，避免「体验/推荐」等泛词泄漏）
        review: [
            '评测', '开箱', '测评', '横评', '图赏'
        ],

        // 游戏
        game: [
            '游戏', 'Steam', '主机', 'PS5', 'Xbox', 'Switch', '电竞', '3A',
            '原神', '黑神话', '悟空', '王者荣耀', '和平精英', '崩坏', '米哈游',
            '游戏手机', 'ROG', '拯救者', '黑鲨', '红魔', '手柄', '机械键盘',
            '游戏鼠标', '显示器', '高刷', '光追', 'DLSS', 'FSR', 'XeSS',
            '虚幻引擎', 'Unity', '游戏引擎', '独立游戏', '手游', '端游', '网游',
            'PUBG', 'LOL', '英雄联盟', '无畏契约', '瓦洛兰特', '永劫无间',
            '电竞显示器', '游戏本', '云游戏', 'Xbox Game Pass', 'PlayStation Plus'
        ],

        // 电脑硬件
        pc: [
            '电脑', '笔记本', '显卡', '内存', 'SSD', '主板', '显示器', 'MacBook',
            'ThinkPad', '台式机', '一体机', '工作站', '服务器', '超极本', '游戏本',
            '轻薄本', 'Chromebook', 'Surface', 'iPad', '平板', '二合一',
            '机械键盘', '鼠标', '耳机', '音箱', '路由器', 'NAS', '电源', '散热',
            '水冷', '风冷', '机箱', '模组线', '定制线', '超频', '降压', 'BIOS',
            '雷电', 'USB4', 'HDMI', 'DP', 'Type-C', 'WiFi', '蓝牙', '2.5G',
            '万兆', 'DDR5', 'PCIe 5.0', 'ATX', 'ITX', 'miniLED', 'OLED'
        ],

        // 软件应用（硬科技）
        software: [
            '软件', 'App', '应用', '操作系统', 'iOS', 'Android', 'Windows', 'macOS',
            '浏览器', 'Chrome', 'Edge', 'Firefox', 'Safari', '办公', 'WPS',
            'Office', '设计', '剪辑', '修图', '小程序', '插件',
            '扩展', 'API', 'SDK', '开源', 'GitHub', 'Git', 'Docker', 'Kubernetes',
            'Linux', 'Ubuntu', 'Debian', '服务器', '云服务', 'AWS', 'Azure',
            '阿里云', '腾讯云', '华为云', '数据库', 'MySQL', 'PostgreSQL', 'Redis',
            'MongoDB', '中间件', '微服务', 'DevOps', 'CI/CD', '防火墙'
        ],

        // 互联网（硬科技：平台/公司/业务主体）
        internet: [
            '互联网', '社交', '搜索', '字节跳动', '腾讯',
            '阿里', '百度', '美团', '拼多多', '京东', '快手', '小红书', 'B站',
            '知乎', '微博', '微信', '抖音', 'TikTok', '淘宝', '天猫', '饿了么',
            '滴滴', '网易', '搜狐', '新浪', '携程', '去哪儿', '飞猪', '大厂'
        ],

        // 互联网泛化业务词（软相关：单独出现多为非科技，需累计或配合硬词）
        internetBiz: [
            '营收', '财报', '广告', '裁员', '招聘', 'MAU', 'DAU', 'GMV',
            '私域', '社群', '下沉市场', '出海'
        ],

        // 科技创投
        vc: [
            '融资', 'IPO', '上市', '估值', '投资', '创投', 'VC', 'PE', '创业',
            '独角兽', '瞪羚', 'A轮', 'B轮', 'C轮', '天使轮', '种子轮', 'Pre-IPO',
            '红杉', '高瓴', 'IDG', '经纬', '真格', '启明', '蓝驰', '源码',
            '五源', '云九', '顺为', '腾讯投资', '阿里投资', '字节投资', '小米投资',
            '科创板', '创业板', '北交所', '纳斯达克', '港股', 'SPAC', '回购',
            '并购', '拆分', '独立上市', 'Pre-A', '战略投资', '产业资本'
        ],

        // 智能硬件 / 物联网（含无人机、商业航天等品牌与领域）
        iot: [
            '智能硬件', 'IoT', '可穿戴', '智能家居', 'AR', 'VR', 'XR', 'Vision Pro',
            'Quest', '机器人', '无人机', '大疆', '航天', '3D打印', '智能音箱', '智能手表', '手环',
            '智能门锁', '智能灯', '智能窗帘', '扫地机器人', '洗地机', '智能猫砂盆',
            '智能喂食器', 'HomeKit', '米家', '华为智选', '天猫精灵', '小度',
            'Apple Watch', 'AirPods', 'Meta Quest', 'Apple Vision', 'Ray-Ban',
            'HoloLens', 'Pico', 'Rokid', 'XREAL', '雷鸟', '智能眼镜', '智能戒指',
            '智能秤', '体脂秤', '血压计', '血糖仪', '健康监测', '睡眠监测'
        ],

        // 区块链/Web3
        web3: [
            '区块链', 'Web3', '比特币', '以太坊', 'NFT', 'DeFi', '加密', '数字货币',
            'DAO', '智能合约', 'Layer2', 'Solana', 'Polygon', 'Avalanche', '币安',
            'Coinbase', 'Metamask', 'DApp', '稳定币', 'USDT', 'USDC', 'CBDC',
            '数字人民币', '元宇宙', 'GameFi', 'SocialFi', '空投', 'Meme', 'Ordinals',
            '铭文', '符文', 'RWA', 'DePIN', 'TON', 'Telegram', 'Web3游戏'
        ]
    },

    /**
     * 类别权重：硬科技=2，软相关=1
     */
    categoryWeight: {
        ai: 2, phone: 2, chip: 2, ev: 2, game: 2, pc: 2, software: 2,
        internet: 2, vc: 2, iot: 2, web3: 2,
        review: 1, internetBiz: 1
    },

    /**
     * 所有关键词的扁平化集合（用于快速匹配）
     */
    _allKeywords: null,

    /**
     * 获取所有关键词的扁平列表
     */
    getAllKeywords() {
        if (!this._allKeywords) {
            const all = [];
            for (const category of Object.values(this.keywords)) {
                all.push(...category);
            }
            // 去重
            this._allKeywords = [...new Set(all)];
        }
        return this._allKeywords;
    },

    /**
     * 判断文本是否与科技数码领域相关（加权判定）
     * 规则：命中任意硬科技关键词(score≥2) 即相关；
     *       仅命中软相关词时，需累计分值 ≥2（即 ≥2 个软词）才相关。
     * @param {string} text - 待检测文本
     * @returns {boolean}
     */
    isRelevant(text) {
        if (!text) return false;
        const lowerText = text.toLowerCase();
        let score = 0;

        for (const [category, keywords] of Object.entries(this.keywords)) {
            const weight = this.categoryWeight[category] || 1;
            for (const keyword of keywords) {
                if (lowerText.includes(keyword.toLowerCase())) {
                    score += weight;
                    break; // 同一类别只计一次权重
                }
            }
            if (score >= 2) break; // 已达阈值，提前结束
        }

        return score >= 2;
    },

    /**
     * 获取文本匹配到的领域分类
     * @param {string} text
     * @returns {string[]}
     */
    getCategories(text) {
        if (!text) return [];

        const lowerText = text.toLowerCase();
        const categories = [];

        for (const [category, keywords] of Object.entries(this.keywords)) {
            for (const keyword of keywords) {
                if (lowerText.includes(keyword.toLowerCase())) {
                    categories.push(category);
                    break;
                }
            }
        }

        return categories;
    },

    /**
     * 获取领域的中文名称映射
     */
    categoryNames: {
        ai: '人工智能',
        phone: '手机',
        chip: '芯片/半导体',
        ev: '新能源/电动车',
        review: '数码评测',
        game: '游戏',
        pc: '电脑硬件',
        software: '软件应用',
        internet: '互联网',
        internetBiz: '互联网商业',
        vc: '科技创投',
        iot: '智能硬件',
        web3: '区块链/Web3'
    }
};

// 兼容旧引用（部分代码可能直接引用 TechFilter）
if (typeof window !== 'undefined') window.TechFilter = TechFilter;
if (typeof module !== 'undefined' && module.exports) module.exports = TechFilter;
