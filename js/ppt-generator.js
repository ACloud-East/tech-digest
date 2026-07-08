/**
 * PPTGenerator v5 - 专业级 PPT 生成引擎
 * 兼容 PptxGenJS v3.x（CDN 加载）
 *
 * 设计理念（对标专业设计稿）：
 * - 每页使用 Canvas 动态生成的「渐变背景图」（光晕 + 网格 + 几何装饰）
 * - 文字承载于半透明卡片之上，确保可读性与层次感
 * - 章节页使用超大渐变数字（Canvas 渲染图片）
 * - 内容页采用标题栏 + 要点卡片网格的杂志式排版
 */
const PPTGenerator = {
    themes: {
        tech: {
            name: '科技蓝',
            bg1: '081020', bg2: '0F2A4A',
            glow1: '0EA5E9', glow2: '8B5CF6',
            grid: '38BDF8',
            text: 'EAF2FC', textDim: 'A9BED4', textMuted: '6B8299',
            accent: '22D3EE', accent2: 'A78BFA',
            card: { color: '0B1B33', transparency: 62 },
            numGrad: ['22D3EE', '8B5CF6'],
            isLight: false
        },
        dark: {
            name: '暗夜黑',
            bg1: '0B0B14', bg2: '1E1B33',
            glow1: 'A78BFA', glow2: 'F472B6',
            grid: 'C4B5FD',
            text: 'F4F2FB', textDim: 'B9B4CC', textMuted: '7C7793',
            accent: 'C4B5FD', accent2: 'F472B6',
            card: { color: '141225', transparency: 60 },
            numGrad: ['C4B5FD', 'F472B6'],
            isLight: false
        },
        light: {
            name: '简约白',
            bg1: 'F4F7FB', bg2: 'E4ECF5',
            glow1: '3B82F6', glow2: '8B5CF6',
            grid: '3B82F6',
            text: '1E2A3A', textDim: '5A6B82', textMuted: '94A3B8',
            accent: '2563EB', accent2: '7C3AED',
            card: { color: 'FFFFFF', transparency: 35 },
            numGrad: ['2563EB', '7C3AED'],
            isLight: true
        },
        nature: {
            name: '清新绿',
            bg1: '07140E', bg2: '103026',
            glow1: '10B981', glow2: '34D399',
            grid: '34D399',
            text: 'ECFDF5', textDim: 'A7E8C8', textMuted: '6B9C85',
            accent: '34D399', accent2: 'FBBF24',
            card: { color: '0C2018', transparency: 60 },
            numGrad: ['34D399', '10B981'],
            isLight: false
        },
        warm: {
            name: '暖橙',
            bg1: '160E08', bg2: '2E1A0E',
            glow1: 'F97316', glow2: 'FB923C',
            grid: 'FB923C',
            text: 'FFF3E9', textDim: 'F6C9A8', textMuted: 'B58868',
            accent: 'FB923C', accent2: 'FBBF24',
            card: { color: '1E1209', transparency: 60 },
            numGrad: ['FB923C', 'F97316'],
            isLight: false
        }
    },

    _currentPPTX: null,
    _currentFileName: '',
    _bgCache: {},
    _numCache: {},

    async generate(options) {
        const theme = this.themes[options.theme] || this.themes.tech;
        const pptx = new PptxGenJS();
        pptx.layout = 'LAYOUT_WIDE';
        pptx.author = 'TechDigest';
        pptx.company = 'TechDigest';
        pptx.subject = options.title || '科技数码演示文稿';

        const targetSlides = options.maxSlides || 10;
        const slides = this.parseContent(options.content, options, targetSlides);

        this._currentPPTX = pptx;
        this._currentFileName = (options.title || '演示文稿').replace(/[\\/:*?"<>|]/g, '-') + '.pptx';

        this._buildSlides(pptx, slides, options, theme);
        return { pptx, filename: this._currentFileName };
    },

    // 从大纲数据直接生成（跳过内容解析）
    async generateFromOutline(options) {
        const theme = this.themes[options.theme] || this.themes.tech;
        const pptx = new PptxGenJS();
        pptx.layout = 'LAYOUT_WIDE';
        pptx.author = 'TechDigest';
        pptx.company = 'TechDigest';
        pptx.subject = options.title || '科技数码演示文稿';

        const slides = options.slides || [];

        this._currentPPTX = pptx;
        this._currentFileName = (options.title || '演示文稿').replace(/[\\/:*?"<>|]/g, '-') + '.pptx';

        this._buildSlides(pptx, slides, options, theme);
        return { pptx, filename: this._currentFileName };
    },

    // 构建幻灯片（generate 和 generateFromOutline 共用）
    _buildSlides(pptx, slides, options, theme) {
        if (options.includeCover !== false) {
            this.addCoverSlide(pptx, options, theme);
        }
        if (options.includeToc !== false && slides.length >= 2) {
            this.addTocSlide(pptx, slides, options, theme);
        }
        slides.forEach((slideData, idx) => {
            this.addContentSlide(pptx, slideData, idx, slides.length, options, theme);
        });
        if (options.includeEnd !== false) {
            this.addEndSlide(pptx, options, theme);
        }
    },

    async downloadCurrent() {
        if (!this._currentPPTX) throw new Error('请先生成PPT');
        await this._currentPPTX.writeFile({ fileName: this._currentFileName });
    },

    clearCache() {
        this._currentPPTX = null;
        this._currentFileName = '';
        this._bgCache = {};
        this._numCache = {};
    },

    // ====================== Canvas 背景图生成 ======================
    hexA(hex, a) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return `rgba(${r},${g},${b},${a})`;
    },

    createBackground(theme, variant) {
        const cacheKey = (theme.name || '') + '_' + variant;
        if (this._bgCache[cacheKey]) return this._bgCache[cacheKey];

        // Node 环境无 canvas，fallback 纯色
        if (typeof document === 'undefined' || !document.createElement) return null;

        const W = 1280, H = 720;
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const ctx = c.getContext('2d');

        // 主对角渐变
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, '#' + theme.bg1);
        g.addColorStop(1, '#' + theme.bg2);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);

        // 光晕 1（左上）
        let r1 = ctx.createRadialGradient(W * 0.12, H * 0.15, 0, W * 0.12, H * 0.15, 620);
        r1.addColorStop(0, this.hexA(theme.glow1, theme.isLight ? 0.22 : 0.42));
        r1.addColorStop(1, this.hexA(theme.glow1, 0));
        ctx.fillStyle = r1; ctx.fillRect(0, 0, W, H);

        // 光晕 2（右下）
        let r2 = ctx.createRadialGradient(W * 0.9, H * 0.95, 0, W * 0.9, H * 0.95, 680);
        r2.addColorStop(0, this.hexA(theme.glow2, theme.isLight ? 0.18 : 0.38));
        r2.addColorStop(1, this.hexA(theme.glow2, 0));
        ctx.fillStyle = r2; ctx.fillRect(0, 0, W, H);

        // 变体特定装饰
        if (variant === 'section') {
            // 中心大光晕
            let rc = ctx.createRadialGradient(W * 0.32, H * 0.5, 0, W * 0.32, H * 0.5, 540);
            rc.addColorStop(0, this.hexA(theme.glow1, theme.isLight ? 0.25 : 0.5));
            rc.addColorStop(1, this.hexA(theme.glow1, 0));
            ctx.fillStyle = rc; ctx.fillRect(0, 0, W, H);
        }

        // 网格纹理
        ctx.strokeStyle = this.hexA(theme.grid, theme.isLight ? 0.06 : 0.05);
        ctx.lineWidth = 1;
        const step = 48;
        for (let x = 0; x <= W; x += step) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        }
        for (let y = 0; y <= H; y += step) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }

        // 角落几何装饰（细线斜切）
        ctx.strokeStyle = this.hexA(theme.accent, theme.isLight ? 0.25 : 0.35);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-40, H + 40); ctx.lineTo(260, -40);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(W - 260, H + 40); ctx.lineTo(W + 40, 260);
        ctx.stroke();

        // 装饰圆点（右上 / 左下）
        ctx.fillStyle = this.hexA(theme.accent2, theme.isLight ? 0.15 : 0.22);
        ctx.beginPath(); ctx.arc(W - 90, 90, 70, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = this.hexA(theme.accent, theme.isLight ? 0.12 : 0.18);
        ctx.beginPath(); ctx.arc(110, H - 90, 46, 0, Math.PI * 2); ctx.fill();

        const data = c.toDataURL('image/png');
        this._bgCache[cacheKey] = data;
        return data;
    },

    applyBg(slide, theme, variant) {
        const bg = this.createBackground(theme, variant);
        if (bg) slide.background = { data: bg };
        else slide.background = { color: theme.bg1 };
    },

    // 超大渐变数字图片（章节页用）
    createBigNumber(num, theme) {
        const key = num + '_' + theme.name;
        if (this._numCache[key]) return this._numCache[key];
        if (typeof document === 'undefined' || !document.createElement) return null;

        const S = 460;
        const c = document.createElement('canvas');
        c.width = S; c.height = S;
        const ctx = c.getContext('2d');

        const grad = ctx.createLinearGradient(40, 40, S - 40, S - 40);
        grad.addColorStop(0, '#' + theme.numGrad[0]);
        grad.addColorStop(1, '#' + theme.numGrad[1]);
        ctx.fillStyle = grad;
        ctx.font = 'bold 360px "Arial Black", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = this.hexA(theme.glow1, 0.6);
        ctx.shadowBlur = 30;
        ctx.fillText(String(num), S / 2, S / 2 + 14);

        const data = c.toDataURL('image/png');
        this._numCache[key] = data;
        return data;
    },

    // 标题精简（去除冗余，超长硬截断但不加省略号）
    condenseTitle(title, maxLen) {
        if (!title) return '';
        let t = title
            .replace(/^\d{4}年\d{1,2}月\d{1,2}日[，,、]?\s*/, '')   // 去掉日期前缀
            .replace(/^关于\s*/, '')                          // 去掉"关于"
            .replace(/有限公司/g, '')
            .replace(/电影摄影机/g, '')
            .replace(/Super 35mm/gi, '')
            .replace(/ILME-/g, '')
            .replace(/推出面向/g, '')
            .replace(/面向/g, '')
            .replace(/用户的免费/g, '')
            .replace(/免费/g, '')
            .replace(/以及/g, '/')                              // "以及" → "/"
            .replace(/（[^）]*）/g, '')                          // 去掉括号内容
            .replace(/[，,、]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        // 对副标题只精简主标题
        if (t.includes('——')) {
            const [main, sub] = t.split('——');
            const main2 = main.trim().replace(/信息$/, '').replace(/用户$/, '').replace(/固件升级信息/g, '固件');
            t = main2 + '——' + sub.trim();
        }
        if (t.length <= maxLen) return t;
        return t.substring(0, maxLen); // 超长硬截断，不加省略号
    },

    // 从要点中提取关键词作为副标题
    extractSubTitle(points, baseTitle) {
        if (!points || points.length === 0) return '';
        const first = points[0];
        // 取第一个要点的关键词（前18字或到第一个句号/逗号）
        const kw = (first.split(/[。；\n]/)[0] || first).trim().substring(0, 18);
        // 如果提取到的和原标题太像就不加了
        if (baseTitle && baseTitle.includes(kw.substring(0, 6))) return '';
        return '——' + kw;
    },

    // ====================== 内容解析 ======================
    parseContent(content, options, targetSlides) {
        if (!content || content.trim().length < 20) {
            return [
                { title: '欢迎使用 TechDigest PPT 生成', points: [
                    '粘贴您的文案内容，系统将自动生成专业级演示文稿',
                    '支持 # 标题标记划分页面，智能识别层次结构',
                    '内置 Word / PDF 解析，一键导入素材',
                    '五种主题风格与三种布局自由切换',
                    '点击「生成 PPT」预览，再下载保存到本地'
                ]},
                { title: '快速上手指南', points: [
                    '在左侧输入框粘贴或上传您的文案',
                    '使用两级标题组织内容结构',
                    '选取心仪的主题与布局风格',
                    '设置目标页数并生成演示文稿',
                    '确认效果后点击下载导出 .pptx'
                ]}
            ];
        }

        const lines = content.split(/\n+/).filter(l => l.trim());
        let slides = [];
        let current = null;

        for (const line of lines) {
            const t = line.trim();
            const isHeading = /^#{1,3}\s/.test(t);
            const isShort = t.length < 35 && !t.endsWith('。') && !t.endsWith('，')
                && !t.endsWith('；') && !t.endsWith('：') && !/^\d+[\.\、\)]/.test(t);

            if ((isHeading || isShort) && current && current.points.length >= 2) {
                slides.push(current);
                current = { title: t.replace(/^#{1,3}\s*/, ''), points: [] };
            } else if (!current) {
                current = { title: t.replace(/^#{1,3}\s*/, ''), points: [] };
            } else if (isHeading) {
                if (current.points.length > 0) slides.push(current);
                current = { title: t.replace(/^#{1,3}\s*/, ''), points: [] };
            } else {
                const clean = t.replace(/^[-*•]\s*/, '').replace(/^\d+[\.\、\)]\s*/, '');
                if (clean.length > 3) current.points.push(clean);
            }
        }
        if (current && current.points.length > 0) slides.push(current);

        if (slides.length === 0 && lines.length > 0) {
            const perSlide = Math.max(1, Math.ceil(lines.length / Math.min(targetSlides, 8)));
            for (let i = 0; i < lines.length; i += perSlide) {
                const chunk = lines.slice(i, i + perSlide);
                const title = chunk[0].length > 32 ? chunk[0].substring(0, 32) + '…' : chunk[0];
                slides.push({
                    title: title,
                    points: chunk.map(l => l.replace(/^[-*•]\s*/, '').replace(/^\d+[\.\、\)]\s*/, ''))
                });
            }
        }

        const extraPages = Math.max(0, targetSlides - slides.length);
        if (extraPages > 0 && slides.length > 0) {
            const expanded = [];
            for (const slide of slides) {
                if (slide.points.length > 5) {
                    for (let i = 0; i < slide.points.length; i += 4) {
                        const chunk = slide.points.slice(i, i + 4);
                        const sub = this.extractSubTitle(chunk, slide.title);
                        expanded.push({
                            title: i === 0 ? slide.title : slide.title + sub,
                            points: chunk
                        });
                    }
                } else {
                    expanded.push(slide);
                }
            }
            slides = expanded;
        }

        return slides.slice(0, Math.min(slides.length, Math.max(targetSlides, 20)));
    },

    // ====================== 封面页 ======================
    addCoverSlide(pptx, options, theme) {
        const s = pptx.addSlide();
        this.applyBg(s, theme, 'cover');

        const W = 13.33, H = 7.5;
        // 底部暗化条
        s.addShape('rect', { x: 0, y: H - 1.4, w: W, h: 1.4, fill: { color: theme.bg1, transparency: 25 } });
        // 顶部装饰线
        s.addShape('rect', { x: 0, y: 0, w: W, h: 0.07, fill: { type: 'solid', color: theme.accent } });

        const title = options.title || '未命名演示文稿';
        s.addText(title, {
            x: 0.9, y: 2.3, w: 11.5, h: 1.7,
            fontSize: 46, fontFace: 'Microsoft YaHei', bold: true,
            color: theme.text, align: 'left', valign: 'middle', lineSpacing: 52
        });

        const subtitle = options.subtitle || this.getTypeLabel(options.pptType);
        s.addText(subtitle, {
            x: 0.92, y: 4.0, w: 11, h: 0.7,
            fontSize: 19, fontFace: 'Microsoft YaHei',
            color: theme.textDim, align: 'left'
        });

        s.addShape('rect', { x: 0.92, y: 4.85, w: 3.2, h: 0.035, fill: { color: theme.accent, transparency: 30 } });

        s.addText(new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }) + '   ·   TechDigest', {
            x: 0.92, y: 5.1, w: 11, h: 0.5,
            fontSize: 13, fontFace: 'Microsoft YaHei', color: theme.textMuted, align: 'left'
        });

        s.addShape('rect', { x: 0, y: H - 0.07, w: W, h: 0.07, fill: { type: 'solid', color: theme.accent } });
    },

    // ====================== 目录页 ======================
    addTocSlide(pptx, slides, options, theme) {
        const s = pptx.addSlide();
        this.applyBg(s, theme, 'toc');

        const W = 13.33, H = 7.5;
        s.addShape('rect', { x: 0, y: 0, w: 0.32, h: H, fill: { type: 'solid', color: theme.accent } });

        s.addText('CONTENT', {
            x: 0.85, y: 0.6, w: 8, h: 0.7, fontSize: 44, fontFace: 'Arial', bold: true,
            color: theme.text, align: 'left', charSpacing: 6
        });
        s.addText('目录', {
            x: 0.88, y: 1.32, w: 5, h: 0.55, fontSize: 22, fontFace: 'Microsoft YaHei',
            color: theme.textDim, align: 'left'
        });
        s.addShape('rect', { x: 0.9, y: 1.95, w: 2.4, h: 0.03, fill: { color: theme.accent } });

        const colN = 2;
        const cardW = 5.65, cardH = 1.0, gapX = 0.35, gapY = 0.3;
        const startX = 0.85, startY = 2.4;

        slides.forEach((sl, i) => {
            const col = i % colN;
            const row = Math.floor(i / colN);
            const x = startX + col * (cardW + gapX);
            const y = startY + row * (cardH + gapY);

            s.addShape('roundRect', {
                x, y, w: cardW, h: cardH, rectRadius: 0.08,
                fill: { color: theme.card.color, transparency: theme.card.transparency },
                line: { color: theme.accent, width: 0.75, transparency: 55 }
            });
            // 序号
            s.addText(String(i + 1).padStart(2, '0'), {
                x: x + 0.18, y: y, w: 1.0, h: cardH,
                fontSize: 30, fontFace: 'Arial', bold: true,
                color: theme.accent, align: 'left', valign: 'middle'
            });
            // 标题
            s.addText(this.condenseTitle(sl.title, 18), {
                x: x + 1.25, y: y, w: cardW - 1.4, h: cardH,
                fontSize: 14.5, fontFace: 'Microsoft YaHei',
                color: theme.text, align: 'left', valign: 'middle'
            });
        });
    },

    // ====================== 章节分隔页 ======================
    addSectionSlide(pptx, number, title, theme) {
        const s = pptx.addSlide();
        this.applyBg(s, theme, 'section');

        const W = 13.33, H = 7.5;
        const numImg = this.createBigNumber(number, theme);
        if (numImg) {
            s.addImage({ data: numImg, x: 0.7, y: 1.5, w: 4.6, h: 4.6 });
        } else {
            s.addText(String(number), {
                x: 0.7, y: 1.5, w: 4.6, h: 4.6, fontSize: 200,
                fontFace: 'Arial', bold: true, color: theme.accent, align: 'center', valign: 'middle'
            });
        }

        s.addShape('rect', { x: 6.0, y: 2.7, w: 0.06, h: 2.0, fill: { color: theme.accent } });
        s.addText(title, {
            x: 6.35, y: 2.75, w: 6.4, h: 1.3,
            fontSize: 40, fontFace: 'Microsoft YaHei', bold: true,
            color: theme.text, align: 'left', valign: 'middle'
        });
        s.addText('CHAPTER ' + String(number).padStart(2, '0'), {
            x: 6.37, y: 4.15, w: 6.4, h: 0.5,
            fontSize: 15, fontFace: 'Arial', color: theme.textDim, align: 'left', charSpacing: 3
        });
        s.addShape('rect', { x: 6.37, y: 4.75, w: 2.2, h: 0.03, fill: { color: theme.accent, transparency: 40 } });
    },

    // ====================== 内容页 ======================
    addContentSlide(pptx, slideData, idx, total, options, theme) {
        const s = pptx.addSlide();
        this.applyBg(s, theme, 'content');

        const W = 13.33, H = 7.5;
        s.addShape('rect', { x: 0, y: 0, w: 0.12, h: H, fill: { type: 'solid', color: theme.accent } });

        // 顶部标题栏卡片
        const barH = 1.02;
        s.addShape('roundRect', {
            x: 0.55, y: 0.45, w: 12.2, h: barH, rectRadius: 0.06,
            fill: { color: theme.card.color, transparency: theme.card.transparency },
            line: { color: theme.accent, width: 0.5, transparency: 60 }
        });
        s.addShape('rect', { x: 0.55, y: 0.45, w: 0.11, h: barH, fill: { type: 'solid', color: theme.accent } });
        s.addText(String(idx + 1).padStart(2, '0'), {
            x: 0.85, y: 0.45, w: 1.0, h: barH, fontSize: 30, fontFace: 'Arial', bold: true,
            color: theme.accent, align: 'left', valign: 'middle'
        });
        s.addText(this.condenseTitle(slideData.title, 22), {
            x: 1.95, y: 0.45, w: 10.5, h: barH, fontSize: 23, fontFace: 'Microsoft YaHei', bold: true,
            color: theme.text, align: 'left', valign: 'middle'
        });

        const points = slideData.points || [];
        const layout = options.layout || 'list';
        if (layout === 'grid') this.renderGrid(s, points, theme);
        else if (layout === 'text') this.renderText(s, points, theme);
        else this.renderList(s, points, theme);

        // 底部栏
        s.addShape('rect', { x: 0, y: H - 0.45, w: W, h: 0.45, fill: { color: theme.card.color, transparency: theme.card.transparency - 15 } });
        s.addShape('rect', { x: 0, y: H - 0.45, w: W, h: 0.02, fill: { color: theme.accent, transparency: 50 } });
        s.addText('TechDigest', {
            x: 0.55, y: H - 0.45, w: 3, h: 0.45, fontSize: 9, fontFace: 'Arial', color: theme.textMuted, align: 'left', valign: 'middle'
        });
        s.addText((idx + 1) + ' / ' + total, {
            x: W - 2, y: H - 0.45, w: 1.5, h: 0.45, fontSize: 10, fontFace: 'Arial', color: theme.textMuted, align: 'right', valign: 'middle'
        });
    },

    // 要点行卡片布局（杂志式）
    renderList(s, points, theme) {
        const W = 13.33;
        const top = 1.85, bottom = 6.95;
        const n = Math.min(points.length, 6);
        const gap = 0.18;
        const baseRowH = 0.72;
        const lineChars = 33; // 每行约33个字符

        // 按实际所需行数分级行高：短文本紧凑，只有长文本才扩展
        const neededLines = points.slice(0, n).map(p => Math.min(Math.ceil(p.length / lineChars), 3));
        const rowHs = neededLines.map(lines => baseRowH + (lines - 1) * 0.35);
        const totalNeeded = rowHs.reduce((a, h) => a + h, 0) + gap * (n - 1);
        const availH = bottom - top;
        const scale = totalNeeded > availH ? (availH / totalNeeded) : 1;
        const finalRowHs = rowHs.map(h => h * scale);

        let yCursor = top;
        const x = 0.7, w = W - 1.4;

        points.slice(0, n).forEach((p, i) => {
            const rowH = finalRowHs[i];
            const y = yCursor;
            s.addShape('roundRect', {
                x, y, w, h: rowH, rectRadius: 0.05,
                fill: { color: theme.card.color, transparency: theme.card.transparency },
                line: { color: theme.accent, width: 0.4, transparency: 70 }
            });
            // 序号圆（顶部对齐）
            const cs = 0.48;
            s.addShape('ellipse', {
                x: x + 0.28, y: y + 0.12, w: cs, h: cs,
                fill: { type: 'solid', color: i % 2 === 0 ? theme.accent : theme.accent2 }
            });
            s.addText(String(i + 1), {
                x: x + 0.28, y: y + 0.12, w: cs, h: cs, fontSize: 13, fontFace: 'Arial', bold: true,
                color: '#FFFFFF', align: 'center', valign: 'middle'
            });
            // 文字 — wrap 自动换行，长文本不溢出
            s.addText(p, {
                x: x + 1.0, y: y + 0.12, w: w - 1.2, h: rowH - 0.24,
                fontSize: 13.5, fontFace: 'Microsoft YaHei', color: theme.textDim, align: 'left', valign: 'top',
                lineSpacing: 20, paraSpaceAfter: 2, wrap: true
            });
            // 左侧强调条
            s.addShape('rect', { x, y: y + 0.14, w: 0.05, h: rowH - 0.28, fill: { color: theme.accent, transparency: 30 } });

            yCursor += rowH + gap;
        });
    },

    // 网格卡片布局
    renderGrid(s, points, theme) {
        const W = 13.33;
        const top = 1.85, bottom = 6.95;
        const cols = 2;
        const rows = Math.ceil(Math.min(points.length, 6) / cols);
        const gapX = 0.35, gapY = 0.28;
        const cardW = (W - 1.4 - gapX) / cols;
        const cardH = (bottom - top - gapY * (rows - 1)) / rows;

        points.slice(0, cols * rows).forEach((p, i) => {
            const col = i % cols, row = Math.floor(i / cols);
            const x = 0.7 + col * (cardW + gapX);
            const y = top + row * (cardH + gapY);

            s.addShape('roundRect', {
                x, y, w: cardW, h: cardH - gapY, rectRadius: 0.07,
                fill: { color: theme.card.color, transparency: theme.card.transparency },
                line: { color: theme.accent, width: 0.5, transparency: 65 }
            });
            // 序号角标
            s.addText(String(i + 1).padStart(2, '0'), {
                x: x + 0.25, y: y + 0.15, w: 1.0, h: 0.5, fontSize: 18, fontFace: 'Arial', bold: true,
                color: theme.accent, align: 'left', valign: 'top'
            });
            // 顶部细线
            s.addShape('rect', { x: x + 0.27, y: y + 0.7, w: 0.9, h: 0.025, fill: { color: theme.accent, transparency: 40 } });
            // 文字
            s.addText(p, {
                x: x + 0.28, y: y + 0.85, w: cardW - 0.56, h: cardH - gapY - 1.0,
                fontSize: 12.5, fontFace: 'Microsoft YaHei', color: theme.textDim, align: 'left', valign: 'top',
                lineSpacing: 17, wrap: true
            });
        });
    },

    // 纯文排版布局
    renderText(s, points, theme) {
        const W = 13.33;
        const top = 1.9, bottom = 6.9;
        const x = 0.9, w = W - 1.8;

        s.addShape('rect', { x: x, y: top, w: 0.06, h: bottom - top, fill: { color: theme.accent, transparency: 35 } });

        const text = points.map((p, i) => (i + 1) + '、' + p).join('\n\n');
        s.addText(text, {
            x: x + 0.35, y: top, w: w - 0.35, h: bottom - top,
            fontSize: 14, fontFace: 'Microsoft YaHei', color: theme.textDim, align: 'left', valign: 'top',
            lineSpacing: 24, paraSpaceAfter: 8, wrap: true
        });
    },

    // ====================== 结尾页 ======================
    addEndSlide(pptx, options, theme) {
        const s = pptx.addSlide();
        this.applyBg(s, theme, 'section');

        const W = 13.33, H = 7.5;
        s.addShape('rect', { x: 0, y: 0, w: W, h: 0.07, fill: { type: 'solid', color: theme.accent } });

        s.addText('感谢观看', {
            x: 1, y: 2.5, w: W - 2, h: 1.2, fontSize: 46, fontFace: 'Microsoft YaHei', bold: true,
            color: theme.text, align: 'center', valign: 'middle'
        });
        s.addText('THANK YOU', {
            x: 1, y: 3.65, w: W - 2, h: 0.7, fontSize: 18, fontFace: 'Arial',
            color: theme.textMuted, align: 'center', charSpacing: 6
        });
        s.addShape('rect', { x: W / 2 - 1.4, y: 4.5, w: 2.8, h: 0.03, fill: { color: theme.accent, transparency: 40 } });
        s.addText(options.title || '', {
            x: 1, y: 4.85, w: W - 2, h: 0.5, fontSize: 14, fontFace: 'Microsoft YaHei',
            color: theme.textDim, align: 'center'
        });
        s.addText('Powered by TechDigest', {
            x: 1, y: 6.45, w: W - 2, h: 0.4, fontSize: 10, fontFace: 'Arial', color: theme.textMuted, align: 'center'
        });
        s.addShape('rect', { x: 0, y: H - 0.07, w: W, h: 0.07, fill: { type: 'solid', color: theme.accent } });
    },

    getTypeLabel(type) {
        const map = {
            product: '产品发布演示', tech: '技术方案分享', report: '行业研究报告',
            marketing: '营销策划方案', education: '培训课件', summary: '工作总结汇报'
        };
        return map[type] || '科技数码演示文稿';
    }
};
