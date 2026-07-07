/**
 * PPTGenerator - PPT 生成引擎
 * 基于 PptxGenJS 在前端生成真实 .pptx 文件并下载
 */
const PPTGenerator = {
    // 模板配色方案
    themes: {
        tech: {
            name: '科技蓝',
            primary: '1A73E8', secondary: '0D47A1', accent: '00BCD4',
            bg: '0A0E17', bgLight: '111827', text: 'E8EDF5', textDark: '94A3B8',
            gradient: 'linear-gradient(135deg, #0ea5e9, #8b5cf6)'
        },
        dark: {
            name: '暗夜黑',
            primary: '1E1E2E', secondary: '2D2D3F', accent: 'FF6B6B',
            bg: '111111', bgLight: '1A1A2E', text: 'F0F0F0', textDark: 'AAAAAA',
            gradient: 'linear-gradient(135deg, #1a1a2e, #16213e)'
        },
        light: {
            name: '简约白',
            primary: '2563EB', secondary: '1E40AF', accent: '06B6D4',
            bg: 'FFFFFF', bgLight: 'F8FAFC', text: '1E293B', textDark: '64748B',
            gradient: 'linear-gradient(135deg, #2563EB, #06B6D4)'
        },
        nature: {
            name: '清新绿',
            primary: '059669', secondary: '047857', accent: '34D399',
            bg: '0F1A14', bgLight: '132118', text: 'ECFDF5', textDark: 'A7F3D0',
            gradient: 'linear-gradient(135deg, #059669, #34D399)'
        },
        warm: {
            name: '暖橙',
            primary: 'EA580C', secondary: 'C2410C', accent: 'FB923C',
            bg: '1C1410', bgLight: '2D1F18', text: 'FFF7ED', textDark: 'FED7AA',
            gradient: 'linear-gradient(135deg, #EA580C, #F97316)'
        }
    },

    /**
     * 主入口：生成并下载PPT
     */
    async generate(options) {
        const theme = this.themes[options.theme] || this.themes.tech;
        const pptx = new PptxGenJS();
        pptx.defineLayout({ name: 'CUSTOM', width: '13.333', height: '7.5' });
        pptx.layout = 'CUSTOM';

        // 解析内容为幻灯片段落
        const slides = this.parseContent(options.content, options);

        // 封面页
        this.addCoverSlide(pptx, options, theme);

        // 目录页（如果内容足够多）
        if (slides.length >= 3) {
            this.addTocSlide(pptx, slides, options, theme);
        }

        // 内容页
        slides.forEach((slide, idx) => {
            this.addContentSlide(pptx, slide, idx, slides.length, options, theme);
        });

        // 结尾页
        this.addEndSlide(pptx, options, theme);

        // 下载
        const filename = (options.title || '演示文稿') + '.pptx';
        await pptx.writeFile({ fileName: filename });
    },

    /**
     * 解析输入内容为幻灯片段落
     */
    parseContent(content, options) {
        if (!content || content.trim().length < 20) {
            return [{ title: '示例内容', points: ['这是一页示例幻灯片', '您可以粘贴文案、上传Word或PDF来生成真实内容', '当前显示的是占位内容'] }];
        }

        // 按换行分段，过滤空行
        const lines = content.split(/\n+/).filter(l => l.trim());
        const slides = [];
        let currentSlide = null;

        for (const line of lines) {
            const trimmed = line.trim();
            // 检测标题行（以 # 开头 或 短句 或 数字编号）
            const isHeading = /^#{1,3}\s/.test(trimmed) ||
                              (trimmed.length < 40 && !trimmed.endsWith('。') && !trimmed.endsWith('，') && !/^\d+[\.\、\)]/.test(trimmed));

            if (isHeading || !currentSlide) {
                if (currentSlide && currentSlide.points.length > 0) {
                    slides.push(currentSlide);
                }
                currentSlide = {
                    title: trimmed.replace(/^#{1,3}\s*/, ''),
                    points: []
                };
            } else if (currentSlide) {
                const clean = trimmed.replace(/^[-*•]\s*/, '').replace(/^\d+[\.\、\)]\s*/, '');
                if (clean.length > 5) {
                    currentSlide.points.push(clean);
                }
            }
        }
        if (currentSlide && currentSlide.points.length > 0) {
            slides.push(currentSlide);
        }

        // 如果解析后没有足够幻灯片，把长文本拆分为多页
        if (slides.length === 0 && lines.length > 0) {
            const chunkSize = Math.ceil(lines.length / Math.max(1, Math.ceil(lines.length / 5)));
            for (let i = 0; i < lines.length; i += chunkSize) {
                const chunk = lines.slice(i, i + chunkSize);
                slides.push({
                    title: chunk[0].length > 40 ? chunk[0].substring(0, 40) + '...' : chunk[0],
                    points: chunk.map(l => l.replace(/^[-*•]\s*/, '').replace(/^\d+[\.\、\)]\s*/, ''))
                });
            }
        }

        return slides.slice(0, Math.min(slides.length, options.maxSlides || 20));
    },

    /**
     * 封面页
     */
    addCoverSlide(pptx, options, theme) {
        const slide = pptx.addSlide();
        // 背景
        slide.background = { color: theme.bg };
        // 装饰条
        slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.08, fill: { color: theme.accent } });

        // 主标题
        slide.addText(options.title || '未命名演示文稿', {
            x: 1, y: 2.2, w: 11, h: 1.5,
            fontSize: 40, fontFace: 'Microsoft YaHei', bold: true,
            color: theme.text, align: 'center', valign: 'middle'
        });

        // 副标题
        const subtitle = options.subtitle || this.getTypeLabel(options.pptType);
        slide.addText(subtitle, {
            x: 1, y: 3.7, w: 11, h: 0.8,
            fontSize: 18, fontFace: 'Microsoft YaHei',
            color: theme.textDark, align: 'center', valign: 'middle'
        });

        // 日期和作者
        slide.addText(new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }), {
            x: 1, y: 5.5, w: 11, h: 0.6,
            fontSize: 14, fontFace: 'Microsoft YaHei',
            color: theme.textDark, align: 'center'
        });
    },

    /**
     * 目录页
     */
    addTocSlide(pptx, slides, options, theme) {
        const slide = pptx.addSlide();
        slide.background = { color: theme.bgLight };

        slide.addText('目  录', {
            x: 1, y: 0.8, w: 11, h: 0.8,
            fontSize: 28, fontFace: 'Microsoft YaHei', bold: true,
            color: theme.text, align: 'center'
        });

        slide.addShape(pptx.ShapeType.rect, {
            x: 5, y: 1.6, w: 3, h: 0.04, fill: { color: theme.accent }
        });

        slides.forEach((s, i) => {
            slide.addText(`${String(i + 1).padStart(2, '0')}    ${s.title}`, {
                x: 2, y: 2.2 + i * 0.5, w: 9, h: 0.45,
                fontSize: 14, fontFace: 'Microsoft YaHei',
                color: theme.textDark, bullet: false
            });
        });
    },

    /**
     * 内容页
     */
    addContentSlide(pptx, slideData, idx, total, options, theme) {
        const slide = pptx.addSlide();
        slide.background = { color: theme.bg };

        // 页码指示器
        slide.addShape(pptx.ShapeType.rect, {
            x: 0, y: 0, w: '100%', h: 0.05, fill: { color: theme.accent }
        });

        // 标题
        slide.addText(slideData.title, {
            x: 0.8, y: 0.4, w: 11.5, h: 0.8,
            fontSize: 24, fontFace: 'Microsoft YaHei', bold: true,
            color: theme.text
        });

        // 标题下划线
        slide.addShape(pptx.ShapeType.rect, {
            x: 0.8, y: 1.15, w: 2, h: 0.04, fill: { color: theme.accent }
        });

        // 要点列表
        const points = slideData.points.slice(0, 8);
        const startY = 1.6;
        const lineHeight = 0.65;

        points.forEach((point, i) => {
            // 序号圆圈
            slide.addShape(pptx.ShapeType.ellipse, {
                x: 0.8, y: startY + i * lineHeight + 0.05, w: 0.32, h: 0.32,
                fill: { color: theme.accent }
            });
            slide.addText(String(i + 1), {
                x: 0.8, y: startY + i * lineHeight + 0.05, w: 0.32, h: 0.32,
                fontSize: 11, fontFace: 'Arial', bold: true,
                color: theme.bg, align: 'center', valign: 'middle'
            });

            // 要点文本
            slide.addText(point, {
                x: 1.4, y: startY + i * lineHeight, w: 10.5, h: lineHeight,
                fontSize: 14, fontFace: 'Microsoft YaHei',
                color: theme.textDark, valign: 'middle'
            });
        });

        // 页码
        slide.addText(`${idx + 1} / ${total}`, {
            x: 11, y: 6.9, w: 1.5, h: 0.4,
            fontSize: 10, fontFace: 'Arial',
            color: theme.textDark, align: 'right'
        });
    },

    /**
     * 结尾页
     */
    addEndSlide(pptx, options, theme) {
        const slide = pptx.addSlide();
        slide.background = { color: theme.bg };

        slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: 0.08, fill: { color: theme.accent } });

        slide.addText('感谢观看', {
            x: 1, y: 2.5, w: 11, h: 1.2,
            fontSize: 44, fontFace: 'Microsoft YaHei', bold: true,
            color: theme.text, align: 'center'
        });

        slide.addText('THANK YOU', {
            x: 1, y: 3.7, w: 11, h: 0.8,
            fontSize: 20, fontFace: 'Arial',
            color: theme.textDark, align: 'center'
        });

        slide.addText(options.title || '', {
            x: 1, y: 5, w: 11, h: 0.6,
            fontSize: 14, fontFace: 'Microsoft YaHei',
            color: theme.textDark, align: 'center'
        });
    },

    getTypeLabel(type) {
        const map = {
            product: '产品发布演示', tech: '技术方案分享', report: '行业研究报告',
            marketing: '营销策划方案', education: '培训课件', summary: '工作总结汇报'
        };
        return map[type] || '科技数码演示文稿';
    }
};
