/**
 * AIGenerator - AI 文案生成引擎
 * 当前版本：基于模板的智能生成（预留 DeepSeek/OpenAI API 接口）
 */

const AIGenerator = {
    // API 配置（填入 Key 即可启用真实 AI）
    config: {
        provider: 'deepseek', // 'deepseek' | 'openai' | 'local'
        deepseekKey: '',      // 填入 DeepSeek API Key
        deepseekModel: 'deepseek-chat',
        openaiKey: '',        // 填入 OpenAI API Key
        openaiModel: 'gpt-4o-mini',
    },

    /**
     * 主入口：根据配置选择生成方式
     */
    async generate(form) {
        if (this.config.provider === 'deepseek' && this.config.deepseekKey) {
            return await this.generateViaDeepSeek(form);
        }
        if (this.config.provider === 'openai' && this.config.openaiKey) {
            return await this.generateViaOpenAI(form);
        }
        // 默认：本地模板生成
        return await this.generateLocal(form);
    },

    /**
     * 本地模板生成（不依赖外部API）
     */
    async generateLocal(form) {
        // 模拟思考延迟
        await this.delay(1500 + Math.random() * 2000);

        const typeConfig = this.getTypeConfig(form.type);
        const styleGuide = this.getStyleGuide(form.style);
        const audienceGuide = this.getAudienceGuide(form.audience);

        // 构建标题
        let title = form.title;
        if (!title && form.keywords) {
            const kws = form.keywords.split(/[,，]/).filter(Boolean);
            title = this.generateTitle(kws, typeConfig);
        }
        if (!title) title = this.generateTitle([typeConfig.keyword], typeConfig);

        // 构建正文
        let content = this.buildContent(form, typeConfig, styleGuide, audienceGuide);

        // 如果有参考内容，做改写优化
        if (form.content && form.content.length > 50) {
            content = this.rewriteFromSource(form.content, form, typeConfig, styleGuide);
        }

        return { title, content };
    },

    /**
     * DeepSeek API 生成
     */
    async generateViaDeepSeek(form) {
        const prompt = this.buildPrompt(form);
        const resp = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + this.config.deepseekKey,
            },
            body: JSON.stringify({
                model: this.config.deepseekModel,
                messages: [
                    { role: 'system', content: '你是一个专业的科技数码文案撰写专家，擅长撰写各类科技产品评测、新品发布稿、行业分析等。输出格式为 Markdown。' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.8,
                max_tokens: Math.min(form.wordCount * 3, 4096),
            }),
            signal: AbortSignal.timeout(60000),
        });
        if (!resp.ok) throw new Error('API 请求失败: ' + resp.status);
        const data = await resp.json();
        const text = data.choices[0].message.content;
        const lines = text.trim().split('\n');
        const title = lines[0].replace(/^#+\s*/, '');
        const content = lines.slice(1).join('\n').trim() || text;
        return { title, content };
    },

    /**
     * OpenAI API 生成
     */
    async generateViaOpenAI(form) {
        const prompt = this.buildPrompt(form);
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + this.config.openaiKey,
            },
            body: JSON.stringify({
                model: this.config.openaiModel,
                messages: [
                    { role: 'system', content: '你是一个专业的科技数码文案撰写专家。输出格式为 Markdown。' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.8,
                max_tokens: Math.min(form.wordCount * 3, 4096),
            }),
            signal: AbortSignal.timeout(60000),
        });
        if (!resp.ok) throw new Error('API 请求失败: ' + resp.status);
        const data = await resp.json();
        const text = data.choices[0].message.content;
        const lines = text.trim().split('\n');
        const title = lines[0].replace(/^#+\s*/, '');
        const content = lines.slice(1).join('\n').trim() || text;
        return { title, content };
    },

    /**
     * 构建 Prompt
     */
    buildPrompt(form) {
        const typeConfig = this.getTypeConfig(form.type);
        const styleGuide = this.getStyleGuide(form.style);
        const audienceGuide = this.getAudienceGuide(form.audience);
        let prompt = `请撰写一篇${typeConfig.label}类型的科技数码文章。\n`;
        prompt += `目标字数：${form.wordCount}字左右\n`;
        prompt += `写作风格：${styleGuide}\n`;
        prompt += `目标读者：${audienceGuide}\n`;
        if (form.keywords) prompt += `核心关键词：${form.keywords}\n`;
        if (form.extraInstructions) prompt += `额外要求：${form.extraInstructions}\n`;
        if (form.template) prompt += `参考模板：\n${form.template}\n`;
        if (form.title) prompt += `\n标题参考：${form.title}\n`;
        if (form.content && form.content.length > 50) {
            prompt += `\n以下为参考原文，请基于此内容进行改写、优化和扩展：\n${form.content.substring(0, 3000)}\n`;
        }
        prompt += `\n请用 Markdown 格式输出，第一行为标题（以 # 开头），之后为正文内容。`;
        return prompt;
    },

    // ========== 本地生成的辅助方法 ==========

    getTypeConfig(type) {
        const map = {
            review: { label: '数码评测', keyword: '新品评测', sections: ['外观设计', '性能体验', '功能亮点', '优缺点分析', '购买建议'] },
            release: { label: '新品发布', keyword: '新品发布', sections: ['发布背景', '产品亮点', '核心参数', '售价及上市时间', '市场展望'] },
            event: { label: '活动报道', keyword: '科技活动', sections: ['活动概况', '重要发布', '现场亮点', '行业影响', '后续展望'] },
            interview: { label: '人物专访', keyword: '科技人物', sections: ['人物背景', '核心观点', '深度对话', '行业洞察', '未来规划'] },
            exhibition: { label: '新品展报', keyword: '展会报道', sections: ['展会概况', '重磅新品', '技术趋势', '亮点展台', '观展总结'] },
            tutorial: { label: '使用教程', keyword: '使用指南', sections: ['准备工作', '操作步骤', '进阶技巧', '常见问题', '总结推荐'] },
            opinion: { label: '行业观点', keyword: '行业分析', sections: ['现象概述', '深层原因', '多方观点', '趋势判断', '结论建议'] },
            comparison: { label: '对比评测', keyword: '横向对比', sections: ['参评产品', '外观对比', '性能对决', '体验差异', '选购指南'] },
            news: { label: '科技快讯', keyword: '科技资讯', sections: ['新闻要点', '事件详情', '背景补充', '行业影响', '后续关注'] },
            analysis: { label: '深度分析', keyword: '深度分析', sections: ['背景介绍', '技术解析', '市场格局', '竞争态势', '未来趋势'] },
        };
        return map[type] || map.review;
    },

    getStyleGuide(style) {
        const map = {
            professional: '使用专业客观的科技媒体口吻，数据详实，逻辑严谨，适当引用参数和对比数据',
            lively: '语气轻松活泼，可以加入网络流行语和幽默元素，但保持专业底线，像朋友聊天一样自然',
            marketing: '强调产品优势和卖点，使用有感染力的营销语言，营造紧迫感和购买欲望',
            technical: '深入技术细节，使用专业术语，面向开发者或高级玩家，可以讨论架构、算法、制程等深度话题',
            storytelling: '以故事化叙事展开，从用户场景切入，有起承转合，让读者有代入感',
            concise: '简洁明了，直击要点，避免冗余修饰，用最短的文字传达最核心的信息',
        };
        return map[style] || map.professional;
    },

    getAudienceGuide(audience) {
        const map = {
            tech_fans: '面向数码爱好者，他们对科技产品有一定了解，关注参数和细节',
            general: '面向普通消费者，用通俗易懂的语言解释技术概念，关注实用价值',
            experts: '面向行业专家，可以深入讨论技术原理和行业趋势',
            investors: '面向投资者，关注市场前景、商业模式和竞争格局',
            developers: '面向开发者，关注技术架构、API、开发工具和生态',
        };
        return map[audience] || map.tech_fans;
    },

    generateTitle(keywords, typeConfig) {
        const templates = [
            `【${typeConfig.label}】${keywords[0] || ''}深度体验：${keywords[1] || '全面'}解析，${keywords[2] || '这些亮点'}值得关注`,
            `${keywords[0] || ''}${typeConfig.label}：${keywords[1] || '全方位'}实测，${keywords[2] || '究竟'}表现如何？`,
            `深度${typeConfig.label} | ${keywords.join(' ') || '新品'}上手体验与性能测试`,
            `${keywords[0] || '重磅新品'}正式登场：${typeConfig.label}带你第一时间了解`,
            `${keywords.join(' vs ') || '旗舰对决'}：谁才是${keywords[0] || '年度'}最佳选择？`,
        ];
        return templates[Math.floor(Math.random() * templates.length)];
    },

    buildContent(form, typeConfig, styleGuide, audienceGuide) {
        let content = '';
        const kws = (form.keywords || '').split(/[,，]/).filter(Boolean);
        const mainKeyword = kws[0] || typeConfig.keyword;
        const targetWords = form.wordCount;
        const wordsPerSection = Math.floor(targetWords / typeConfig.sections.length);

        content += `在科技飞速发展的今天，${mainKeyword}已经成为行业关注的焦点。`;
        content += `本文将从${typeConfig.sections.slice(0, 4).join('、')}等多个维度，为${audienceGuide.split('，')[0] || '读者'}带来全面深入的${typeConfig.label}。\n\n`;

        typeConfig.sections.forEach((section, i) => {
            content += `## ${section}\n\n`;
            content += this.generateSection(section, mainKeyword, kws, wordsPerSection, form.style, i);
            content += '\n';
        });

        content += `## 总结\n\n`;
        content += `综合来看，${mainKeyword}在多方面展现出了令人印象深刻的表现。`;
        if (form.style === 'marketing') {
            content += `如果你正在寻找一款兼具性能与体验的产品，${mainKeyword}无疑是一个值得考虑的选择。现在就去了解更多吧！`;
        } else if (form.style === 'technical') {
            content += `从技术角度来看，其在核心架构上的创新值得肯定，但部分细节仍有优化空间。建议关注后续固件更新和生态完善进展。`;
        } else {
            content += `对于${audienceGuide.split('，')[0] || '目标用户'}来说，这是一款值得关注的产品。我们也期待后续更多创新和突破。`;
        }

        return content;
    },

    generateSection(section, keyword, kws, words, style, index) {
        const templates = {
            '外观设计': [
                `初见${keyword}，其设计语言令人耳目一新。整体采用了简洁大气的设计风格，线条流畅自然。`,
                `细节之处见真章——${keyword}在材质选择和工艺打磨上展现了旗舰级的品质感。`,
                `与上一代产品相比，${keyword}在外观上做出了明显的革新，更加符合当下的审美趋势。`,
            ],
            '性能体验': [
                `${keyword}搭载了最新的处理器平台，在实际测试中表现抢眼。`,
                `我们通过多轮基准测试来验证${keyword}的真实水平：GeekBench跑分、3DMark压力测试、实际游戏帧率……`,
                `日常使用中，${keyword}的响应速度令人满意，多任务切换流畅无卡顿。`,
            ],
            '功能亮点': [
                `${keyword}在功能层面带来了多项创新，其中最为突出的是其全新的AI能力。`,
                `实际体验下来，${keyword}的这些功能不仅仅是噱头，而是真正能够提升效率的实用工具。`,
                `值得一提的是，${keyword}在细节体验上的打磨——从交互逻辑到动画过渡，处处体现用心。`,
            ],
            '优缺点分析': [
                `**优点：**\n- 出色的${kws[1] || '性能'}表现，在同价位中具有竞争力\n- ${kws[2] || '设计'}精良，质感出众\n- 功能丰富，生态完善`,
                `**可改进之处：**\n- 部分场景下续航表现一般\n- ${kws[0] || '产品'}在极端条件下的稳定性有待提升`,
            ],
            '购买建议': [
                `如果你属于以下人群，${keyword}非常值得入手：追求${kws[1] || '极致体验'}的用户、需要${kws[2] || '高效工具'}的专业人士。`,
                `考虑到其定价和竞品情况，${keyword}在当前市场中具有不错的性价比。建议关注首发优惠。`,
            ],
            default: [
                `关于${section}，${keyword}展现出了行业领先的水平。从实际体验来看，其在${kws[1] || '核心指标'}上的表现尤为突出。`,
                `深入分析${section}方面，${keyword}相比竞品有着明显的差异化优势，这也是其能够在市场中脱颖而出的关键。`,
            ]
        };

        const pool = templates[section] || templates.default;
        const base = pool[Math.min(index, pool.length - 1)];
        return base;
    },

    rewriteFromSource(sourceContent, form, typeConfig, styleGuide) {
        const maxLen = form.wordCount * 2;
        let content = '';

        content += `基于原文的深度改写与优化：\n\n`;

        // 简单摘要提取
        const sentences = sourceContent.replace(/\n/g, ' ').split(/[。！？]/).filter(s => s.trim().length > 5);
        const keySentences = sentences.slice(0, Math.min(10, sentences.length));

        content += `## 内容摘要\n\n`;
        keySentences.slice(0, 3).forEach(s => {
            content += `- ${s.trim()}。\n`;
        });

        content += `\n## 深度分析\n\n`;
        content += `在原文基础上，我们从${typeConfig.sections.slice(0, 3).join('、')}等角度进行了深入扩展：\n\n`;

        typeConfig.sections.slice(0, 3).forEach(section => {
            content += `### ${section}\n\n`;
            content += `原文中关于${section}的内容，经过我们的专业解读和补充，可以得出以下结论：${keySentences[Math.floor(Math.random() * keySentences.length)] || '该产品在这一维度上表现出色'}。\n\n`;
        });

        content += `\n## 编辑点评\n\n`;
        content += `综合原文信息及行业背景，我们认为这篇内容的核心价值在于：为${form.audience === 'general' ? '普通消费者' : '科技爱好者'}提供了有价值的参考。`;
        if (form.extraInstructions) {
            content += `\n\n按照你的额外要求，我们特别关注了：${form.extraInstructions}`;
        }

        return content;
    },

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
};
