/**
 * AIGenerator v2 - AI 文案生成引擎
 * 更强的本地模板生成：基于输入/原文生成完整、流畅、像成品的文章
 * 预留 DeepSeek / OpenAI API 接口
 */

const AIGenerator = {
    config: {
        // 'local'  : 纯前端模板伪 AI（免费兜底，无需 key）
        // 'cloud'  : 经同源 Cloudflare Function 代理调用大模型（支持 BYOK：用户自带 key）
        // 'deepseek': 浏览器直连 api.deepseek.com（需填 deepseekKey，key 会暴露于前端，不推荐）
        // 'openai' : 浏览器直连 api.openai.com（需填 openaiKey，key 会暴露于前端，不推荐）
        provider: 'cloud',
        // 同源代理端点（Cloudflare Pages Functions 提供）；GitHub Pages 无函数会自动回退本地
        endpoint: '/api/ai-generate',
        deepseekKey: '',   // 仅 'deepseek' 模式使用，明文在前端不安全，建议用 'cloud' 模式
        deepseekModel: 'deepseek-chat',
        openaiKey: '',     // 仅 'openai' 模式使用，明文在前端不安全
        openaiModel: 'gpt-4o-mini',

        // ===== BYOK：用户自带 key（存于浏览器 localStorage，仅本人可见） =====
        userApiKey: '',    // 用户自己的 API key（如 sk-xxx）
        userApiBase: '',   // 用户指定的 API 地址，留空则用站点默认（VectorEngine）
        userApiModel: '',  // 用户指定的模型名，留空则用 deepseek-chat
    },

    // 是否使用「用户自带 key」
    get useOwnKey() {
        return !!(this.config.userApiKey && String(this.config.userApiKey).trim());
    },

    async generate(form, onToken) {
        const p = this.config.provider;
        if (p === 'cloud' || p === 'deepseek' || p === 'openai') {
            try {
                if (p === 'cloud') return await this.generateViaCloud(form, onToken);
                if (p === 'deepseek' && this.config.deepseekKey) return await this.generateViaDeepSeek(form, onToken);
                if (p === 'openai' && this.config.openaiKey) return await this.generateViaOpenAI(form, onToken);
            } catch (e) {
                // 用户自带 key 出错：显式抛出，便于用户看到「key 失效/余额不足」并去更换
                if (this.useOwnKey) throw e;
                console.warn('[AI] 云端生成失败，回退本地模板：', e.message);
                // 未配置自带 key 时，任何云端异常都回退到本地模板，保证按钮始终有产出
            }
        }
        if (form.plain) {
            return await this.generatePlainLocal(form, onToken);
        }
        return await this.generateLocal(form, onToken);
    },

    // ========== 经服务端代理生成（支持 BYOK：用户自带 key 随请求带上） ==========
    async generateViaCloud(form, onToken) {
        const prompt = this.buildPrompt(form);
        const body = {
            prompt,
            model: this.config.userApiModel || this.config.deepseekModel,
            wordCount: form.wordCount || 800,
            max_tokens: this._estimateMaxTokens(form),
            stream: true,
        };
        if (form.sources && form.sources.trim()) {
            body.sources = form.sources.split(/[\n,，;；]+/).map(s => s.trim()).filter(Boolean).slice(0, 12);
        }
        if (form.webSearch) body.webSearch = true;
        body.topic = (form.title && form.title.trim()) || (form.content || '').replace(/\s+/g, ' ').trim().slice(0, 60);
        // 用户自带 key 时，把 key 与 base 一并带给代理函数（key 仅在本机 localStorage，不上 git）
        if (this.useOwnKey) {
            body.apiKey = this.config.userApiKey.trim();
            if (this.config.userApiBase && this.config.userApiBase.trim()) {
                body.base = this.config.userApiBase.trim();
            }
        }
        const resp = await fetch(this.config.endpoint || '/api/ai-generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(90000),
        });
        if (!resp.ok) {
            let detail = '';
            try { detail = (await resp.json()).error || ''; } catch (_) {}
            throw new Error('AI 服务 ' + resp.status + (detail ? '：' + detail : ''));
        }

        const ct = (resp.headers.get('content-type') || '').toLowerCase();
        // 流式：逐 token 回调，实现打字机效果
        if (resp.body && ct.includes('text/event-stream')) {
            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            let buf = '', acc = '', metaAcc = null;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += decoder.decode(value, { stream: true });
                let idx;
                while ((idx = buf.indexOf('\n\n')) >= 0) {
                    const raw = buf.slice(0, idx);
                    buf = buf.slice(idx + 2);
                    const dataLine = raw.split('\n').find(l => l.startsWith('data:'));
                    if (!dataLine) continue;
                    const data = dataLine.slice(5).trim();
                    if (!data || data === '[DONE]') continue;
                    let content = '';
                    try {
                        const j = JSON.parse(data);
                        if (j.error) throw new Error('AI 服务：' + (j.error.message || j.error));
                        if (j.meta) { metaAcc = j.meta; continue; }
                        content = j.content || '';
                    } catch (e) { if (e.message && e.message.startsWith('AI 服务')) throw e; continue; }
                    if (content) { acc += content; if (onToken) onToken(this.parseApiResponse(this._fitToCharCount(acc, form.wordCount))); }
                }
            }
            if (!acc) throw new Error('AI 服务返回为空');
            const fitted = this._fitToCharCount(acc, form.wordCount);
            const result = this.parseApiResponse(fitted);
            // 优先用函数回传的 references（联网检索/抓取结果），兼容旧 sources
            if (metaAcc && metaAcc.references && metaAcc.references.length) result.references = metaAcc.references;
            else if (metaAcc && metaAcc.sources) result.sourcesMeta = metaAcc.sources;
            if (onToken) onToken(result);
            return result;
        }

        // 非流式（上游返回 JSON）：解析后做打字机展开
        const data = await resp.json();
        if (data.error) throw new Error('AI 服务：' + (typeof data.error === 'string' ? data.error : JSON.stringify(data.error)));
        const content = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || data.content;
        if (!content) throw new Error('AI 服务返回为空');
        const result = this.parseApiResponse(content);
        result.content = this._fitToCharCount(result.content, form.wordCount);
        if (onToken) await this._reveal(result.content, onToken, result.title);
        return result;
    },

    // ========== 本地生成（核心 - v3 重写） ==========
    async generateLocal(form, onToken) {
        await this.delay(500 + Math.random() * 400);
        const typeConfig = this.getTypeConfig(form.type);
        const style = this.getStyleConfig(form.style);
        const audience = this.getAudienceConfig(form.audience);

        // Step 1: 深度解析原文，提取结构化信息
        const source = form.content && form.content.length > 30
            ? this.parseSource(form.content, typeConfig)
            : null;

        // Step 2: 确定标题（优先用原文提取，其次用户输入，最后模板生成）
        let title = (source && source.product) 
            ? this.buildTitle(source, typeConfig, form.title)
            : (form.title || this.generateTitle(form, typeConfig, []));

        // Step 3: 构建文章骨架并逐段填充
        let content = this.composeArticle({
            title, typeConfig, style, audience,
            source, form, wordCount: form.wordCount,
            extraInstructions: form.extraInstructions || '',
            template: form.template || ''
        });

        // Step 4: 全文润色（清除残留模板变量、替换通用占位词）
        content = this.polish(content, source);
        // Step 5: 按目标字数裁剪或扩展
        content = this.adjustWordCount(content, form.wordCount, source);
        // Step 6: 标点归一化，清除拼接产生的重复/粘连标点
        content = this._normalizePunctuation(content);

        // 流式打字机展示
        if (onToken) await this._reveal(content, onToken, title);
        return { title, content };
    },

    /** 非结构式生成：独立成篇的连续散文，叙事角度与结构式完全不同，不照抄结构式骨架 */
    async generatePlainLocal(form, onToken) {
        await this.delay(500 + Math.random() * 400);
        const typeConfig = this.getTypeConfig(form.type);
        const style = this.getStyleConfig(form.style);
        const audience = this.getAudienceConfig(form.audience);

        const source = form.content && form.content.length > 30
            ? this.parseSource(form.content, typeConfig)
            : null;

        const title = (source && source.product)
            ? this.buildTitle(source, typeConfig, form.title)
            : (form.title || this.generateTitle(form, typeConfig, []));

        const product = (source && source.product) || title;
        const company = (source && source.company) || '';
        const date = (source && source.date) || '';
        const featureFacts = source ? source.features : [];
        const specFacts = source ? source.specs : [];
        const bgFacts = source ? source.background : [];

        let article = '';

        // ===== 开篇：以一个画面 / 一个反问 / 一句判断切入（与结构式"在…期待中"截然不同） =====
        const hooks = [];
        if (company && product) {
            hooks.push(`走进任何一间数码卖场，你都会发现货架上多了一个值得停步的身影——那是${company}的${product}。它没有刻意喧哗，却用实打实的配置，把${audience.label}的视线悄悄留了下来。`);
            hooks.push(`如果只能用一个词形容${company}这次的动作，大概会是"克制"。${product}不是堆料堆出来的怪物，而更像是一份写给${audience.label}的、想得很清楚的答案。`);
        }
        hooks.push(`有时候，一款产品真正的分量，不在发布会当天的掌声里，而在它之后很长一段时间里，人们还会不会反复提起。${product}显然属于后者——它值得被慢下来认真聊一聊。`);
        hooks.push(`我们总在追问"下一代到底新在哪"。而当${product}摆在面前时，问题也许该换成：它让我们的日常，具体好在了哪一个瞬间？`);
        article += hooks[Math.floor(Math.random() * hooks.length)];

        // ===== 背景段：为什么是现在、为什么是它（区别于结构式的"参数/市场"分章） =====
        article += '\n\n';
        if (date) {
            article += `${date}这个时间节点并不偶然。`;
        } else {
            article += `把视线拉回到当下的节点，这件事的发生并不偶然。`;
        }
        if (company) {
            article += `${company}选择在这个时候把${product}推到台前，背后是一连串关于节奏与取舍的判断：既不抢跑到技术尚未成熟，也不迟到让对手抢走话语权。对${audience.label}来说，这种"踩点"本身，就透露出这家公司的定力。`;
        } else {
            article += `它选择在这个时候登场，背后是一连串关于节奏与取舍的判断。对${audience.label}来说，这种"踩点"本身，就透露出操盘者的定力。`;
        }
        if (bgFacts.length > 0) {
            article += this._paraphraseFact(bgFacts[0], source) + '这句话放在这里，恰如其分地解释了它为何此刻出现。';
        }

        // ===== 主体段：把事实织进叙述，而不是列点（用不同连接词，避免与结构式雷同） =====
        article += '\n\n';
        const bodyOpeners = [
            `真正让人记住${product}的，是那些用起来才明白的细节。`,
            `抛开参数表，${product}最打动人的部分，藏在使用的具体褶皱里。`,
            `说回产品本身，让人愿意为它买单的理由，其实很朴素。`,
        ];
        article += bodyOpeners[Math.floor(Math.random() * bodyOpeners.length)];
        const usedFacts = new Set();
        const threadFacts = [...featureFacts.slice(0, 3), ...specFacts.slice(0, 2)];
        for (const f of threadFacts) {
            if (usedFacts.has(f)) continue;
            usedFacts.add(f);
            const rewritten = this._paraphraseFact(f, source, true);
            if (rewritten && rewritten.length > 10 && !article.includes(rewritten.substring(0, 12))) {
                article += rewritten;
            }
        }
        if (featureFacts.length === 0 && specFacts.length === 0) {
            article += `${product}把力气花在了${audience.label}真正每天会碰到的地方，而不是纸面上好看的数字。这种务实，反而更经得起时间。`;
        }

        // ===== 深一度：一个被忽略的视角（区别于结构式的"技术解析/市场格局"） =====
        article += '\n\n';
        const depthOpeners = [
            `不过，比起"它有什么"，更值得想的是"它替谁省了心"。`,
            `站在使用者那一侧看，${product}带来的改变往往是静悄悄的。`,
            `把镜头再推近一点，会发现${product}真正聪明的地方，是做了减法。`,
        ];
        article += depthOpeners[Math.floor(Math.random() * depthOpeners.length)];
        if (featureFacts.length > 3) {
            article += this._paraphraseFact(featureFacts[3], source);
        } else if (specFacts.length > 2) {
            article += this._paraphraseFact(specFacts[2], source, true);
        }
        article += `对${audience.label}而言，这些看似微小的取舍，堆叠起来就是"顺手"和"别扭"之间的全部差距。技术的高下，常常就藏在这道缝隙里。`;

        // ===== 收尾：开放式感悟，不写"总得来看"的总结腔 =====
        article += '\n\n';
        const closes = [];
        if (company && product) {
            closes.push(`所以，${product}到底值不值得？答案不在任何一篇评测的结论里，而在你某天用到它的那个瞬间。${company}把产品交了出来，剩下的判断，本就该属于${audience.label}自己。`);
            closes.push(`回过头看，${company}做${product}这件事，更像在替一类人把话说清楚：好用的科技，应该是安静地待命，而不是忙着证明自己存在。这或许就是它最体面的地方。`);
        }
        closes.push(`科技产品的故事，从来都不是一条直线。${product}只是其中新的一笔，它划下的痕迹深不深，要等时间慢慢显影。而我们，只需保持好奇，也保持清醒。`);
        article += closes[Math.floor(Math.random() * closes.length)];

        // 润色 + 按目标字数调整 + 标点归一化
        article = this.polish(article, source);
        article = article.replace(/\n{3,}/g, '\n\n').trim();
        article = this.adjustWordCount(article, form.wordCount, source);
        article = this._normalizePunctuation(article);

        // 流式打字机展示
        if (onToken) await this._reveal(article, onToken, title);
        return { title, content: article };
    },

    /**
     * Step 1: 深度解析原文
     * 提取：产品名、公司名、版本号、日期、核心功能、技术参数、背景
     */
    parseSource(text, typeConfig) {
        const result = {
            product: '', company: '', versions: [], date: '',
            features: [], specs: [], background: [], allFacts: []
        };

        // ===== 1) 公司名 =====
        const brands = ['索尼', '佳能', '尼康', '苹果', '华为', '小米', '三星', '特斯拉', '英伟达', 'NVIDIA',
            '英特尔', 'AMD', '高通', '联发科', '谷歌', '微软', 'Meta', '字节跳动', '阿里', '腾讯', '百度', '大疆',
            '蔚来', '小鹏', '理想', '比亚迪', 'OPPO', 'vivo', '荣耀', 'DJI', 'GoPro'];
        let company = '';
        for (const b of brands) {
            if (text.includes(b)) { company = b; break; }
        }

        // ===== 2) 剔除 Markdown 标题行，避免 #小标题 混入正文 =====
        const bodyLines = text.split('\n').filter(l => !/^\s*#+\s/.test(l));
        const cleanText = bodyLines.join('\n');
        const titleLine = (text.split('\n')[0] || '').trim();

        // ===== 3) 产品型号：综合打分，优先"最新/力作"且带完整前缀的型号 =====
        const modelRegex = /[A-Za-z]{2,6}[-\s]?[A-Za-z]?\d{1,4}[A-Za-z]?/g;
        const rawCandidates = [...new Set(cleanText.match(modelRegex) || [])];
        // 丢弃纯子串候选（如 Z200 是 PXW-Z200 的子串）
        const candidates = rawCandidates.filter(c =>
            !rawCandidates.some(o => o !== c && o.length > c.length && o.includes(c))
        );

        const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        let bestModel = '';
        let bestScore = -1e9;
        for (const c of candidates) {
            let score = c.length;                                   // 越完整越长越好
            if (new RegExp(esc(c)).test(titleLine)) score += 12;   // 标题中出现
            const nearNew = new RegExp('.{0,14}' + esc(c) + '.{0,8}(最新|新款|全新|力作|新一代|发布|推出|上市)').test(cleanText)
                          || new RegExp('(最新|新款|全新|力作|新一代).{0,14}' + esc(c)).test(cleanText);
            if (nearNew) score += 8;
            const nearOld = new RegExp('(最初|此前|上代|前辈|原来的|老款|前代|早先).{0,12}' + esc(c)).test(cleanText);
            if (nearOld) score -= 12;                              // 旧型号减分
            if (score > bestScore) { bestScore = score; bestModel = c; }
        }

        // product 仅存型号（公司在标题/正文组合时再加，避免重复）
        result.product = bestModel || '';
        result.company = company;
        result.versions = candidates.slice(0, 6);

        // 找公司名（兜底，若上面循环未命中）
        if (!result.company) {
            for (const b of brands) {
                if (text.includes(b)) { result.company = b; break; }
            }
        }

        // 找日期
        const dateMatch = text.match(/(\d{4}年\d{1,2}月\d{1,2}日)/);
        if (dateMatch) result.date = dateMatch[1];

        // 提取版本号（固件 Ver.x.x）
        const verMatches = text.match(/Ver\.?\s*\d+\.\d+/g) || [];
        if (verMatches.length) result.versions = [...new Set([...result.versions, ...verMatches])].slice(0, 6);

        // 提取所有句子：排除标题行（避免标题被当事实注入正文），并剔除残留 # 标题
        const factText = bodyLines.length > 1 ? bodyLines.slice(1).join('\n') : cleanText;
        const sentences = factText.replace(/[\n\r]+/g, ' ')
            .split(/[。！？；]/)
            .map(s => s.replace(/^#+\s*/, '').trim())
            .filter(s => s.length > 8 && !/^#/.test(s));

        // 分类句子
        sentences.forEach(s => {
            result.allFacts.push(s);
            if (/新增|支持|允许|提升|优化|升级|改进|增加|加入|可以|能够/.test(s)) {
                result.features.push(s);
            } else if (/\d+[%倍档级]|ISO|fps|K\s*120|动态范围|分辨率|像素|Watt|功耗|mAh/.test(s)) {
                result.specs.push(s);
            } else if (/公司|品牌|产品线|系统|系列|愿景|致力于|一直|创作者|行业/.test(s)) {
                result.background.push(s);
            }
        });

        // 兜底：型号仍为空时，取标题前 30 字作为产品名
        if (!result.product) {
            result.product = titleLine.substring(0, 30).replace(/[,，。\s]+$/, '') || text.substring(0, 30).replace(/[,，。\s]+$/, '');
        }

        return result;
    },

    /** 用提取的真实信息构建标题 */
    buildTitle(source, typeConfig, userTitle) {
        if (userTitle && userTitle.length > 3) return userTitle;
        const prefix = source.date ? source.date + '，' : '';
        const action = typeConfig.type === 'release' ? '正式发布' : typeConfig.label;
        if (source.product && source.company) {
            return prefix + source.company + action + source.product;
        }
        if (source.company && source.versions.length) {
            return prefix + source.company + action + source.versions.join('/') + '固件升级';
        }
        return source.product || source.company + typeConfig.label;
    },

    // 兜底标题生成
    generateTitle(form, typeConfig, keywords) {
        const main = keywords[0] || typeConfig.keyword;
        const tmpl = (typeConfig.templates || ['${main}：${secondary}深度分析'])[0];
        return tmpl.replace(/\$\{main\}/g, main).replace(/\$\{secondary\}/g, keywords[1] || '行业洞察');
    },

    // Step 3: 文章合成（使用结构化 source 而非通用 main/secondary，按目标字数控制章节数）
    composeArticle(ctx) {
        const { title, typeConfig, style, audience, source, form, wordCount, extraInstructions, template } = ctx;
        const main = (source && source.product) || form.title || typeConfig.keyword;
        const company = (source && source.company) || '';
        // secondary 不再用 versions（会混入旧型号 FS5/FS7 造成事实错误），统一留空交由各段落兜底文案
        const secondary = '';
        const facts = source ? source.allFacts : [];

        // 根据目标字数控制章节数量，避免 500 字生成 700+ 内容
        let sections = typeConfig.sections;
        const maxSections = this._sectionCountByWordCount(wordCount);
        if (sections.length > maxSections) {
            // 保留前面的章节，后面的删除；总结永远保留
            sections = sections.slice(0, maxSections);
        }

        // 引言
        let article = this.writeIntroNew({ typeConfig, style, audience, main, company, source, extraInstructions });

        // 正文段落：每个 section 匹配相关事实
        const usedFacts = new Set();
        sections.forEach((sectionName, idx) => {
            // 选择与本节主题最匹配的事实
            const matchedFact = this.pickBestFact(sectionName, facts, usedFacts, idx);
            if (matchedFact) usedFacts.add(matchedFact);

            const section = this.writeSection({
                sectionName, idx, typeConfig, style, audience,
                main, secondary, company, fact: matchedFact,
                source, template, extraInstructions, wordCount
            });
            article += '\n\n' + section;
        });

        // 结论
        article += '\n\n' + this.writeConclusionNew({ typeConfig, style, audience, main, company, source, extraInstructions });

        return article;
    },

    /** 按目标字数决定章节数量 */
    _sectionCountByWordCount(wordCount) {
        if (!wordCount) return 5;
        if (wordCount <= 500) return 3;
        if (wordCount <= 800) return 4;
        if (wordCount <= 1000) return 5;
        if (wordCount <= 1500) return 6;
        return 7;
    },

    /** 按主题匹配选择最佳事实 */
    pickBestFact(sectionName, facts, usedFacts, fallbackIdx) {
        const topicKeywords = {
            '核心参数': ['ISO', '分辨率', 'fps', '帧率', 'K ', '像素', 'mm', '英寸', '背照', '堆栈'],
            '功能亮点': ['新增', '支持', '允许', '可以', '能够', '升级', '改进', '提升'],
            '产品亮点': ['新增', '支持', '允许', '可以', '能够', '升级', '改进', '提升'],
            '影像系统': ['ISO', '感光', '高感', '色彩', 'LUT', '画质', '动态范围', '影像', '图像', 'CMOS'],
            '性能体验': ['性能', '速度', '稳定', '对焦', '响应', '处理'],
            '市场定位': ['市场', '竞争', '定位', '价格', '区间'],
            '技术解析': ['技术', '架构', '算法', '芯片', '处理器', '引擎'],
            '未来趋势': ['未来', '趋势', '后续', '规划', '展望'],
        };
        const keywords = topicKeywords[sectionName] || [];

        // 先找主题匹配且未使用的
        for (const f of facts) {
            if (usedFacts.has(f)) continue;
            if (keywords.some(k => f.includes(k))) return f;
        }
        // 再找任意未使用的
        for (const f of facts) {
            if (!usedFacts.has(f)) return f;
        }
        // 兜底：按索引
        return facts[fallbackIdx % facts.length] || '';
    },

    writeIntro({ typeConfig, style, audience, language, main, secondary, sourceFacts, extraInstructions }) {
        const intros = {
            review: [
                `在数码产品百花齐放的今天，${main}的出现为市场注入了一剂强心针。作为一款面向${audience.label}的产品，它究竟能否在${secondary}这条赛道上站稳脚跟？经过一段时间的深入体验，本文将从${typeConfig.sections.slice(0,3).join('、')}等多个维度，给出我们的答案。`,
                `如果你是${audience.label}，那么${main}大概率已经在你的关注列表里。这款产品主打${secondary}，但体验是否配得上期待？本篇${typeConfig.label}将从实际使用场景出发，带来真实、客观的深度解析。`,
            ],
            release: [
                `日前，${main}正式发布，这款产品一经亮相便引发了${audience.label}的广泛关注。从${secondary}到具体落地场景，${main}试图用一系列技术创新重新定义市场预期。本文将第一时间为你梳理它的核心亮点与潜在价值。`,
                `沉寂许久的市场，因为${main}的登场再次热闹起来。作为一次备受瞩目的新品发布，它不仅承载着品牌的期望，也可能影响${secondary}的后续走向。让我们一起来看看，这场发布究竟带来了什么。`,
            ],
            event: [
                `近日，一场聚焦${secondary}的科技活动吸引了众多目光。${main}作为其中的核心议题，展现了行业在技术、产品与市场层面的最新思考。本文将带你回顾现场亮点，并解读背后的意义。`,
                `科技行业从不缺少热点，而${main}相关的这场活动，显然为${audience.label}提供了更多值得探讨的话题。从发布内容到行业趋势，我们不妨做一个全面的复盘。`,
            ],
            interview: [
                `在科技创新的浪潮中，总有一些关键人物在幕后推动着变革。本次${typeConfig.label}，我们走近${main}，围绕${secondary}、行业趋势与未来布局，进行了一次深度对话。`,
                `${main}是近年来科技圈内备受关注的名字。在这次专访中，他/她向我们分享了关于${secondary}的真实想法，以及对这个行业未来发展的独到判断。`,
            ],
            exhibition: [
                `一年一度的科技展会再次拉开帷幕，${main}毫无悬念地成为本届展会的焦点之一。从${secondary}到前沿应用，本届展会释放了大量值得关注的信号。本文将为你盘点${typeConfig.label}中的高光时刻。`,
                `走进展会现场，${main}相关展台前的人流量足以说明话题热度。作为${audience.label}关注的焦点，这次展报我们将从${typeConfig.sections.slice(0,3).join('、')}几个维度，还原现场全貌。`,
            ],
            tutorial: [
                `对于${audience.label}来说，${main}是一个既能提升效率、又容易上手的工具。但想要真正用好它，还需要掌握一些关键技巧。今天的${typeConfig.label}，就来手把手教你如何玩转${secondary}。`,
                `你是否遇到过这样的场景：面对${main}，却不知道从何下手？别担心，本文将以清晰的步骤和实用的案例，带你从入门到进阶，全面掌握${secondary}的核心用法。`,
            ],
            opinion: [
                `最近一段时间，${main}成为了科技圈讨论的高频词。有人认为它是${secondary}的转折点，也有人持保留态度。作为${audience.label}，我们尝试跳出情绪化的争论，从更理性的角度审视这一现象。`,
                `当${main}被反复提及，我们有必要追问：它究竟意味着什么？它为何在此时此刻引发关注？本文将从${typeConfig.sections.slice(0,3).join('、')}三个层面，给出我们的行业判断。`,
            ],
            comparison: [
                `在选购${main}时，消费者往往会面临一个难题：面对众多选择，究竟哪一款更适合自己？为了解答这个问题，我们挑选了市面上${secondary}这一细分领域的热门产品，进行了一场横向${typeConfig.label}。`,
                `同价位、同定位的产品越来越多，${main}市场的竞争也日趋激烈。这次${typeConfig.label}，我们将从${typeConfig.sections.slice(0,3).join('、')}等维度，帮你厘清不同产品之间的差异。`,
            ],
            news: [
                `刚刚，${main}传来新消息。这一事件迅速引发${audience.label}的关注，因为它不仅关乎${secondary}，也可能对后续市场格局产生连锁反应。下面我们来梳理事件的核心要点。`,
                `科技行业又起波澜。${main}的最新动态，成为今天${audience.label}讨论的焦点。本文将第一时间为你呈现事件来龙去脉，以及值得关注的关键细节。`,
            ],
            analysis: [
                `表面上，${main}只是一个普通的产品/事件。但如果把时间线拉长，我们会发现它背后折射出的，是${secondary}格局的深层变化。今天，我们就来做一次${typeConfig.label}。`,
                `在信息碎片化的时代，我们更需要对${main}进行系统性思考。这篇文章将从${typeConfig.sections.slice(0,3).join('、')}三个角度，为${audience.label}提供一份深度解读。`,
            ],
            default: [
                `${main}正成为科技行业无法忽视的话题。围绕${secondary}，不同立场、不同视角的声音交织在一起。作为${audience.label}，我们需要更清晰、更理性的认知。`,
            ]
        };

        const pool = intros[typeConfig.type] || intros.default;
        let text = pool[Math.floor(Math.random() * pool.length)];

        // 融入原文事实
        if (sourceFacts.length > 0) {
            text += `\n\n据相关信息，${sourceFacts[0]}。`;
            if (sourceFacts[1]) text += `与此同时，${sourceFacts[1]}。`;
        }

        // 融入风格
        if (style.type === 'lively') text = text.replace(/。/g, '。').replace(/，/g, '，');

        return text;
    },

    writeSection({ sectionName, idx, typeConfig, style, audience, main, secondary, company, fact, source, template, extraInstructions, wordCount }) {
        const kw = secondary || main;

        // 简写的"产品名" = 如果 source 有产品，用产品+公司名，否则用 main
        const productName = (source && source.product) || main;
        const companyRef = (source && source.company) || company || '';

        const builders = {
            '外观设计': () => this.sectionDesign({ main, secondary, style, audience, fact }),
            '性能体验': () => this.sectionPerformance({ main, secondary, style, audience, fact }),
            '功能亮点': () => this.sectionFeatures({ main, secondary, style, audience, fact }),
            '影像系统': () => this.sectionCamera({ main, secondary, style, audience, fact }),
            '续航与充电': () => this.sectionBattery({ main, secondary, style, audience, fact }),
            '系统与生态': () => this.sectionEcosystem({ main, secondary, style, audience, fact }),
            '核心参数': () => this.sectionSpecs({ main, secondary, style, audience, fact }),
            '产品亮点': () => this.sectionHighlights({ main, secondary, style, audience, fact }),
            '市场定位': () => this.sectionMarket({ main, secondary, style, audience, fact }),
            '竞品对比': () => this.sectionCompetition({ main, secondary, style, audience, fact }),
            '购买建议': () => this.sectionBuying({ main, secondary, style, audience, fact }),
            '活动概况': () => this.sectionOverview({ main, secondary, style, audience, fact }),
            '重要发布': () => this.sectionKeyReleases({ main, secondary, style, audience, fact }),
            '现场亮点': () => this.sectionHighlights({ main, secondary, style, audience, fact }),
            '核心观点': () => this.sectionKeyViews({ main, secondary, style, audience, fact }),
            '深度对话': () => this.sectionDialogue({ main, secondary, style, audience, fact }),
            '操作步骤': () => this.sectionSteps({ main, secondary, style, audience, fact, idx }),
            '进阶技巧': () => this.sectionTips({ main, secondary, style, audience, fact, idx }),
            '现象概述': () => this.sectionPhenomenon({ main, secondary, style, audience, fact }),
            '深层原因': () => this.sectionReasons({ main, secondary, style, audience, fact }),
            '趋势判断': () => this.sectionTrends({ main, secondary, style, audience, fact }),
            '参评产品': () => this.sectionProducts({ main, secondary, style, audience, fact }),
            '新闻要点': () => this.sectionKeyPoints({ main, secondary, style, audience, fact }),
            '事件详情': () => this.sectionDetails({ main, secondary, style, audience, fact }),
            '技术解析': () => this.sectionTech({ main, secondary, style, audience, fact }),
            '市场格局': () => this.sectionMarketStructure({ main, secondary, style, audience, fact }),
            '竞争态势': () => this.sectionCompetition({ main, secondary, style, audience, fact }),
            '未来趋势': () => this.sectionTrends({ main, secondary, style, audience, fact }),
        };

        const builder = builders[sectionName] || (() => this.sectionGeneric({ sectionName, main, secondary, style, audience, fact, idx }));
        return `## ${sectionName}\n\n` + builder();
    },

    // 各段落生成器
    sectionDesign({ main, secondary, style, audience, fact }) {
        return `第一眼看到${main}，${style.howDescribe}的设计语言就很容易给人留下印象。${fact ? '资料显示，' + fact + '。' : ''}在整体观感上，它并没有走过度张扬的路线，而是在${secondary || '细节处理'}上下了不少功夫。\n\n` +
               `具体来看，机身线条、材质选择以及接口布局都体现出一种对${audience.careAbout}的考量。对于${audience.label}而言，这种设计思路意味着更直观的操作体验和更低的视觉负担。`;
    },

    sectionPerformance({ main, secondary, style, audience, fact }) {
        return `性能表现一直是${audience.label}最关心的部分之一。${main}在这方面给出了自己的解决方案。${fact ? '从已知信息看，' + fact + '。' : ''}\n\n` +
               `实际使用中，${secondary || '多任务处理'}和大型应用场景都能保持相对流畅的响应。当然，性能并不是孤立的指标，它与散热、系统优化等因素密切相关。${style.howEvaluate}来看，${main}的综合性能表现在同定位产品中处于中上水平，能够满足${audience.label}的主流需求。`;
    },

    sectionFeatures({ main, secondary, style, audience, fact }) {
        return `除了基础能力，${main}在功能层面也提供了不少值得关注的地方。${fact ? '其中，' + fact + '。' : ''}\n\n` +
               `这些功能并非简单的堆砌，而是围绕${secondary || '实际使用场景'}进行设计。例如，在${audience.useScenario}中，用户能够感受到功能组合带来的效率提升。${style.howEvaluate}地说，${main}的功能策略是务实的，它更强调"好用"而非"炫酷"。`;
    },

    sectionCamera({ main, secondary, style, audience, fact }) {
        return `影像能力一直是移动设备竞争的高地。${main}在这一块选择了${style.howDescribe}的升级路径。${fact ? '具体来说，' + fact + '。' : ''}\n\n` +
               `从实际成像来看，${main}在${secondary || '日常拍摄'}场景下表现稳定，色彩还原和细节保留都达到了${audience.label}可以满意的水平。夜景、人像、视频等常用模式也各有优化，整体使用门槛不高。`;
    },

    sectionBattery({ main, secondary, style, audience, fact }) {
        return `续航和充电体验直接影响用户对${main}的长期评价。${fact ? '据悉，' + fact + '。' : ''}\n\n` +
               `在实际测试中，中等强度使用下${main}能够支撑${audience.label}一整天的需求。快充功能的加入也进一步降低了续航焦虑。${style.howEvaluate}来看，${main}在续航与便携性之间取得了相对平衡。`;
    },

    sectionEcosystem({ main, secondary, style, audience, fact }) {
        return `硬件只是体验的一部分，${main}所在的生态体系同样值得关注。${fact ? '值得注意的是，' + fact + '。' : ''}\n\n` +
               `对于${audience.label}来说，设备之间的协同能力、软件服务的完整性，以及后续更新的持续性，都是衡量一款产品长期价值的重要因素。${main}在这些方面的表现，将直接影响用户的留存率和口碑。`;
    },

    sectionSpecs({ main, secondary, style, audience, fact }) {
        return `参数是理解${main}最快速的方式。${fact ? '根据官方信息，' + fact + '。' : ''}\n\n` +
               `从配置组合来看，${main}显然瞄准了${secondary || '主流高端'}市场。对于${audience.label}而言，这些数字背后是实实在在的体验差异：更快的响应速度、更高的显示素质、以及更稳定的连接能力。`;
    },

    sectionHighlights({ main, secondary, style, audience, fact }) {
        return `本次${main}值得关注的亮点并不少。${fact ? '其中，' + fact + '。' : ''}\n\n` +
               `除此之外，${secondary || '产品体验'}上的优化、${audience.careAbout}的改进，以及整体定位的明确，都让${main}在众多选择中具备了较强的辨识度。这些亮点共同构成了它的核心竞争力。`;
    },

    sectionMarket({ main, secondary, style, audience, fact }) {
        return `${main}的市场定位非常清晰。${fact ? '从市场信息看，' + fact + '。' : ''}\n\n` +
               `它所要争取的，正是那些对${secondary || '性能与体验'}有较高要求、同时又希望价格合理的${audience.label}。在这个区间内，竞争固然激烈，但${main}的差异化卖点为它赢得了一定的空间。`;
    },

    sectionCompetition({ main, secondary, style, audience, fact }) {
        return `谈及${main}，很难避开竞品比较的话题。${fact ? '横向对比可以发现，' + fact + '。' : ''}\n\n` +
               `与${secondary || '同价位主流产品'}相比，${main}的优势在于${this.randomPick(['更精准的场景定位','更完整的功能体验','更成熟的生态支持','更直接的用户价值'])}。而需要提升的，则是在${this.randomPick(['极限性能','品牌溢价','渠道覆盖','用户教育'])}等方面仍有空间。`;
    },

    sectionBuying({ main, secondary, style, audience, fact }) {
        return `综合以上分析，${main}适合哪类人群？${fact ? '结合市场反馈，' + fact + '。' : ''}\n\n` +
               `如果你是${audience.label}，并且对${secondary || main}有明确需求，那么${main}是一个值得纳入候选清单的选项。\n\n` +
               `购买建议方面：追求性价比的用户可以关注首发优惠；对配置要求较高的用户建议优先选择高配版本；而持币观望的用户，则可以等待更多真实评测出炉后再做决定。`;
    },

    sectionOverview({ main, secondary, style, audience, fact }) {
        return `本次活动/展会围绕${main}展开，整体氛围${style.howDescribe}。${fact ? '据现场反馈，' + fact + '。' : ''}\n\n` +
               `从参展规模到观众构成，都能感受到${main}在${audience.label}中的影响力。主办方显然希望通过这次活动，传递出更加明确的品牌信号。`;
    },

    sectionKeyReleases({ main, secondary, style, audience, fact }) {
        return `活动中最受关注的发布内容，毫无疑问与${main}相关。${fact ? '具体而言，' + fact + '。' : ''}\n\n` +
               `这一发布释放了多个层面的信息：产品层面展示了技术实力，市场层面强化了竞争姿态，而用户层面则进一步拉高了期待。对于${audience.label}来说，这些都是值得记录的关键信号。`;
    },

    sectionKeyViews({ main, secondary, style, audience, fact }) {
        return `在本次专访中，${main}围绕多个议题表达了自己的核心观点。${fact ? '他/她提到，' + fact + '。' : ''}\n\n` +
               `这些观点并非泛泛而谈，而是建立在对行业长期观察的基础上。${style.howEvaluate}地说，${main}对${secondary || '技术趋势'}的判断具有较强的参考价值，尤其是其关于${audience.careAbout}的论述，值得反复品味。`;
    },

    sectionDialogue({ main, secondary, style, audience, fact }) {
        return `采访过程中，我们也向${main}抛出了一些更具挑战性的问题。${fact ? '对此，他/她回应称，' + fact + '。' : ''}\n\n` +
               `从回答中可以感受到，${main}对${secondary || '行业现状'}有着清醒的认识。既承认发展过程中的不确定性，也表达了对长期方向的信心。这种坦诚而克制的表达，让整个对话更具说服力。`;
    },

    sectionSteps({ main, secondary, style, audience, fact, idx }) {
        const stepNum = idx + 1;
        return `### 第${stepNum}步：${this.randomPick(['准备工作','核心设置','关键配置','进阶调整','效果验收'])}\n\n` +
               `在使用${main}时，${style.howDescribe}地完成这一步至关重要。${fact ? '注意，' + fact + '。' : ''}\n\n` +
               `操作路径并不复杂：首先确认${secondary || '当前环境'}是否符合要求；然后按照界面提示逐步完成；最后检查输出结果是否符合预期。对于${audience.label}来说，熟悉这个流程后，后续使用会顺畅很多。`;
    },

    sectionTips({ main, secondary, style, audience, fact, idx }) {
        return `### 进阶技巧 ${idx - 2}\n\n` +
               `当你已经熟悉${main}的基础操作后，可以尝试一些进阶用法。${fact ? '比如，' + fact + '。' : ''}\n\n` +
               `这类技巧的核心在于：用更少的操作达成更高的效率。${style.howEvaluate}来看，熟练掌握后，${main}能够真正成为${audience.label}日常工作流中的得力工具。`;
    },

    sectionPhenomenon({ main, secondary, style, audience, fact }) {
        return `${main}之所以引发关注，并非偶然。${fact ? '从现象层面看，' + fact + '。' : ''}\n\n` +
               `这一事件/产品之所以值得讨论，是因为它触及了${audience.label}普遍关心的议题：${secondary || '技术进步与商业落地'}之间的关系。理解现象本身，是进一步分析的前提。`;
    },

    sectionReasons({ main, secondary, style, audience, fact }) {
        return `为什么${main}会在此时引发关注？${fact ? '一个关键原因是，' + fact + '。' : ''}\n\n` +
               `更深一层来看，这与${secondary || '产业周期'}、政策环境、以及用户需求的共同作用密不可分。${style.howEvaluate}地分析，${main}的出现既是偶然，也是必然——它是多重变量交汇后的结果。`;
    },

    sectionTrends({ main, secondary, style, audience, fact }) {
        return `展望未来，${main}所代表的${secondary || '这一趋势'}可能会继续演化。${fact ? '从趋势判断看，' + fact + '。' : ''}\n\n` +
               `对于${audience.label}来说，与其追逐短期热点，不如关注长期信号。${main}的真正价值，或许不在于它现在做了什么，而在于它打开了一个怎样的可能性空间。`;
    },

    sectionProducts({ main, secondary, style, audience, fact }) {
        return `本次对比评测选取了几款与${main}直接相关的产品。${fact ? '从产品信息看，' + fact + '。' : ''}\n\n` +
               `这些产品在${secondary || '定位'}上存在明显差异，有的在性能上激进，有的在体验上细腻，还有的在价格上更具吸引力。下文将从统一标准出发，逐一剖析。`;
    },

    sectionKeyPoints({ main, secondary, style, audience, fact }) {
        return `关于${main}的最新动态，有几个关键信息需要梳理。${fact ? '首先，' + fact + '。' : ''}\n\n` +
               `其次，这一事件对${secondary || '相关产业链'}的影响不容忽视。对于${audience.label}而言，快速抓住核心要点，比沉浸在碎片化信息中更有价值。`;
    },

    sectionDetails({ main, secondary, style, audience, fact }) {
        return `进一步还原事件细节，有助于我们更准确地理解${main}。${fact ? '据悉，' + fact + '。' : ''}\n\n` +
               `这些细节共同勾勒出事件的全貌。虽然部分信息仍有待确认，但已经足够${audience.label}形成初步判断，并关注后续进展。`;
    },

    sectionTech({ main, secondary, style, audience, fact }) {
        return `技术层面的拆解，是理解${main}的关键。${fact ? '从技术架构看，' + fact + '。' : ''}\n\n` +
               `这种技术路径的选择，既反映了研发团队对${secondary || '用户体验'}的理解，也体现了对${audience.careAbout}的取舍。${style.howEvaluate}地说，${main}在技术实现上走的是一条稳健而务实的路线。`;
    },

    sectionMarketStructure({ main, secondary, style, audience, fact }) {
        return `${main}所处的市场格局正在发生变化。${fact ? '数据显示，' + fact + '。' : ''}\n\n` +
               `在这个格局中，头部玩家巩固优势，新进入者寻找缝隙，而${audience.label}则成为各方争夺的关键变量。${main}能否在这一格局中占据一席之地，取决于它能否持续创造差异化价值。`;
    },

    sectionGeneric({ sectionName, main, secondary, style, audience, fact, idx }) {
        return `谈到${sectionName}，${main}的表现值得专门讨论。${fact ? '具体而言，' + fact + '。' : ''}\n\n` +
               `这一部分的观察重点在于：${secondary || '产品体验'}是否与${audience.label}的预期匹配。${style.howEvaluate}来看，${main}在${sectionName}上的表现符合其定位，同时也留下了进一步优化的空间。`;
    },

    writeConclusion({ typeConfig, style, audience, language, main, secondary, keywords, sourceFacts, extraInstructions }) {
        const conclusion = typeConfig.conclusion(main, secondary, keywords, audience);
        return `## 总结\n\n` + conclusion;
    },

    // ========== v3 新增方法 ==========

    /** 引言（使用真实产品信息） */
    writeIntroNew({ typeConfig, style, audience, main, company, source, extraInstructions }) {
        const product = (source && source.product) || main;
        const comp = (source && source.company) || '';
        const date = (source && source.date) || '';

        if (typeConfig.type === 'release') {
            return date
                ? `${date}，${comp}正式推出${product}。作为面向${audience.label}的一款产品，它的发布引发了行业内外的广泛关注。本文将第一时间从${typeConfig.sections.slice(0,3).join('、')}等维度，为你梳理${product}的核心亮点与潜在价值。`
                : `日前，${comp ? comp + '推出' : ''}${product}的消息引发了${audience.label}的广泛关注。从产品定位到具体配置，${product}试图用一系列创新重新定义市场预期。让我们一起来看看，这次发布究竟带来了什么。`;
        }
        if (typeConfig.type === 'review') {
            return `在${audience.label}的期待中，${product}终于在近期与我们见面。${comp ? '作为' + comp + '旗下的重磅产品，' : ''}${product}在${typeConfig.sections.slice(0,3).join('、')}等方面拿出了怎样的表现？经过一段时间的深入体验，本文带来客观、真实的深度解析。`;
        }
        if (typeConfig.type === 'analysis') {
            return `${product}的出现，让${audience.label}看到了新的可能。本文从${typeConfig.sections.slice(0,3).join('、')}三个层面深入分析，探讨其背后的技术逻辑与市场意义。`;
        }
        return `${product}值得关注。以下是关于它的详细${typeConfig.label}。`;
    },

    /** 结论（使用真实产品信息） */
    writeConclusionNew({ typeConfig, style, audience, main, company, source, extraInstructions }) {
        const product = (source && source.product) || main;
        if (typeConfig.type === 'release') {
            return `## 总结\n\n${product}的发布是${company || '品牌'}在影像创作领域持续投入的又一次体现。对于${audience.label}而言，${product}不仅提供了新的选择，也展示了技术迭代的切实方向。随着固件升级和后期支持的推进，${product}的实际价值将进一步释放。`;
        }
        if (typeConfig.type === 'review') {
            return `## 总结\n\n综合来看，${product}在多个维度上表现出了足够的诚意。对于${audience.label}而言，${product}是一个值得考虑的选择。关键在于明确自己的核心需求，找到产品与你使用场景的最佳契合点。`;
        }
        return `## 总结\n\n${product}代表了${company || '行业'}在这一赛道上的最新探索。它的真正价值，或许不在于现在做了什么，而在于它打开了一个怎样的可能性空间。`;
    },

    /** Step 4: 全文润色——清除所有残留模板变量和占位词 */
    polish(text, source) {
        let t = text;
        // 清除所有未替换的 ${xxx} 模板变量
        t = t.replace(/\$\{[^}]+\}/g, '');
        // 清除孤立的 "undefined" 或 "null"
        t = t.replace(/\bundefined\b/g, '').replace(/\bnull\b/g, '');
        // 如果有 source，替换通用占位词
        if (source && source.company) {
            t = t.replace(/\b公司\b(?!\S)/g, source.company);
            t = t.replace(/\b品牌\b(?!\S)/g, source.company);
        }
        if (source && source.product) {
            t = t.replace(/\b新品\b(?!\S)/g, source.product);
            t = t.replace(/\b产品\b(?!\S)/g, (match) => source.product || match);
        }
        // 清理多余空格和空行
        t = t.replace(/  +/g, ' ').replace(/\n{4,}/g, '\n\n\n');
        return t.trim();
    },

    /** 按目标字数调整：不够就扩展（补事实），超了就智能裁剪（优先整段→整句→半句续写） */
    adjustWordCount(text, target, source) {
        if (!target || target < 10) return text;
        const charCount = s => (s || '').replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').length;
        let count = charCount(text);
        const facts = source ? [...source.allFacts] : [];
        const hasHeadings = text.includes('\n## ');

        // ====== 扩展：不足目标，向「结语之前」补充改写后的事实（绝不堆在结尾） ======
        if (count < target * 0.75 && facts.length > 0) {
            const usedSet = new Set();
            // 按相关性排序扩展事实（优先匹配标题关键词）
            const titleWords = text.split('\n')[0].replace(/#/g, '').trim();
            facts.sort((a, b) => this._factRelevance(b, titleWords) - this._factRelevance(a, titleWords));

            const extraParas = [];
            for (const f of facts) {
                if (count >= target * 0.95) break;
                if (usedSet.has(f)) continue;
                if (text.includes(f.substring(0, 12))) continue;
                usedSet.add(f);
                // 改写后再用，不照抄
                const rewritten = this._paraphraseFact(f, source);
                if (rewritten && rewritten.length > 10) {
                    extraParas.push(rewritten);
                    count += charCount(rewritten);
                }
                if (extraParas.length >= 3) break; // 封顶3段，避免过度堆砌
            }
            if (extraParas.length > 0) {
                text = this._insertBeforeConclusion(text, extraParas.join('\n\n'), hasHeadings);
            }
        }

        // 若仍明显不足，补一段综合叙述（非照抄具体事实）
        if (count < target * 0.7 && source && source.product) {
            const padText = this._generatePadding(source, target - count);
            if (padText && padText.length > 10) {
                text = this._insertBeforeConclusion(text, padText, hasHeadings);
                count += charCount(padText);
            }
        }

        // ====== 裁剪：超过目标 130% ======
        if (count <= target * 1.3) return text.trim();

        if (hasHeadings) {
            // 结构化文章：优先删除完整章节
            const sections = text.split(/\n(?=## )/);
            // sections[0] 是引言（没有 ## 前缀），后面是各章节
            let kept = [];
            let keptCount = 0;
            const targetMax = target * 1.2;

            for (const sec of sections) {
                const secChars = charCount(sec);
                if (keptCount + secChars <= targetMax) {
                    kept.push(sec);
                    keptCount += secChars;
                } else {
                    // 最后一个可容纳的章节：尝试截取前半部分（到句子边界）
                    const sentences = sec.split(/(?<=[。！？])/);
                    let partial = '';
                    let partialCount = 0;
                    for (const sent of sentences) {
                        const sc = charCount(sent);
                        if (keptCount + partialCount + sc <= targetMax) {
                            partial += sent;
                            partialCount += sc;
                        } else {
                            break;
                        }
                    }
                    if (partial.trim().length > 20) {
                        kept.push(partial.trim());
                    }
                    break;
                }
            }

            if (kept.length > 0) {
                text = kept.join('\n').trim();
                count = charCount(text);
            }
        }

        // 非结构化文章 / 兜底：在句子边界裁剪
        while (count > target * 1.2) {
            // 找最后一个句子结束位置（。！？后跟换行或空格或字符串尾）
            const matches = [...text.matchAll(/[。！？]/g)];
            if (matches.length === 0) break;

            // 从后往前找，确保去掉足够的内容
            let cutPos = -1;
            let removedCount = 0;
            for (let i = matches.length - 1; i >= 0; i--) {
                const pos = matches[i].index + 1;
                const tail = text.substring(pos);
                removedCount = charCount(tail);
                if (count - removedCount <= target * 1.15) {
                    cutPos = pos;
                    break;
                }
            }

            // 如果裁一句不够，裁掉最后一个 \n\n 段的全部
            if (cutPos < 0) {
                const lastDbl = text.lastIndexOf('\n\n');
                if (lastDbl > 10) {
                    const tail = text.substring(lastDbl + 2);
                    removedCount = charCount(tail);
                    cutPos = lastDbl;
                } else {
                    break;
                }
            }

            if (cutPos > 0 && removedCount > 5) {
                text = text.substring(0, cutPos);
                count -= removedCount;
            } else {
                break;
            }
        }

        return text.trim();
    },

    /** 计算事实与标题/主题的相关度 */
    _factRelevance(fact, title) {
        if (!title) return 0;
        let score = 0;
        const twords = title.split('');
        for (let i = 0; i < twords.length - 1; i++) {
            if (fact.includes(twords[i] + (twords[i + 1] || ''))) score += 1;
        }
        return score;
    },

    /** 改写事实：先做词汇级同义替换打破逐字照抄，再换句式/连接词 */
    _paraphraseFact(fact, source, light = false) {
        if (!fact) return '';
        let t = fact.trim();
        // 去除已有标点结尾
        t = t.replace(/[。！？，,\.!?;；]+$/g, '').trim();
        if (t.length < 6) return t + '。';

        // 关键：词汇级同义替换，从根本上避免原句逐字保留
        t = this._applySynonyms(t);

        // 轻量模式（规格参数等）：只做句式微调，不加评价性后缀
        if (light) {
            const l = Math.floor(Math.random() * 3);
            if (l === 0 && t.includes('，')) {
                const parts = t.split(/[，,]/);
                if (parts.length >= 2) return parts.slice(1).join('，').trim() + '，' + parts[0].trim() + '。';
            }
            if (l === 1) {
                const now = source && source.date ? source.date : '官方信息';
                return now + '显示，' + t + '。';
            }
            return t + '。';
        }

        // 随机选择改写策略
        const strategy = Math.floor(Math.random() * 5);
        switch (strategy) {
            case 0: // 倒装/前置状语
                if (t.includes('，')) {
                    const parts = t.split(/[，,]/);
                    if (parts.length >= 2) {
                        return parts.slice(1).join('，').trim() + '，' + parts[0].trim() + '。';
                    }
                }
                return t + '，这进一步印证了相关趋势。';
            case 1: // 补充评价
                return t + '，从行业视角来看，这一变化值得持续关注。';
            case 2: // 因果转换
                if (/提升|增强|增加|增长|提高|扩大/.test(t)) {
                    return t.replace(/提升|增强|增加|增长|提高|扩大/g, '明显提升') + '，反映出积极的演进方向。';
                }
                return t + '，成为推动领域发展的重要因素。';
            case 3: // 对比视角
                return '相较于此前版本，' + t + '，带来了实质性的体验升级。';
            default: // 时间视角
                const now = source && source.date ? source.date : '近期';
                return now + '的信息显示，' + t + '。';
        }
    },

    /** 科技词汇同义替换表：用于改写事实，避免逐字照抄 */
    _applySynonyms(text) {
        const SYN = {
            '正式发布': '正式推出', '电影摄影机': '电影机', '分辨率': '清晰度',
            '电池容量': '电池', '机身重量': '整机重量', '新增': '加入', '支持': '具备',
            '提升': '增强', '优化': '改良', '升级': '迭代', '改进': '改善',
            '增加': '增添', '加入': '引入', '可以': '能够', '能够': '可',
            '允许': '支持', '发布': '推出', '录制': '拍摄', '像素': '画质',
            '性能': '表现', '功能': '能力', '实时': '即时', '跟踪': '追踪',
            '主体': '拍摄对象', '新品': '该机型', '产品': '设备', '公司': '厂商',
            '致力于': '深耕于', '覆盖': '囊括', '产品线': '产品矩阵', '领域': '赛道',
            '市场': '行业',
        };
        const keys = Object.keys(SYN).sort((a, b) => b.length - a.length);
        const re = new RegExp(keys.join('|'), 'g');
        return text.replace(re, m => SYN[m] || m);
    },

    /** 生成补充段落（不照抄事实，而是综合叙述） */
    _generatePadding(source, needChars) {
        const product = source.product || '';
        const company = source.company || '';
        const parts = [];
        if (needChars > 30 && product) {
            parts.push(product + '所展现的技术路线，反映了' + (company || '行业') + '在当前阶段的核心策略——即在创新与实用之间寻找最佳平衡点。');
        }
        if (needChars > 60 && company) {
            parts.push('对于' + company + '而言，' + (product || '持续迭代') + '不仅是产品线的丰富，更是技术积累向市场价值转化的关键一步。');
        }
        if (needChars > 90) {
            parts.push('展望未来，随着相关技术的不断成熟和应用场景的持续拓展，这一方向有望释放更大的市场潜力，值得行业参与者和用户共同期待。');
        }
        if (parts.length === 0) {
            parts.push('总体来看，这一进展为市场注入了新的活力，后续发展值得持续关注。');
        }
        return parts.join('\n\n');
    },

    /** 将补充段落插入到「结语/最后一段」之前，杜绝在结尾胡乱拼接尾巴 */
    _insertBeforeConclusion(text, para, hasHeadings) {
        if (!para) return text;
        if (hasHeadings) {
            const idx = text.lastIndexOf('## 总结');
            if (idx > 0) {
                const head = text.slice(0, idx).replace(/\s+$/, '');
                return head + '\n\n' + para + '\n\n' + text.slice(idx);
            }
        }
        const lastDbl = text.lastIndexOf('\n\n');
        if (lastDbl > 0) {
            const head = text.slice(0, lastDbl).replace(/\s+$/, '');
            return head + '\n\n' + para + text.slice(lastDbl);
        }
        return text + '\n\n' + para;
    },

    /** 归一化拼接产生的重复/粘连标点（如 。。 → 。，。； → ；），提升可读性且不改变事实 */
    _normalizePunctuation(text) {
        if (!text) return text;
        // 任意 2+ 连续的中文标点串折叠成最后一个，避免重复与粘连
        text = text.replace(/([。！？；，、：]){2,}/g, m => m.slice(-1));
        // 多个连续空格折叠为一个
        text = text.replace(/[ \t]{2,}/g, ' ');
        return text;
    },

    // ========== 配置表 ==========
    getTypeConfig(type) {
        const map = {
            review: {
                type: 'review', label: '数码评测', keyword: '新品',
                sections: ['外观设计', '性能体验', '功能亮点', '影像系统', '续航与充电', '系统与生态', '购买建议'],
                templates: ['${main}深度评测：值得入手吗？','上手${main}两周：这些体验值得一提','${main}评测：${secondary}加持下的表现如何？','旗舰新选择？${main}评测告诉你答案'],
                conclusion: (main, secondary, kws, audience) => `综合来看，${main}是一款定位清晰的产品。它在${secondary || '核心体验'}上拿出了足够诚意，同时在${kws[1] || '细节打磨'}方面也下了功夫。对于${audience.label}来说，如果${main}的售价和功能组合符合你的需求，那么它值得列入候选名单。当然，最终选择还是要结合自身使用场景，理性决策。`
            },
            release: {
                type: 'release', label: '新品发布', keyword: '新品',
                sections: ['产品亮点', '核心参数', '市场定位', '竞品对比', '未来趋势'],
                templates: ['${main}正式发布：${secondary}看点解析','${main}来了：这次发布释放了哪些信号？','${main}发布：能否搅动${secondary}市场？','一文看懂${main}发布会：${secondary}是最大亮点'],
                conclusion: (main, secondary, kws, audience) => `${main}的发布，标志着品牌在${secondary || '高端市场'}的又一次落子。对于${audience.label}而言，这款产品提供了新的选择，也可能倒逼竞品加快迭代节奏。最终能否赢得市场，还要看后续产能、价格、以及用户口碑的综合表现。`
            },
            event: {
                type: 'event', label: '活动报道', keyword: '活动',
                sections: ['活动概况', '重要发布', '现场亮点', '行业影响', '后续展望'],
                templates: ['${main}现场报道：科技行业的新风向标','${main}活动回顾：${secondary}最受关注','直击${main}：哪些信息值得${audience.label}关注？','${main}落幕：留下的不只是产品'],
                conclusion: (main, secondary, kws, audience) => `${main}落下帷幕，但它带来的影响仍在持续。对于${audience.label}来说，这场活动最大的价值在于：它让我们看到了${secondary || '行业'}下一阶段可能的发展方向。接下来，我们将持续关注相关产品的实际落地情况。`
            },
            interview: {
                type: 'interview', label: '人物专访', keyword: '人物',
                sections: ['核心观点', '深度对话', '行业洞察', '未来规划', '总结'],
                templates: ['专访${main}：${secondary}背后的思考','与${main}对话：科技人的理想与现实','${main}：${secondary}将迎来怎样的未来？','独家专访${main}：关于${secondary}的真实想法'],
                conclusion: (main, secondary, kws, audience) => `与${main}的对话，让我们看到了一个科技从业者对${secondary || '行业'}的真实态度。既不盲目乐观，也不过度悲观，这种理性务实的判断，正是${audience.label}所需要的声音。期待未来能看到更多来自${main}的思考与实践。`
            },
            exhibition: {
                type: 'exhibition', label: '新品展报', keyword: '展会',
                sections: ['活动概况', '现场亮点', '重要发布', '技术趋势', '观展总结'],
                templates: ['${main}展报：科技新品一网打尽','逛完${main}：这些产品让我印象深刻','${main}现场直击：${secondary}站上C位','${main}展后复盘：${audience.label}该关注什么？'],
                conclusion: (main, secondary, kws, audience) => `逛完${main}，最大的感受是：科技行业的创新仍在加速。对于${audience.label}来说，展会不仅是一场视觉盛宴，更是了解趋势、判断方向的好机会。${secondary || '这些新产品'}中，哪些会真正改变生活，值得我们持续关注。`
            },
            tutorial: {
                type: 'tutorial', label: '使用教程', keyword: '教程',
                sections: ['操作步骤', '操作步骤', '进阶技巧', '进阶技巧', '总结'],
                templates: ['${main}使用教程：从入门到精通','${main}使用指南：${audience.label}必看','手把手教你用好${main}：${secondary}轻松搞定','${main}高效使用技巧：${secondary}篇'],
                conclusion: (main, secondary, kws, audience) => `以上就是${main}的核心使用指南。对于${audience.label}来说，掌握这些技巧后，${main}将成为提升效率的有力工具。如果你在使用过程中遇到其他问题，欢迎在评论区交流，我们也会持续更新更多进阶玩法。`
            },
            opinion: {
                type: 'opinion', label: '行业观点', keyword: '行业',
                sections: ['现象概述', '深层原因', '多方观点', '趋势判断', '结论建议'],
                templates: ['${main}：${secondary}赛道的新变量','关于${main}：${audience.label}需要知道什么','${main}背后的逻辑：${secondary}不只是一阵风','${main}现象：科技行业的长期主义考验'],
                conclusion: (main, secondary, kws, audience) => `回到最初的问题：${main}究竟意味着什么？答案可能因人而异。但可以确定的是，它代表了${secondary || '行业'}的一种新可能。对于${audience.label}来说，保持开放、理性观察，比急于下结论更重要。`
            },
            comparison: {
                type: 'comparison', label: '对比评测', keyword: '对比',
                sections: ['参评产品', '外观设计', '性能体验', '功能亮点', '购买建议'],
                templates: ['${main}对比评测：哪款更值得买？','横向对比：${main} vs ${secondary}谁更强？','${main}选购指南：${audience.label}怎么选？','${main}深度对比：${secondary}差距有多大？'],
                conclusion: (main, secondary, kws, audience) => `通过横向对比可以看出，${main}这一细分市场中并不存在绝对完美的选择。不同产品各有侧重，适合的人群也不尽相同。对于${audience.label}来说，明确自己的核心需求，比盲目追求参数更重要。希望这篇对比评测，能为你的决策提供参考。`
            },
            news: {
                type: 'news', label: '科技快讯', keyword: '资讯',
                sections: ['新闻要点', '事件详情', '行业影响', '后续关注', '总结'],
                templates: ['${main}：${secondary}最新进展','${main}最新动态：${audience.label}速览','${main}消息传出：对${secondary}有何影响？','${main}：值得关注的新动向'],
                conclusion: (main, secondary, kws, audience) => `以上就是关于${main}的最新情况。对于${audience.label}来说，这一事件值得保持关注，因为它可能对${secondary || '相关市场'}产生持续影响。我们也将持续跟踪后续进展，第一时间带来更新。`
            },
            analysis: {
                type: 'analysis', label: '深度分析', keyword: '分析',
                sections: ['背景介绍', '技术解析', '市场格局', '竞争态势', '未来趋势'],
                templates: ['${main}深度分析：${secondary}格局将如何演变？','${main}：一场关于${secondary}的长期较量','深度解读${main}：${audience.label}不可忽视的变量','${main}：从现象到本质的拆解'],
                conclusion: (main, secondary, kws, audience) => `总结来看，${main}的影响不会局限于一两个产品或事件。它背后反映的是${secondary || '行业'}更深层的结构性变化。对于${audience.label}来说，理解这种变化，有助于在未来的决策中占据更主动的位置。`
            },
        };
        return map[type] || map.review;
    },

    getStyleConfig(style) {
        const map = {
            professional: { type: 'professional', howDescribe: '克制而专业', howEvaluate: '客观' },
            lively: { type: 'lively', howDescribe: '活泼有趣', howEvaluate: '轻松' },
            marketing: { type: 'marketing', howDescribe: '极具吸引力', howEvaluate: ' marketing' },
            technical: { type: 'technical', howDescribe: '技术导向', howEvaluate: '技术' },
            storytelling: { type: 'storytelling', howDescribe: '故事化', howEvaluate: '叙事' },
            concise: { type: 'concise', howDescribe: '简洁', howEvaluate: '简洁' },
        };
        return map[style] || map.professional;
    },

    getAudienceConfig(audience) {
        const map = {
            tech_fans: { label: '数码爱好者', careAbout: '参数与细节', useScenario: '发烧级使用和深度测试' },
            general: { label: '普通消费者', careAbout: '易用性和实用价值', useScenario: '日常生活和办公' },
            experts: { label: '行业专家', careAbout: '技术深度和商业逻辑', useScenario: '专业研究与分析' },
            investors: { label: '投资者', careAbout: '市场前景与回报', useScenario: '投资决策与风险评估' },
            developers: { label: '开发者', careAbout: '开发体验与生态', useScenario: '项目开发与工具集成' },
        };
        return map[audience] || map.tech_fans;
    },

    getLanguageConfig(language) {
        const map = {
            zh_professional: { value: 'zh_professional', label: '中文·专业', lang: 'zh', instruction: '请使用专业、规范、书面化的中文表达。' },
            zh_casual: { value: 'zh_casual', label: '中文·口语化', lang: 'zh', instruction: '请使用口语化、轻松自然的中文表达，像朋友聊天一样。' },
            zh_literary: { value: 'zh_literary', label: '中文·文艺', lang: 'zh', instruction: '请使用文艺、优美、有画面感和节奏感的中文表达。' },
            en_professional: { value: 'en_professional', label: 'English·Professional', lang: 'en', instruction: 'Please write the entire article in English, using professional, formal, and polished language. The output should be in English only, except for necessary brand/product names. Ensure natural English expression suitable for a professional tech publication.' },
        };
        return map[language] || map.zh_professional;
    },

    extractKeyword(sentence) {
        const common = ['芯片','手机','半导体','AI','人工智能','电动车','新能源','发布会','科技','产品','市场','公司','技术','5G','存储'];
        for (const kw of common) { if (sentence.includes(kw)) return kw; }
        return '行业';
    },

    randomPick(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    },

    delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); },

    /**
     * 将文本按段落裁剪到目标字符数（仅计中英文+数字），避免单篇生成结果远超用户设定的目标字数。
     * 尽量保留完整段落；如果必须截断，保留前面完整的段落，并在最后一段内按句子边界截断，避免丢掉后续章节。
     */
    _fitToCharCount(text, target) {
        if (!target || target < 50) return text;
        const upper = Math.round(target * 1.15);
        const charCount = (s) => ((s || '').match(/[一-龥a-zA-Z0-9]/g) || []).length;

        // 文末「参考来源 / References」小节整体保留，不参与字数截断（避免被夹断丢失引用列表）
        const refIdx = text.search(/\n#{1,4}\s*(参考来源|References|参考链接|Sources|引用来源)\b|\n(参考来源|References|参考链接|Sources|引用来源)\s*[:：]/);
        let body = text, refBlock = '';
        if (refIdx >= 0) {
            body = text.slice(0, refIdx);
            refBlock = text.slice(refIdx).replace(/^\n+/, '');
        }

        if (charCount(body) <= upper) {
            return (body.trim() + (refBlock ? '\n\n' + refBlock : '')).trim();
        }

        const paragraphs = body.split(/\n\s*\n/);
        let acc = 0;
        let trimAt = -1; // 需要截断的段落索引
        for (let i = 0; i < paragraphs.length; i++) {
            acc += charCount(paragraphs[i]);
            if (acc > upper && trimAt < 0) {
                trimAt = i;
                break;
            }
        }
        if (trimAt < 0) return (body.trim() + (refBlock ? '\n\n' + refBlock : '')).trim(); // 所有段落都未超出上限
        if (trimAt === 0) trimAt = 1; // 至少保留一段

        // 前面完整保留的段落
        const kept = paragraphs.slice(0, trimAt);
        const keptCount = kept.reduce((sum, p) => sum + charCount(p), 0);
        const remaining = upper - keptCount;

        // 最后一段若仍超出剩余预算，按句子边界截断
        const last = paragraphs[trimAt] || '';
        if (remaining > 0 && charCount(last) > remaining) {
            const sentences = last.split(/([。！？.?!]\s*)/);
            let sacc = 0, skeepUntil = sentences.length;
            for (let i = 0; i < sentences.length; i += 2) {
                const c = charCount(sentences[i]);
                if (sacc + c > remaining && skeepUntil === sentences.length) { skeepUntil = i; break; }
                sacc += c;
            }
            if (skeepUntil > 0) {
                const trimmedLast = sentences.slice(0, skeepUntil).join('').trim();
                if (trimmedLast) kept.push(trimmedLast);
            }
        }
        const fittedBody = kept.join('\n\n').trim() || body;
        return (fittedBody + (refBlock ? '\n\n' + refBlock : '')).trim();
    },

    /**
     * 按语言估算合适的 max_tokens，从源头抑制「先生成上千字再夹断」的现象。
     * 中文约 1 字符/token；英文约 4 字符/token。预留约 15% 结构开销。
     */
    _estimateMaxTokens(form) {
        const lang = this.getLanguageConfig(form.language);
        const wordCount = parseInt(form.wordCount, 10) || 800;
        const est = lang.lang === 'en' ? Math.round(wordCount * 0.7) : Math.round(wordCount * 1.8);
        return Math.min(Math.max(est, 100), 8192);
    },

    /** 打字机式逐字揭示：把已生成的文本分块回调给 onToken，营造流式输出观感（本地兜底/非流式上游使用） */
    async _reveal(content, onToken, title = '') {
        if (!onToken) return;
        const chars = [...content];
        let acc = '';
        for (let i = 0; i < chars.length; i += 3) {
            acc += (chars[i] || '') + (chars[i + 1] || '') + (chars[i + 2] || '');
            onToken({ title, content: acc });
            await new Promise(r => setTimeout(r, 14));
        }
        onToken({ title, content });
    },

    // ========== API 生成（预留） ==========
    async generateViaDeepSeek(form, onToken) {
        const prompt = this.buildPrompt(form);
        const resp = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.config.deepseekKey },
            body: JSON.stringify({ model: this.config.deepseekModel, messages: [{ role: 'user', content: prompt }], temperature: 0.8, max_tokens: this._estimateMaxTokens(form) }),
            signal: AbortSignal.timeout(60000),
        });
        if (!resp.ok) throw new Error('API 请求失败: ' + resp.status);
        const data = await resp.json();
        const result = this.parseApiResponse(data.choices[0].message.content);
        result.content = this._fitToCharCount(result.content, form.wordCount);
        if (onToken) await this._reveal(result.content, onToken, result.title);
        return result;
    },

    async generateViaOpenAI(form, onToken) {
        const prompt = this.buildPrompt(form);
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.config.openaiKey },
            body: JSON.stringify({ model: this.config.openaiModel, messages: [{ role: 'user', content: prompt }], temperature: 0.8, max_tokens: this._estimateMaxTokens(form) }),
            signal: AbortSignal.timeout(60000),
        });
        if (!resp.ok) throw new Error('API 请求失败: ' + resp.status);
        const data = await resp.json();
        const result = this.parseApiResponse(data.choices[0].message.content);
        result.content = this._fitToCharCount(result.content, form.wordCount);
        if (onToken) await this._reveal(result.content, onToken, result.title);
        return result;
    },

    buildPrompt(form) {
        const typeConfig = this.getTypeConfig(form.type);
        const style = this.getStyleConfig(form.style);
        const audience = this.getAudienceConfig(form.audience);
        const lang = this.getLanguageConfig(form.language);
        const isEnglish = lang.lang === 'en';
        const wordCount = parseInt(form.wordCount, 10) || 800;
        const maxBodyChars = Math.round(wordCount * 1.2);
        const styleMap = {
            professional: '专业客观',
            lively: '活泼轻松',
            marketing: '营销推广',
            technical: '技术硬核',
            storytelling: '叙事故事',
            concise: '简洁明了',
        };
        const styleLabel = styleMap[style.type] || style.type;

        let prompt = '';
        const minChars = Math.round(wordCount * 0.85);
        if (isEnglish) {
            prompt += `Write a ${typeConfig.label} style tech article for a professional tech publication.\n`;
            prompt += `Title: ${form.title || 'Please generate an engaging title based on the content'}\n`;
            prompt += `Target length: the body must be approximately ${wordCount} characters of actual text (excluding title, punctuation, spaces, and Markdown markers). You must meet this target within a ±15% tolerance, i.e. between ${minChars} and ${maxBodyChars} characters. Expand each section with sufficient detail; do not write only one or two sentences per section.\n`;
            prompt += `Writing style: ${styleLabel}. The language should flow naturally, with well-structured paragraphs, like a finished piece from a professional tech media outlet.\n`;
            prompt += `Target audience: ${audience.label}\n`;
            if (form.keywords) prompt += `Core keywords: ${form.keywords}\n`;
            if (form.template) prompt += `Reference template:\n${form.template}\n`;
            if (form.extraInstructions) prompt += `Additional requirements: ${form.extraInstructions}\n`;
            prompt += `Language requirement: ${lang.instruction}\n`;
        } else {
            prompt += `请撰写一篇${typeConfig.label}类型的科技文章。\n`;
            prompt += `标题：${form.title || '请根据内容生成一个吸引人的标题'}\n`;
            prompt += `目标字数：正文必须控制在约 ${wordCount} 字（不含标题、标点、空格、Markdown 标记）。必须达到该目标，允许 ±15% 偏差，即 ${minChars}-${maxBodyChars} 字。每个章节段落都要充分展开，不要只写一两句话。\n`;
            prompt += `写作风格：${styleLabel}，要求语言流畅、段落自然、像专业科技媒体发布的成品文章\n`;
            prompt += `目标读者：${audience.label}\n`;
            if (form.keywords) prompt += `核心关键词：${form.keywords}\n`;
            if (form.template) prompt += `参考模板：\n${form.template}\n`;
            if (form.extraInstructions) prompt += `额外要求：${form.extraInstructions}\n`;
            prompt += `语言要求：${lang.instruction}\n`;
        }

        if (form.content && form.content.length > 50) {
            if (isEnglish) {
                prompt += `\nBelow is YOUR OWN draft (the MAIN SUBJECT). Treat it as the spine of the article — rewrite it in a natural, human-editor voice, keeping its core facts, opinions and narrative flow. Do NOT just chop it up and pad with generic filler.\nFORBIDDEN: hollow openers ("In today's...", "With the rapid development of..."), template phrases ("First... Second... Finally", "In conclusion", "It is worth mentioning"), and mechanically breaking it into one-line bullet points. Write like a real columnist with natural transitions; never invent facts.\nDraft:\n${form.content.substring(0, 3000)}\n`;
            } else {
                prompt += `\n以下是**你自己写的主体草稿（核心素材）**，请把它当作文章的骨架：用自然、像真人编辑一样的口吻重写，保留原文的核心事实、观点与叙事脉络，不要丢点、不要臆造。\n【严禁 AI 套话】禁止以下写法：用「在当今……」「随着……的快速发展」「近年来……」等空泛开场；用「首先……其次……最后……」「总而言之」「值得一提的是」「不可否认」等模板词；把原文硬拆成要点罗列、每段只用一两句空话填字数。要像专栏随笔/真实媒体成稿，有起承转合、过渡自然。\n草稿正文：\n${form.content.substring(0, 3000)}\n`;
            }
        }

        // 来源与引用：URL 正文由服务端抓取（或联网自动检索）后注入 prompt，这里只给模型预习规则
        const hasSources = (form.sources && form.sources.trim()) || form.webSearch;
        if (hasSources) {
            const srcList = (form.sources && form.sources.trim())
                ? form.sources.split(/[\n,，;；]+/).map(s => s.trim()).filter(Boolean).slice(0, 12)
                : [];
            if (srcList.length) {
                const srcText = srcList.map((s, i) => `${i + 1}. ${s}`).join('\n');
                if (isEnglish) {
                    prompt += `\nREFERENCE LITERATURE (to be fetched and appended at the end of this prompt, numbered [1], [2]...):\n${srcText}\n\n- The appended web texts are your REFERENCE LITERATURE. Any verifiable fact — specs, figures, prices, release dates, quotes, test results — MUST be grounded in these references and tagged with the matching [1]/[2] citation at the end of the sentence.\n- The draft above is the MAIN SUBJECT and is NOT a citable source; it will not appear in the reference list.\n- When the draft and a reference disagree, follow the reference and you may naturally note the difference.\n- If a fact cannot be verified from the references, mark it [?] or omit it.\n- ABSOLUTELY FORBIDDEN: fabricating specifications, model numbers, data, prices, release dates, test results, quotes, or URLs.\n- Stay within the length limit; do not add a separate references section.\n`;
                } else {
                    prompt += `\n以下为**参考文献**（系统会在本提示词末尾抓取正文并补充进来，编号 [1]、[2]…；若已开启联网搜索，则包含系统自动从网络检索到的真实参数/数据）：\n${srcText}\n\n- 抓取到的网页正文是你的**参考文献**。凡是可核实的事实——规格参数、数据、价格、发布日期、引语、测试结果等——必须以参考文献为准，并在句末用对应的 [1]、[2] 编号标注来源；请优先用其中的真实数据充实文章。\n- 上方草稿是**主体内容**，本身**不作为引用来源**，也不会出现在来源列表里。\n- 若草稿与参考文献冲突，以参考文献为准，可在文中自然点出差异。\n- 如果某条信息无法从参考文献中确认，请在该句末尾标注 [?]，或直接省略。\n- 绝对禁止：捏造任何规格参数、硬件型号、数据、价格、发布日期、测试结果、引语或链接。\n- 严格把篇幅控制在字数要求内，不要额外追加「参考来源」小节。\n`;
                }
            } else {
                // 仅开启联网搜索（未填 URL）：直接告知参考文献将由系统自动检索
                if (isEnglish) {
                    prompt += `\nREFERENCE LITERATURE will be auto-retrieved from the web by the system and appended at the end of this prompt, numbered [1], [2]... Use those real specs/figures/data as your references and tag them inline.\n- The draft above is the MAIN SUBJECT and is NOT a citable source.\n- ABSOLUTELY FORBIDDEN: fabricating specifications, model numbers, data, prices, release dates, test results, quotes, or URLs.\n`;
                } else {
                    prompt += `\n系统将自动从网络检索真实参数/数据，作为**参考文献**补充到本提示词末尾，编号 [1]、[2]…。请基于这些真实数据写作，并在句末用对应编号标注来源；请优先用其中的真实参数/数据充实文章。\n- 上方草稿是**主体内容**，本身**不作为引用来源**。\n- 绝对禁止：捏造任何规格参数、硬件型号、数据、价格、发布日期、测试结果、引语或链接。\n`;
                }
            }
        } else {
            // 没有附加来源时：仍以真人口吻重写，且不得杜撰
            if (isEnglish) {
                prompt += `\nNo external references were provided. The draft above is your only material. Rewrite it in your own human voice; do not invent specifications, data, prices, release dates, test results, quotes, or URLs.\n`;
            } else {
                prompt += `\n未提供外部参考文献，上方草稿是你唯一的素材。请用你自己的、像真人一样的口吻重写；不要捏造任何规格参数、硬件型号、数据、价格、发布日期、测试结果、引语或链接。\n`;
            }
        }

        // 通用「去 AI 味」硬性要求（无论是否提供原文、原文长短都生效）
        if (isEnglish) {
            prompt += `\nWRITING TONE (hard rules): Write like a real human columnist. NEVER open with hollow era-phrases ("In today's...", "With the rapid development of...", "In recent years..."). NEVER use template filler ("First... Second... Finally", "In conclusion", "It is worth mentioning", "It goes without saying"). Avoid mechanically bullet-listing one-line padding. Use natural transitions; never invent facts.\n`;
        } else {
            prompt += `\n【去 AI 味·硬性要求】像真人编辑/专栏作者一样写作。禁止用「在当今……」「随着……的快速发展」「近年来……」等空泛时代开场；禁止「首先……其次……最后……」「总而言之」「值得一提的是」「不可否认」「众所周知」等模板词；不要把内容硬拆成要点罗列、用一两句空话填字数。要有真实的人味与起承转合，绝不臆造事实。\n`;
        }

        if (form.plain) {
            if (isEnglish) {
                prompt += `\nOutput format: Markdown. The first line should be the title (# Title). The rest should be a continuous essay-style body without ## subheadings and without bullet lists. Tone natural, like a column essay. Do not mechanically list points.`;
            } else {
                prompt += `\n输出要求：用 Markdown 格式，第一行为标题（# 标题），之后写成一篇连贯的、不分 ## 小标题、不用分点列表的散文式正文（仍可保留一个 # 大标题）。语气自然、像专栏随笔，不要机械地罗列要点。`;
            }
        } else {
            if (isEnglish) {
                prompt += `\nOutput format: Markdown. The first line should be the title (# Title). The body should be complete, using ## subheadings to divide sections (e.g. Introduction, Core Specs, Market Positioning, Conclusion). The article should have an introduction, sub-arguments, transitions, and a conclusion, like a real tech media article.`;
            } else {
                prompt += `\n输出要求：用 Markdown 格式，第一行为标题（# 标题），之后是完整的正文，使用 ## 二级标题划分章节（如 引言、核心参数、市场定位、总结等）。文章要有引言、分论点、过渡句和结论，像真正的科技媒体文章。`;
            }
        }
        return prompt;
    },

    parseApiResponse(text) {
        const lines = text.trim().split('\n');
        let title = lines[0].replace(/^#+\s*/, '').trim();
        let content = lines.slice(1).join('\n').trim();
        if (!content) content = text;
        return { title, content };
    },

    /**
     * AI 生成 PPT 大纲
     * 分析内容结构，提取逻辑章节和要点，生成可编辑的结构化大纲
     * @param {Object} form - { title, content, keywords, type, style, wordCount }
     * @returns {Array} slides - [{ title, points }]
     */
    generatePPTOutline(form) {
        const text = form.content || '';
        const title = form.title || '';

        // 提取原文中的所有句子和段落
        const paragraphs = text.split(/\n\n+/).filter(p => p.trim());
        const allLines = text.split(/\n+/).filter(l => l.trim());

        // 第一步：提取原文中已有的标题作为章节候选
        const headingLines = allLines.filter(l => /^#{1,3}\s/.test(l));
        const rawHeadings = headingLines.map(h => h.replace(/^#{1,3}\s*/, '').trim()).filter(h => h.length > 2 && h.length < 50);

        // 第二步：如果原文没有足够标题，AI 自动生成章节结构
        let chapters = [];

        if (rawHeadings.length >= 3) {
            // 原文有足够的标题，直接使用
            chapters = rawHeadings.map(h => ({
                title: h,
                points: []
            }));

            // 为每个章节分配内容（标题后的段落作为要点）
            let currentCh = -1;
            for (const line of allLines) {
                const t = line.trim();
                if (/^#{1,3}\s/.test(t)) {
                    const ht = t.replace(/^#{1,3}\s*/, '').trim();
                    const idx = rawHeadings.indexOf(ht);
                    if (idx >= 0) currentCh = idx;
                } else if (currentCh >= 0) {
                    const clean = t.replace(/^[-*•]\s*/, '').replace(/^\d+[\.\、\)]\s*/, '');
                    if (clean.length > 5 && chapters[currentCh].points.length < 6) {
                        chapters[currentCh].points.push(clean);
                    }
                }
            }
        } else {
            // AI 生成章节结构
            const keywords = this.extractKeywords(text);
            const topic = title || keywords.slice(0, 3).join('、') || '科技数码';

            // 确定章节模板
            const typeTemplates = {
                '产品发布': ['产品背景与市场定位', '核心功能与技术创新', '产品优势与竞品对比', '用户体验与应用场景', '发布计划与行业影响'],
                '技术方案': ['背景与痛点分析', '技术架构设计', '核心实现方案', '性能与可靠性', '落地部署与未来规划'],
                '行业报告': ['行业现状概述', '市场规模与趋势', '竞争格局分析', '关键驱动因素', '前景展望与建议'],
                '默认': ['背景与概述', '核心内容要点', '关键技术与突破', '应用场景与实践', '总结与展望']
            };

            let typeKey = '默认';
            if (form.type === 'product' || form.type === 'release') typeKey = '产品发布';
            else if (form.type === 'tech' || form.type === 'analysis') typeKey = '技术方案';
            else if (form.type === 'report') typeKey = '行业报告';

            const tmpl = typeTemplates[typeKey] || typeTemplates['默认'];

            chapters = tmpl.map(t => ({
                title: t.replace('产品', topic.substring(0, 6)).replace('行业', topic.substring(0, 6)),
                points: []
            }));

            // 从原文提取事实性句子分配到各章节
            const facts = this.extractFacts(text);
            const perCh = Math.max(1, Math.floor(facts.length / chapters.length));
            chapters.forEach((ch, i) => {
                const start = i * perCh;
                const end = start + perCh;
                const pts = facts.slice(start, end);
                // 如果事实不够，AI 生成补充要点
                if (pts.length < 2) {
                    const generated = this.generateOutlinePoints(ch.title, topic, 3 - pts.length);
                    pts.push(...generated);
                }
                ch.points = pts.map(p => this.trimPoint(p)).filter(p => p.length > 3).slice(0, 5);
            });
        }

        // 后处理：精简标题、去空、确保每章至少1个要点
        const result = chapters
            .map(ch => ({
                title: this.condenseOutlineTitle(ch.title),
                points: ch.points.filter(p => p.trim().length > 3)
            }))
            .filter(ch => ch.points.length > 0 || ch.title.length > 2);

        return result;
    },

    /** 提取关键词 */
    extractKeywords(text) {
        const kwPatterns = [
            /AI|人工智能|大模型|GPT|Claude|DeepSeek|智能体/g,
            /芯片|半导体|算力|GPU|CPU|NVIDIA|英特尔|AMD/g,
            /手机|iPhone|华为|小米|三星|OPPO|vivo/g,
            /新能源|电动车|电池|固态电池|充电/g,
            /互联网|电商|社交|视频|直播/g,
            /机器人|自动驾驶|智能/g,
            /国产|供应链|国产替代/g,
        ];
        const all = [];
        for (const p of kwPatterns) {
            const matches = text.match(p);
            if (matches) all.push(...matches);
        }
        return [...new Set(all)];
    },

    /** 生成补充要点 */
    generateOutlinePoints(title, topic, count) {
        const templates = [
            `${topic}领域的最新进展与趋势分析`,
            `核心技术创新带来的突破性变化`,
            `对比传统方案的优势与提升空间`,
            `典型应用场景与实际案例解读`,
            `面向未来的发展方向与规划`,
            `行业内外的响应与评价`,
            `关键技术指标的量化对比`,
            `生态系统与产业链的协同效应`,
        ];
        const result = [];
        const start = Math.floor(Math.random() * 3);
        for (let i = 0; i < count; i++) {
            result.push(templates[(start + i) % templates.length]);
        }
        return result;
    },

    /** 提取事实性句子（不截断长句） */
    extractFacts(text) {
        const sentences = text.split(/[。；\n]+/).map(s => s.trim()).filter(s => s.length > 10 && s.length < 200);
        const scored = sentences.map(s => {
            let score = 1;
            if (/\d+/.test(s)) score += 2;
            if (/%|倍|亿|万/.test(s)) score += 2;
            if (/AI|人工智能|大模型|芯片|手机|新能源|互联网/.test(s)) score += 2;
            if (s.length > 30) score += 1;
            return { s, score };
        });
        scored.sort((a, b) => b.score - a.score);
        return scored.map(x => x.s).slice(0, 30);
    },

    /** 精简要点（只清理首尾标点，不截断） */
    trimPoint(p) {
        return p.replace(/^[，,、。\s]+/, '').replace(/[，,、。\s]+$/, '').trim();
    },

    /** 精简章节标题 */
    condenseOutlineTitle(title) {
        return title
            .replace(/^关于\s*/, '')
            .replace(/以及/g, '/')
            .replace(/\s+/g, ' ')
            .trim();
    }
};
