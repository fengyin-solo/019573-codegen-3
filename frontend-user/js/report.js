/**
 * 测验成绩单管理器
 *
 * 功能：
 * - 汇总答题历史：对错、提示使用、当时参数
 * - 按知识点统计正确率
 * - 按时间绘制正确率趋势（SVG）
 * - 按题目检索、按状态筛选、按时间排序
 * - 查看单条记录：当时的解法与正确思路
 * - 重做错题 / 重做跳过的题
 * - 无历史时显示空态
 */
class ReportManager {
    constructor(app) {
        this.app = app;
        this.filterStatus = 'all'; // all | correct | wrong | skipped
        this.keyword = '';
        this.sortOrder = 'desc';   // desc：最新优先；asc：最早优先
        this.currentDetailId = null;

        this.init();
    }

    /**
     * 绑定成绩单界面事件
     */
    init() {
        const btnOpen = document.getElementById('btn-quiz-report');
        if (btnOpen) {
            btnOpen.addEventListener('click', () => this.open());
        }

        const btnClose = document.getElementById('btn-report-close');
        if (btnClose) {
            btnClose.addEventListener('click', () => this.close());
        }

        const btnDone = document.getElementById('btn-report-done');
        if (btnDone) {
            btnDone.addEventListener('click', () => this.close());
        }

        const searchInput = document.getElementById('report-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.keyword = e.target.value.trim();
                this.renderList();
            });
        }

        const sortSelect = document.getElementById('report-sort');
        if (sortSelect) {
            sortSelect.addEventListener('change', (e) => {
                this.sortOrder = e.target.value;
                this.renderList();
            });
        }

        const filters = document.getElementById('report-filters');
        if (filters) {
            filters.addEventListener('click', (e) => {
                const btn = e.target.closest('.report-filter-tab');
                if (!btn) return;
                this.filterStatus = btn.dataset.status;
                this.renderFilters();
                this.renderList();
            });
        }

        // 列表点击 -> 打开详情
        const list = document.getElementById('report-list');
        if (list) {
            list.addEventListener('click', (e) => {
                const item = e.target.closest('.report-item');
                if (!item) return;
                this.openDetail(item.dataset.id);
            });
        }

        // 重做错题 / 重做跳过题
        const btnRedo = document.getElementById('btn-report-redo');
        if (btnRedo) {
            btnRedo.addEventListener('click', () => {
                const ids = this.filterStatus === 'skipped'
                    ? this.getPendingQuestionIds('skipped')
                    : this.getPendingQuestionIds('wrong');
                if (ids.length === 0) {
                    Utils.showToast('暂时没有需要重做的题目', 'info');
                    return;
                }
                this.close();
                this.app.startRedoQuiz(ids);
            });
        }

        // 清空记录
        const btnClear = document.getElementById('btn-report-clear');
        if (btnClear) {
            btnClear.addEventListener('click', () => {
                const data = ReportStore.load();
                if (data.records.length === 0) {
                    Utils.showToast('成绩单还是空的', 'info');
                    return;
                }
                if (window.confirm('确定要清空全部答题历史吗？此操作无法恢复。')) {
                    ReportStore.clear();
                    this.keyword = '';
                    const searchInput = document.getElementById('report-search');
                    if (searchInput) searchInput.value = '';
                    this.render();
                    Utils.showToast('成绩单已清空', 'success');
                }
            });
        }

        // 详情弹窗按钮
        const btnDetailClose = document.getElementById('btn-report-detail-close');
        if (btnDetailClose) {
            btnDetailClose.addEventListener('click', () => this.closeDetail());
        }

        const btnDetailBack = document.getElementById('btn-report-detail-back');
        if (btnDetailBack) {
            btnDetailBack.addEventListener('click', () => this.closeDetail());
        }

        const btnDetailRedo = document.getElementById('btn-report-detail-redo');
        if (btnDetailRedo) {
            btnDetailRedo.addEventListener('click', () => {
                const record = this.getRecordById(this.currentDetailId);
                if (!record) return;
                this.closeDetail();
                this.close();
                this.app.startRedoQuiz([record.questionId]);
            });
        }

        // 点击遮罩关闭
        document.getElementById('report-modal').addEventListener('click', (e) => {
            if (e.target.id === 'report-modal') this.close();
        });
        document.getElementById('report-detail-modal').addEventListener('click', (e) => {
            if (e.target.id === 'report-detail-modal') this.closeDetail();
        });
    }

    /**
     * 打开成绩单
     */
    open() {
        const modal = document.getElementById('report-modal');
        if (!modal) return;
        modal.classList.remove('hidden');
        this.render();
    }

    /**
     * 关闭成绩单
     */
    close() {
        const modal = document.getElementById('report-modal');
        if (modal) modal.classList.add('hidden');
    }

    /**
     * 渲染整个成绩单
     */
    render() {
        this.renderFilters();
        this.renderSummary();
        this.renderKnowledge();
        this.renderTrend();
        this.renderList();
    }

    /**
     * 获取全部数据
     */
    getData() {
        return ReportStore.load();
    }

    getRecordById(id) {
        return this.getData().records.find(r => r.id === id) || null;
    }

    /**
     * 计算汇总统计（跳过的题单独计数，不计入正确率）
     */
    getStats(records) {
        let correct = 0;
        let wrong = 0;
        let skipped = 0;
        let hintUsed = 0;
        let score = 0;

        records.forEach(r => {
            if (r.status === 'correct') {
                correct++;
                score += r.score || 0;
            } else if (r.status === 'skipped') {
                skipped++;
            } else {
                wrong++;
            }
            if (r.hintUsed) hintUsed++;
        });

        const answered = correct + wrong;
        return {
            total: records.length,
            correct,
            wrong,
            skipped,
            answered,
            hintUsed,
            score,
            accuracy: answered > 0 ? Math.round((correct / answered) * 100) : 0
        };
    }

    /**
     * 顶部汇总卡片
     */
    renderSummary() {
        const el = document.getElementById('report-summary');
        if (!el) return;

        const data = this.getData();
        const stats = this.getStats(data.records);
        const sessionCount = data.sessions.filter(s => s.total > 0).length;

        el.innerHTML = `
            <div class="report-stat-card">
                <span class="report-stat-value">${stats.accuracy}%</span>
                <span class="report-stat-label">总正确率</span>
            </div>
            <div class="report-stat-card">
                <span class="report-stat-value">${sessionCount}</span>
                <span class="report-stat-label">测验轮次</span>
            </div>
            <div class="report-stat-card">
                <span class="report-stat-value">${stats.answered}</span>
                <span class="report-stat-label">已答题数</span>
            </div>
            <div class="report-stat-card correct">
                <span class="report-stat-value">${stats.correct}</span>
                <span class="report-stat-label">答对</span>
            </div>
            <div class="report-stat-card wrong">
                <span class="report-stat-value">${stats.wrong}</span>
                <span class="report-stat-label">答错</span>
            </div>
            <div class="report-stat-card skipped">
                <span class="report-stat-value">${stats.skipped}</span>
                <span class="report-stat-label">跳过</span>
            </div>
        `;
    }

    /**
     * 状态筛选标签（带各状态数量）
     */
    renderFilters() {
        const el = document.getElementById('report-filters');
        if (!el) return;

        const records = this.getData().records;
        const counts = {
            all: records.length,
            correct: records.filter(r => r.status === 'correct').length,
            wrong: records.filter(r => r.status === 'wrong').length,
            skipped: records.filter(r => r.status === 'skipped').length
        };

        const tabs = [
            { key: 'all', label: '全部' },
            { key: 'correct', label: '答对' },
            { key: 'wrong', label: '答错' },
            { key: 'skipped', label: '跳过' }
        ];

        el.innerHTML = tabs.map(tab => `
            <button class="report-filter-tab ${this.filterStatus === tab.key ? 'active' : ''}"
                    data-status="${tab.key}">
                ${tab.label} <span class="report-filter-count">${counts[tab.key]}</span>
            </button>
        `).join('');

        // 根据当前标签更新重做按钮文案
        const btnRedo = document.getElementById('btn-report-redo');
        if (btnRedo) {
            if (this.filterStatus === 'skipped') {
                const n = this.getPendingQuestionIds('skipped').length;
                btnRedo.textContent = `重做跳过题（${n}）`;
                btnRedo.disabled = n === 0;
            } else {
                const n = this.getPendingQuestionIds('wrong').length;
                btnRedo.textContent = `重做错题（${n}）`;
                btnRedo.disabled = n === 0;
            }
        }
    }

    /**
     * 按知识点统计正确率（正确率最低的排最前，方便查漏补缺）
     */
    renderKnowledge() {
        const el = document.getElementById('report-knowledge');
        if (!el) return;

        const groups = {};
        this.getData().records.forEach(r => {
            if (!r.knowledgePoint) return;
            if (!groups[r.knowledgePoint]) {
                groups[r.knowledgePoint] = { answered: 0, correct: 0, skipped: 0 };
            }
            if (r.status === 'skipped') {
                groups[r.knowledgePoint].skipped++;
            } else {
                groups[r.knowledgePoint].answered++;
                if (r.status === 'correct') groups[r.knowledgePoint].correct++;
            }
        });

        const rows = Object.keys(groups)
            .map(kp => {
                const g = groups[kp];
                return {
                    name: kp,
                    answered: g.answered,
                    correct: g.correct,
                    skipped: g.skipped,
                    accuracy: g.answered > 0 ? Math.round((g.correct / g.answered) * 100) : null
                };
            })
            .sort((a, b) => {
                if (a.accuracy === null) return -1;
                if (b.accuracy === null) return 1;
                return a.accuracy - b.accuracy;
            });

        if (rows.length === 0) {
            el.innerHTML = '<p class="report-section-empty">完成答题后，这里会按知识点统计正确率</p>';
            return;
        }

        el.innerHTML = rows.map(row => {
            const accText = row.accuracy === null ? '未作答' : `${row.accuracy}%`;
            const barWidth = row.accuracy === null ? 0 : row.accuracy;
            const barClass = row.accuracy === null
                ? 'skipped'
                : row.accuracy >= 80 ? 'good' : row.accuracy >= 60 ? 'medium' : 'bad';
            const skippedText = row.skipped > 0 ? ` · 跳过 ${row.skipped}` : '';
            return `
                <div class="kp-row">
                    <div class="kp-row-head">
                        <span class="kp-name">${Utils.escapeHtml(row.name)}</span>
                        <span class="kp-acc">${accText}</span>
                    </div>
                    <div class="kp-bar-track">
                        <div class="kp-bar-fill ${barClass}" style="width:${barWidth}%"></div>
                    </div>
                    <div class="kp-row-meta">答对 ${row.correct}/${row.answered}${skippedText}</div>
                </div>
            `;
        }).join('');
    }

    /**
     * 按时间绘制正确率趋势
     * - 跨过多轮测验：按轮次连接正确率
     * - 仅有一轮：按作答顺序绘制累计正确率
     */
    renderTrend() {
        const el = document.getElementById('report-trend');
        if (!el) return;

        const data = this.getData();

        // 优先按轮次统计（至少 2 个有作答记录的轮次）
        const sessionPoints = data.sessions
            .filter(s => s.total - s.skipped > 0 && s.endTime)
            .map(s => ({
                time: s.endTime,
                accuracy: Math.round((s.correct / (s.total - s.skipped)) * 100),
                label: '本轮正确率'
            }))
            .sort((a, b) => a.time - b.time);

        if (sessionPoints.length >= 2) {
            el.innerHTML = this.buildTrendSvg(sessionPoints, '按测验轮次');
            return;
        }

        // 单轮内按时间累计正确率
        const answerRecords = data.records
            .filter(r => r.status !== 'skipped')
            .sort((a, b) => a.timestamp - b.timestamp);

        if (answerRecords.length >= 2) {
            let correct = 0;
            const points = answerRecords.map((r, i) => {
                if (r.status === 'correct') correct++;
                return {
                    time: r.timestamp,
                    accuracy: Math.round((correct / (i + 1)) * 100),
                    label: `第 ${i + 1} 题后累计正确率`
                };
            });
            el.innerHTML = this.buildTrendSvg(points, '按作答时间（累计正确率）');
            return;
        }

        el.innerHTML = `
            <div class="report-chart-empty">
                <span class="report-chart-empty-icon">📈</span>
                <p>完成至少 2 次作答后，这里会显示正确率随时间的变化趋势</p>
            </div>
        `;
    }

    /**
     * 构建趋势折线图（内联 SVG，无需第三方依赖）
     */
    buildTrendSvg(points, caption) {
        const width = 460;
        const height = 170;
        const padLeft = 38;
        const padRight = 14;
        const padTop = 16;
        const padBottom = 30;
        const chartW = width - padLeft - padRight;
        const chartH = height - padTop - padBottom;

        const xAt = (i) => {
            if (points.length === 1) return padLeft + chartW / 2;
            return padLeft + (chartW * i) / (points.length - 1);
        };
        const yAt = (acc) => padTop + chartH * (1 - acc / 100);

        const gridLines = [0, 50, 100].map(v => {
            const y = yAt(v);
            return `
                <line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}"
                      class="trend-grid-line"/>
                <text x="${padLeft - 6}" y="${y + 3}" class="trend-axis-label"
                      text-anchor="end">${v}%</text>
            `;
        }).join('');

        const polylinePoints = points
            .map((p, i) => `${xAt(i).toFixed(1)},${yAt(p.accuracy).toFixed(1)}`)
            .join(' ');

        const circles = points.map((p, i) => `
            <circle cx="${xAt(i).toFixed(1)}" cy="${yAt(p.accuracy).toFixed(1)}" r="4"
                    class="trend-point">
                <title>${p.label}：${p.accuracy}%（${Utils.formatDate(p.time)}）</title>
            </circle>
        `).join('');

        const firstTime = Utils.formatDate(points[0].time);
        const lastTime = Utils.formatDate(points[points.length - 1].time);

        return `
            <svg class="trend-svg" viewBox="0 0 ${width} ${height}" role="img"
                 aria-label="正确率趋势图">
                ${gridLines}
                <polyline points="${polylinePoints}" class="trend-line"/>
                ${circles}
                <text x="${padLeft}" y="${height - 8}" class="trend-axis-label">${firstTime}</text>
                <text x="${width - padRight}" y="${height - 8}" class="trend-axis-label"
                      text-anchor="end">${lastTime}</text>
            </svg>
            <div class="trend-caption">${caption}，共 ${points.length} 个数据点</div>
        `;
    }

    /**
     * 筛选 + 检索 + 排序后的记录
     */
    getFilteredRecords() {
        const kw = this.keyword.toLowerCase();
        return this.getData().records
            .filter(r => {
                if (this.filterStatus !== 'all' && r.status !== this.filterStatus) {
                    return false;
                }
                if (!kw) return true;
                const haystack = [
                    r.title,
                    r.knowledgePoint,
                    r.description,
                    r.questionId
                ].filter(Boolean).join(' ').toLowerCase();
                return haystack.includes(kw);
            })
            .sort((a, b) => this.sortOrder === 'desc'
                ? b.timestamp - a.timestamp
                : a.timestamp - b.timestamp);
    }

    /**
     * 渲染记录列表 / 空态
     */
    renderList() {
        const listEl = document.getElementById('report-list');
        const emptyEl = document.getElementById('report-empty');
        if (!listEl || !emptyEl) return;

        const totalCount = this.getData().records.length;
        const records = this.getFilteredRecords();

        if (totalCount === 0) {
            listEl.innerHTML = '';
            listEl.classList.add('hidden');
            emptyEl.classList.remove('hidden');
            emptyEl.innerHTML = `
                <div class="empty-icon">📝</div>
                <p class="report-empty-title">还没有答题记录</p>
                <p class="report-empty-desc">完成一轮测验后，每道题的对错、提示使用情况和当时的参数
                    都会自动整理到这里，再次打开页面也不会丢失。</p>
            `;
            return;
        }

        emptyEl.classList.add('hidden');

        if (records.length === 0) {
            listEl.classList.remove('hidden');
            listEl.innerHTML = `
                <div class="report-filter-empty">
                    <span class="empty-icon">🔍</span>
                    <p>没有符合条件的答题记录</p>
                </div>`;
            return;
        }

        listEl.classList.remove('hidden');
        listEl.innerHTML = records.map(r => this.renderItem(r)).join('');
    }

    /**
     * 单条记录卡片
     */
    renderItem(r) {
        const statusMap = {
            correct: { text: '答对', cls: 'correct' },
            wrong: { text: '答错', cls: 'wrong' },
            skipped: { text: '跳过', cls: 'skipped' }
        };
        const st = statusMap[r.status] || statusMap.wrong;
        const scoreText = r.status === 'skipped'
            ? '不计分'
            : r.status === 'correct' ? `+${r.score}分` : '0分';

        return `
            <div class="report-item" data-id="${r.id}" role="button" tabindex="0">
                <div class="report-item-main">
                    <div class="report-item-title">
                        ${Utils.escapeHtml(r.title)}
                        <span class="report-kp-tag">${Utils.escapeHtml(r.knowledgePoint || '综合')}</span>
                    </div>
                    <div class="report-item-meta">
                        <span class="status-badge ${st.cls}">${st.text}</span>
                        <span class="report-item-score">${scoreText}</span>
                        ${r.hintUsed ? '<span class="hint-badge">💡 用过提示</span>' : ''}
                        <span class="report-item-date">${Utils.formatDate(r.timestamp)}</span>
                    </div>
                </div>
                <span class="report-item-arrow" aria-hidden="true">›</span>
            </div>
        `;
    }

    /**
     * 打开单条记录详情：当时的解法与正确思路
     */
    openDetail(recordId) {
        const record = this.getRecordById(recordId);
        if (!record) return;
        this.currentDetailId = recordId;

        const statusMap = {
            correct: { text: '回答正确', cls: 'correct', icon: '🎉' },
            wrong: { text: '回答错误', cls: 'wrong', icon: '😅' },
            skipped: { text: '本题跳过', cls: 'skipped', icon: '⏭️' }
        };
        const st = statusMap[record.status] || statusMap.wrong;

        document.getElementById('report-detail-title').textContent = record.title;
        const body = document.getElementById('report-detail-body');

        body.innerHTML = `
            <div class="detail-head">
                <span class="status-badge ${st.cls}">${st.icon} ${st.text}</span>
                <span class="report-item-date">${Utils.formatDate(record.timestamp)}</span>
            </div>
            <p class="detail-kp">知识点：${Utils.escapeHtml(record.knowledgePoint || '综合应用')}</p>
            <p class="detail-desc">${Utils.escapeHtml(record.description || '')}</p>

            <div class="detail-subhead">💡 提示使用</div>
            <div class="detail-box">
                ${record.hintUsed
                    ? `本题使用过提示${record.hint ? '：<br>' + Utils.escapeHtml(record.hint) : '（答对只得 5 分）'}`
                    : '本题没有使用提示'}
            </div>

            <div class="detail-subhead">⚙️ 当时的参数</div>
            <div class="detail-box">${this.renderParams(record)}</div>

            ${record.details && record.details.length > 0 ? `
                <div class="detail-subhead">🔎 判分明细</div>
                <div class="quiz-result-details" style="display:flex">
                    ${record.details.map(detail => `
                        <div class="result-detail-item">
                            <span class="result-detail-name">${Utils.escapeHtml(detail.name)}</span>
                            <div class="result-detail-values">
                                <span class="result-detail-expected">期望：${Utils.escapeHtml(String(detail.expected))}</span>
                                <span class="result-detail-arrow">→</span>
                                <span class="result-detail-actual">实际：${Utils.escapeHtml(String(detail.actual))}</span>
                                <span class="result-detail-status ${detail.correct ? 'correct' : 'incorrect'}">
                                    ${detail.correct ? '✓' : '✗'}
                                </span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            ` : ''}

            <div class="detail-subhead">📝 当时的解法反馈</div>
            <div class="detail-box detail-explanation">${Utils.escapeHtml(record.explanation || '')}</div>

            <div class="detail-subhead">✅ 正确思路</div>
            <div class="detail-box detail-solution">${Utils.escapeHtml(record.solution || '')}</div>
        `;

        // 答错或跳过的题支持直接重做
        const btnRedo = document.getElementById('btn-report-detail-redo');
        if (btnRedo) {
            btnRedo.classList.toggle('hidden', record.status === 'correct');
        }

        document.getElementById('report-detail-modal').classList.remove('hidden');
    }

    /**
     * 渲染当时参数快照
     */
    renderParams(record) {
        if (!record.params) {
            return '<span class="param-empty">提交时画布上没有放置透镜（已跳过 / 未作答）</span>';
        }
        const p = record.params;
        const rows = [
            ['透镜类型', p.typeName],
            ['材料', p.materialName],
            ['折射率', p.refractiveIndex.toFixed(2)],
            ['曲率', `${p.curvature}%`],
            ['尺寸', `${p.size}%`],
            ['焦距', p.focalLength === null ? '无穷远' : `${p.focalLength}px`],
            ['光源模式', record.lightMode === 'parallel' ? '平行光' : '点光源'],
            ['入射角', `${record.incidentAngle}°`]
        ];
        return `
            <div class="param-snapshot-grid">
                ${rows.map(([k, v]) => `
                    <div class="param-snapshot-item">
                        <span class="param-snapshot-key">${k}</span>
                        <span class="param-snapshot-val">${Utils.escapeHtml(String(v))}</span>
                    </div>
                `).join('')}
            </div>
        `;
    }

    /**
     * 关闭详情弹窗（返回成绩单列表）
     */
    closeDetail() {
        const modal = document.getElementById('report-detail-modal');
        if (modal) modal.classList.add('hidden');
        this.currentDetailId = null;
    }

    /**
     * 获取待重做题目：取每道题“最近一次状态”符合条件的题目，去重
     * @param {string} status wrong | skipped
     */
    getPendingQuestionIds(status) {
        const latest = {};
        this.getData().records
            .slice()
            .sort((a, b) => a.timestamp - b.timestamp)
            .forEach(r => {
                latest[r.questionId] = r.status;
            });

        return Object.keys(latest)
            .filter(qid => latest[qid] === status)
            .filter(qid => CONFIG.QUIZ_QUESTIONS.some(q => q.id === qid));
    }
}
