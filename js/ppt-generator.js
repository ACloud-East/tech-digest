/**
 * PPTGenerator v4 - 专业炫酷PPT生成引擎
 * 兼容 PptxGenJS v3.x（CDN 加载）
 * 
 * 特性：
 * - 5套精心设计的主题，每套有渐变背景+装饰元素
 * - 精确对齐的序号和文字，无重叠
 * - 3种布局：要点列表、网格卡片、纯文排版
 * - 智能分页：内容不足时拆分段落以填满目标页数
 * - 封面/目录/内容/结尾完整幻灯片结构
 */
const PPTGenerator = {
    themes: {
        tech: {
            name: '科技蓝',
            bg: '0A1628',
            primary: '0EA5E9', secondary: '38BDF8', accent: '06B6D4',
            text: 'E2E8F0', textDim: '94A3B8', textMuted: '64748B',
            cardBg: '112240', cardBorder: '1E3A5F',
            highlight: '0EA5E9', highlightAlpha: '0EA5E915',
            accent2: '8B5CF6'
        },
        dark: {
            name: '暗夜黑',
            bg: '0F0F1A',
            primary: 'A78BFA', secondary: 'C4B5FD', accent: '818CF8',
            text: 'F1F5F9', textDim: 'A1A1AA', textMuted: '71717A',
            cardBg: '1E1E2E', cardBorder: '3F3F5B',
            highlight: 'A78BFA', highlightAlpha: 'A78BFA15',
            accent2: 'F472B6'
        },
        light: {
            name: '简约白',
            bg: 'F8FAFC',
            primary: '2563EB', secondary: '3B82F6', accent: '06B6D4',
            text: '1E293B', textDim: '64748B', textMuted: '94A3B8',
            cardBg: 'FFFFFF', cardBorder: 'E2E8F0',
            highlight: '2563EB', highlightAlpha: '2563EB08',
            accent2: '7C3AED'
        },
        nature: {
            name: '清新绿',
            bg: '0A1F14',
            primary: '10B981', secondary: '34D399', accent: '059669',
            text: 'ECFDF5', textDim: 'A7F3D0', textMuted: '6EE7B7',
            cardBg: '132A1E', cardBorder: '1E4732',
            highlight: '10B981', highlightAlpha: '10B98115',
            accent2: 'FBBF24'
        },
        warm: {
            name: '暖橙',
            bg: '1C1410',
            primary: 'F97316', secondary: 'FB923C', accent: 'EA580C',
            text: 'FFF7ED', textDim: 'FED7AA', textMuted: 'FDBA74',
            cardBg: '2D1F18', cardBorder: '4A3028',
            highlight: 'F97316', highlightAlpha: 'F9731615',
            accent2: 'FBBF24'
        }
    },

    // 存储当前生成的pptx实例（用于延迟下载）
    _currentPPTX: null,
    _currentFileName: '',

    async generate(options) {
        const theme = this.themes[options.theme] || this.themes.tech;
        const pptx = new PptxGenJS();
        pptx.layout = 'LAYOUT_WIDE';  // 13.3" x 7.5" (16:9)
        pptx.author = 'TechDigest';
        pptx.company = 'TechDigest';
        pptx.subject = options.title || '科技数码演示文稿';

        const targetSlides = options.maxSlides || 10;
        const slides = this.parseContent(options.content, options, targetSlides);

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

        const filename = (options.title || '演示文稿').replace(/[\\/:*?"<>|]/g, '-') + '.pptx';
        this._currentPPTX = pptx;
        this._currentFileName = filename;

        // 返回而非直接下载
        return { pptx, filename };
    },

    // 下载当前已生成的PPT
    async downloadCurrent() {
        if (!this._currentPPTX) {
            throw new Error('请先生成PPT');
        }
        await this._currentPPTX.writeFile({ fileName: this._currentFileName });
    },

    // 清除缓存
    clearCache() {
        this._currentPPTX = null;
        this._currentFileName = '';
    },

    /**
     * 智能解析内容，确保生成足够页数
     * 策略：先按标题分页，如果不够，把长段落拆分为多页
     */
    parseContent(content, options, targetSlides) {
        if (!content || content.trim().length < 20) {
            const typeLabel = this.getTypeLabel(options.pptType);
            return [
                { title: '欢迎使用 TechDigest PPT 生成', points: [
                    '这是一页示例幻灯片，展示 PPT 生成效果',
                    '您可以粘贴文案内容来生成真实内容',
                    '支持 Word 和 PDF 文件上传',
                    '选择不同的主题风格和布局方式',
                    '点击「生成 PPT」按钮即可预览效果'
                ]},
                { title: '快速上手', points: [
                    '在左侧粘贴您的文案内容',
                    '使用 # 标题标记来划分页面',
                    '选择喜欢的主题和布局风格',
                    '设置目标页数来控制输出',
                    '生成完成后点击下载保存到本地'
                ]}
            ];
        }

        const lines = content.split(/\n+/).filter(l => l.trim());
        let slides = [];
        let current = null;

        // 第一遍：按标题分页
        for (const line of lines) {
            const t = line.trim();
            const isHeading = /^#{1,3}\s/.test(t);
            const isShortLine = t.length < 35 && !t.endsWith('。') && !t.endsWith('，')
                && !t.endsWith('；') && !t.endsWith('：') && !/^\d+[\.\、\)]/.test(t);

            if ((isHeading || isShortLine) && current && current.points.length >= 2) {
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

        // 如果没有任何标题结构，按段落均匀分页
        if (slides.length === 0 && lines.length > 0) {
            const perSlide = Math.max(1, Math.ceil(lines.length / Math.min(targetSlides, 8)));
            for (let i = 0; i < lines.length; i += perSlide) {
                const chunk = lines.slice(i, i + perSlide);
                const title = chunk[0].length > 35 ? chunk[0].substring(0, 35) + '...' : chunk[0];
                slides.push({
                    title: title,
                    points: chunk.map(l => l.replace(/^[-*•]\s*/, '').replace(/^\d+[\.\、\)]\s*/, ''))
                });
            }
        }

        // 关键修复：如果内容页不够，智能拆分长段落
        const extraPages = Math.max(0, targetSlides - slides.length);
        if (extraPages > 0 && slides.length > 0) {
            const expandedSlides = [];
            for (const slide of slides) {
                if (slide.points.length > 5) {
                    // 拆分长内容为多页
                    const chunks = [];
                    for (let i = 0; i < slide.points.length; i += 4) {
                        chunks.push(slide.points.slice(i, i + 4));
                    }
                    chunks.forEach((chunk, ci) => {
                        expandedSlides.push({
                            title: ci === 0 ? slide.title : slide.title + '（续' + (ci + 1) + '）',
                            points: chunk
                        });
                    });
                } else {
                    expandedSlides.push(slide);
                }
            }
            slides = expandedSlides;
        }

        // 限制页数
        return slides.slice(0, Math.min(slides.length, Math.max(targetSlides, 20)));
    },

    // ====================== 封面页 ======================
    addCoverSlide(pptx, options, theme) {
        const slide = pptx.addSlide();
        const W = 13.33, H = 7.5;

        // 渐变背景
        slide.background = { color: theme.bg };

        // 左上角装饰三角
        slide.addShape('rect', {
            x: 0, y: 0, w: 3.5, h: 3.5,
            fill: { color: theme.highlight, transparency: 90 },
            rotate: 45, rectRadius: 0
        });
        // 重新精确放置旋转后的矩形 - 用polygon替代
        slide.addShape('rect', {
            x: -1.2, y: -1.2, w: 3, h: 3,
            fill: { color: theme.highlight, transparency: 88 }
        });

        // 右下角装饰
        slide.addShape('rect', {
            x: W - 2, y: H - 2.5, w: 3.5, h: 3.5,
            fill: { color: theme.accent2, transparency: 90 }
        });

        // 顶部装饰线
        slide.addShape('rect', {
            x: 0, y: 0, w: W, h: 0.06,
            fill: { type: 'solid', color: theme.highlight }
        });

        // 左侧竖线装饰
        slide.addShape('rect', {
            x: 1.2, y: 2.0, w: 0.05, h: 3.2,
            fill: { type: 'solid', color: theme.highlight }
        });

        // 标题区域
        const title = options.title || '未命名演示文稿';
        slide.addText(title, {
            x: 1.8, y: 2.2, w: 9.5, h: 1.6,
            fontSize: 42, fontFace: 'Microsoft YaHei', bold: true,
            color: theme.text, align: 'left', valign: 'middle',
            lineSpacing: 48
        });

        // 副标题
        const subtitle = options.subtitle || this.getTypeLabel(options.pptType);
        slide.addText(subtitle, {
            x: 1.8, y: 3.9, w: 9.5, h: 0.7,
            fontSize: 18, fontFace: 'Microsoft YaHei',
            color: theme.textDim, align: 'left'
        });

        // 分隔线
        slide.addShape('rect', {
            x: 1.8, y: 4.7, w: 3, h: 0.03,
            fill: { color: theme.highlight, transparency: 40 }
        });

        // 日期和来源
        slide.addText(new Date().toLocaleDateString('zh-CN', {
            year: 'numeric', month: 'long', day: 'numeric'
        }) + '  ·  TechDigest', {
            x: 1.8, y: 5.0, w: 9.5, h: 0.5,
            fontSize: 13, fontFace: 'Microsoft YaHei',
            color: theme.textMuted, align: 'left'
        });

        // 底部装饰条
        slide.addShape('rect', {
            x: 0, y: H - 0.06, w: W, h: 0.06,
            fill: { type: 'solid', color: theme.highlight }
        });
    },

    // ====================== 目录页 ======================
    addTocSlide(pptx, slides, options, theme) {
        const slide = pptx.addSlide();
        const W = 13.33, H = 7.5;

        // 背景
        slide.background = { color: theme.bg };

        // 左侧色块装饰
        slide.addShape('rect', {
            x: 0, y: 0, w: 0.35, h: H,
            fill: { type: 'solid', color: theme.highlight }
        });

        // 顶部装饰线
        slide.addShape('rect', {
            x: 0.35, y: 0, w: W - 0.35, h: 0.04,
            fill: { type: 'solid', color: theme.highlight, transparency: 50 }
        });

        // 标题
        slide.addText('目  录', {
            x: 1.2, y: 0.6, w: 5, h: 0.9,
            fontSize: 32, fontFace: 'Microsoft YaHei', bold: true,
            color: theme.text, align: 'left'
        });
        slide.addText('CONTENTS', {
            x: 1.2, y: 1.3, w: 5, h: 0.5,
            fontSize: 12, fontFace: 'Arial',
            color: theme.textMuted, align: 'left', charSpacing: 8
        });

        // 分隔线
        slide.addShape('rect', {
            x: 1.2, y: 1.9, w: 2.5, h: 0.03,
            fill: { type: 'solid', color: theme.highlight }
        });

        // 目录项 - 使用两列布局
        const col1 = slides.slice(0, Math.ceil(slides.length / 2));
        const col2 = slides.slice(Math.ceil(slides.length / 2));

        col1.forEach((s, i) => {
            const y = 2.4 + i * 0.65;
            // 序号圆圈
            slide.addShape('roundRect', {
                x: 1.2, y: y, w: 0.45, h: 0.45,
                fill: { type: 'solid', color: theme.highlight },
                rectRadius: 0.08
            });
            slide.addText(String(i + 1).padStart(2, '0'), {
                x: 1.2, y: y, w: 0.45, h: 0.45,
                fontSize: 13, fontFace: 'Arial', bold: true,
                color: '#FFFFFF', align: 'center', valign: 'middle'
            });
            // 标题文字
            slide.addText(s.title, {
                x: 1.85, y: y, w: 4.8, h: 0.45,
                fontSize: 13, fontFace: 'Microsoft YaHei',
                color: theme.textDim, align: 'left', valign: 'middle'
            });
        });

        col2.forEach((s, i) => {
            const y = 2.4 + i * 0.65;
            const idx = col1.length + i;
            slide.addShape('roundRect', {
                x: 7.2, y: y, w: 0.45, h: 0.45,
                fill: { type: 'solid', color: theme.accent2 },
                rectRadius: 0.08
            });
            slide.addText(String(idx + 1).padStart(2, '0'), {
                x: 7.2, y: y, w: 0.45, h: 0.45,
                fontSize: 13, fontFace: 'Arial', bold: true,
                color: '#FFFFFF', align: 'center', valign: 'middle'
            });
            slide.addText(s.title, {
                x: 7.85, y: y, w: 4.8, h: 0.45,
                fontSize: 13, fontFace: 'Microsoft YaHei',
                color: theme.textDim, align: 'left', valign: 'middle'
            });
        });
    },

    // ====================== 内容页 ======================
    addContentSlide(pptx, slideData, idx, total, options, theme) {
        const slide = pptx.addSlide();
        const W = 13.33, H = 7.5;

        // 背景
        slide.background = { color: theme.bg };

        // 左侧装饰条
        slide.addShape('rect', {
            x: 0, y: 0, w: 0.12, h: H,
            fill: { type: 'solid', color: theme.highlight }
        });

        // 顶部细线
        slide.addShape('rect', {
            x: 0.12, y: 0, w: W - 0.12, h: 0.03,
            fill: { type: 'solid', color: theme.highlight, transparency: 60 }
        });

        // 右上角装饰
        slide.addShape('rect', {
            x: W - 1.5, y: -0.8, w: 2.5, h: 2,
            fill: { color: theme.highlight, transparency: 92 },
            rotate: 30
        });

        // === 标题区域 ===
        // 标题背景条
        slide.addShape('rect', {
            x: 0.12, y: 0, w: W - 0.12, h: 1.15,
            fill: { color: theme.cardBg, transparency: 30 }
        });

        // 章节编号
        const numStr = String(idx + 1).padStart(2, '0');
        slide.addText(numStr, {
            x: 0.7, y: 0.15, w: 0.9, h: 0.85,
            fontSize: 30, fontFace: 'Arial', bold: true,
            color: theme.highlight, align: 'center', valign: 'middle'
        });

        // 标题分隔线
        slide.addShape('rect', {
            x: 1.7, y: 0.35, w: 0.04, h: 0.45,
            fill: { type: 'solid', color: theme.highlight, transparency: 40 }
        });

        // 标题文字
        slide.addText(slideData.title, {
            x: 2.0, y: 0.15, w: 9.5, h: 0.85,
            fontSize: 24, fontFace: 'Microsoft YaHei', bold: true,
            color: theme.text, align: 'left', valign: 'middle'
        });

        // === 内容区域 ===
        const points = slideData.points || [];
        const layout = options.layout || 'list';

        if (layout === 'grid') {
            this.renderGridLayout(slide, points, theme);
        } else if (layout === 'text') {
            this.renderTextLayout(slide, points, theme);
        } else {
            this.renderListLayout(slide, points, theme);
        }

        // === 底部信息 ===
        // 页码背景
        slide.addShape('rect', {
            x: 0, y: H - 0.5, w: W, h: 0.5,
            fill: { color: theme.cardBg, transparency: 20 }
        });

        // 底部装饰线
        slide.addShape('rect', {
            x: 0, y: H - 0.5, w: W, h: 0.02,
            fill: { type: 'solid', color: theme.highlight, transparency: 50 }
        });

        // 页码
        slide.addText((idx + 1) + ' / ' + total, {
            x: W - 2, y: H - 0.5, w: 1.5, h: 0.5,
            fontSize: 10, fontFace: 'Arial',
            color: theme.textMuted, align: 'right', valign: 'middle'
        });

        // 页脚来源
        slide.addText('TechDigest', {
            x: 0.7, y: H - 0.5, w: 3, h: 0.5,
            fontSize: 9, fontFace: 'Arial',
            color: theme.textMuted, align: 'left', valign: 'middle'
        });
    },

    // 要点列表布局（默认）
    renderListLayout(slide, points, theme) {
        const W = 13.33, H = 7.5;
        const contentTop = 1.5;
        const contentH = H - 2.2;
        const maxPoints = Math.min(points.length, 8);
        const gap = Math.min(0.7, (contentH - 0.3) / maxPoints);

        points.slice(0, maxPoints).forEach((point, i) => {
            const y = contentTop + i * gap;

            // 序号圆圈
            const circleSize = 0.38;
            const circleY = y + (gap - circleSize) / 2;

            slide.addShape('ellipse', {
                x: 0.8, y: circleY, w: circleSize, h: circleSize,
                fill: { type: 'solid', color: i === 0 ? theme.highlight : theme.cardBg },
                line: { color: theme.highlight, width: 1.5 }
            });

            // 序号数字
            slide.addText(String(i + 1), {
                x: 0.8, y: circleY, w: circleSize, h: circleSize,
                fontSize: 12, fontFace: 'Arial', bold: true,
                color: i === 0 ? '#FFFFFF' : theme.highlight,
                align: 'center', valign: 'middle'
            });

            // 左侧连接线（除第一个）
            if (i > 0) {
                slide.addShape('rect', {
                    x: 0.98, y: y - gap / 2 + circleSize / 2,
                    w: 0.02, h: gap / 2,
                    fill: { color: theme.highlight, transparency: 50 }
                });
            }

            // 内容文字
            const textX = 1.45;
            const textW = W - textX - 1.0;

            slide.addText(point, {
                x: textX, y: y, w: textW, h: gap - 0.08,
                fontSize: 14, fontFace: 'Microsoft YaHei',
                color: theme.textDim, align: 'left', valign: 'top',
                lineSpacing: 22,
                paraSpaceAfter: 4
            });

            // 要点之间的浅色分隔线
            if (i < maxPoints - 1) {
                slide.addShape('rect', {
                    x: textX, y: y + gap - 0.04, w: textW * 0.7, h: 0.005,
                    fill: { color: theme.cardBorder, transparency: 40 }
                });
            }
        });
    },

    // 网格卡片布局
    renderGridLayout(slide, points, theme) {
        const W = 13.33, H = 7.5;
        const contentTop = 1.5;
        const cols = 2;
        const rows = Math.ceil(Math.min(points.length, 6) / cols);
        const cardW = (W - 3.2) / cols;
        const cardH = (H - contentTop - 0.9) / rows;
        const gapX = 0.4, gapY = 0.25;

        points.slice(0, cols * rows).forEach((point, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const x = 1.0 + col * (cardW + gapX);
            const y = contentTop + row * (cardH + gapY);

            // 卡片背景
            slide.addShape('roundRect', {
                x: x, y: y, w: cardW, h: cardH - gapY,
                fill: { type: 'solid', color: theme.cardBg },
                line: { color: theme.cardBorder, width: 0.5 },
                rectRadius: 0.1
            });

            // 顶部色条
            slide.addShape('rect', {
                x: x + 0.15, y: y + 0.12, w: cardW - 0.3, h: 0.03,
                fill: { type: 'solid', color: theme.highlight, transparency: 30 }
            });

            // 序号
            slide.addText(String(i + 1).padStart(2, '0'), {
                x: x + 0.2, y: y + 0.25, w: 0.6, h: 0.4,
                fontSize: 16, fontFace: 'Arial', bold: true,
                color: theme.highlight, align: 'left', valign: 'middle'
            });

            // 文字
            slide.addText(point, {
                x: x + 0.2, y: y + 0.7, w: cardW - 0.4, h: cardH - gapY - 0.9,
                fontSize: 12, fontFace: 'Microsoft YaHei',
                color: theme.textDim, align: 'left', valign: 'top',
                lineSpacing: 18
            });
        });
    },

    // 纯文排版布局
    renderTextLayout(slide, points, theme) {
        const W = 13.33, H = 7.5;
        const contentTop = 1.5;

        // 合并为段落文字
        const text = points.map((p, i) => {
            return (i + 1) + '、' + p;
        }).join('\n\n');

        slide.addText(text, {
            x: 1.2, y: contentTop, w: W - 2.4, h: H - contentTop - 0.9,
            fontSize: 13, fontFace: 'Microsoft YaHei',
            color: theme.textDim, align: 'left', valign: 'top',
            lineSpacing: 24, paraSpaceAfter: 8
        });
    },

    // ====================== 结尾页 ======================
    addEndSlide(pptx, options, theme) {
        const slide = pptx.addSlide();
        const W = 13.33, H = 7.5;

        // 背景
        slide.background = { color: theme.bg };

        // 顶部装饰线
        slide.addShape('rect', {
            x: 0, y: 0, w: W, h: 0.06,
            fill: { type: 'solid', color: theme.highlight }
        });

        // 中央装饰圆
        slide.addShape('ellipse', {
            x: W / 2 - 1.8, y: H / 2 - 2.2, w: 3.6, h: 3.6,
            fill: { color: theme.highlight, transparency: 93 },
            line: { color: theme.highlight, width: 1, transparency: 70 }
        });
        slide.addShape('ellipse', {
            x: W / 2 - 1.3, y: H / 2 - 1.7, w: 2.6, h: 2.6,
            fill: { color: theme.highlight, transparency: 95 },
            line: { color: theme.highlight, width: 0.5, transparency: 80 }
        });

        // "感谢观看"
        slide.addText('感谢观看', {
            x: 1, y: 2.4, w: W - 2, h: 1.2,
            fontSize: 44, fontFace: 'Microsoft YaHei', bold: true,
            color: theme.text, align: 'center', valign: 'middle'
        });

        // 英文
        slide.addText('THANK YOU', {
            x: 1, y: 3.5, w: W - 2, h: 0.7,
            fontSize: 18, fontFace: 'Arial',
            color: theme.textMuted, align: 'center', charSpacing: 6
        });

        // 分隔线
        slide.addShape('rect', {
            x: W / 2 - 1.5, y: 4.4, w: 3, h: 0.02,
            fill: { color: theme.highlight, transparency: 50 }
        });

        // 标题
        slide.addText(options.title || '', {
            x: 1, y: 4.8, w: W - 2, h: 0.5,
            fontSize: 14, fontFace: 'Microsoft YaHei',
            color: theme.textDim, align: 'center'
        });

        // 底部信息
        slide.addText('Powered by TechDigest', {
            x: 1, y: 6.5, w: W - 2, h: 0.4,
            fontSize: 10, fontFace: 'Arial',
            color: theme.textMuted, align: 'center'
        });

        // 底部装饰线
        slide.addShape('rect', {
            x: 0, y: H - 0.06, w: W, h: 0.06,
            fill: { type: 'solid', color: theme.highlight }
        });
    },

    getTypeLabel(type) {
        const map = {
            product: '产品发布演示',
            tech: '技术方案分享',
            report: '行业研究报告',
            marketing: '营销策划方案',
            education: '培训课件',
            summary: '工作总结汇报'
        };
        return map[type] || '科技数码演示文稿';
    }
};
