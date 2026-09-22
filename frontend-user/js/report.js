/**
 * 测验成绩单管理器
 *
 * 功能：
 * - 汇总每轮测验的答题历史（对错 / 跳过 / 是否使用提示 / 当时的参数）
 * - 按知识点统计正确率
 * - 按时间绘制正确率趋势
 * - 支持按题目检索、按时间排序、按状态筛选
 * - 点开单条记录查看当时的解法与正确思路
 * - 错题 / 跳过题重做
 * - 数据持久化在 localStorage，重新进入页面仍可查看
 */
class ReportManager {
    constructor() {
        this.modal = document.getElementById('quiz-report-modal');
        this.body = document.getElementById('quiz-report-body');

        // 视图状态
        this.view = 'list';              // list | detail
        this.selectedRecordId = null;
        this.keyword = '';
        this.sortOrder = 'desc';        // desc 最新在前 | asc 最早在前
        this.statusFilter = 'all';      // all | correct | wrong | skipped
        this.roundFilter = null;        // 仅看某一轮
        this.groupByQuestion = true;

        if (this.modal) this.init();
    }

    /**
     * 绑定静态控件事件（只绑定一次，内容区域使用事件委托）
     */
    init() {
        // 关闭按钮 & 遮罩点击关闭
        const btnClose = document.getElementById('btn-report-close');
        if (btnClose) btnClose.addEventListener('click', () => this.close());
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) this.close();
        });

        // 内容区事件委托
        this.body.addEventListener('click', (e) => this.handleClick(e));

        // 检索输入（防抖）
        const searchInput = document.getElementById('report-search');
        if (searchInput) {
            searchInput.addEventListener('input', Utils.debounce((e) => {
                this.keyword = e.target.value.trim();
                // 有关键词时平铺展示，便于直接定位某次作答
                this.renderBody();
            }, 200));
        }

        // 时间排序
        const sortSelect = document.getElementById('report-sort');
        if (sortSelect) {
            sortSelect.addEventListener('change', (e) => {
                this.sortOrder = e.target.value;
                this.renderBody();
            });
        }

        // 分组方式
        const groupToggle = document.getElementById('btn-report-group-toggle');
        if (groupToggle) {
            groupToggle.addEventListener('click', () => {
                this.groupByQuestion = !this.groupByQuestion;
                this.renderBody();
            });
        }
    }

    /**
     * 打开成绩单
     */
    open() {
        if (!this.modal) return;
        this.view = 'list';
        this.selectedRecordId = null;
        this.keyword = '';
        this.statusFilter = 'all';
        this.roundFilter = null;
        this.groupByQuestion = true;

        const searchInput = document.getElementById('report-search');
        const sortSelect = document.getElementById('report-sort');
        if (searchInput) searchInput.value = '';
        if (sortSelect) sortSelect.value = 'desc';

        this.renderBody();
        this.modal.classList.remove('hidden');
    }

    /**
     * 关闭成绩单
     */
    close() {
        if (this.modal) this.modal.classList.add('hidden');
    }

    // ===================== 渲染入口 =====================

    renderBody() {
        const records = Storage.getQuizHistory();
        if (records.length === 0) {
            this.renderEmpty();
            return;
        }

        if (this.view === 'detail' && this.selectedRecordId) {
            this.renderDetail(records);
        } else {
            this.renderDashboard(records);
        }
    }

    /**
     * 空态说明
     */
    renderEmpty() {
        this.body.innerHTML = `
            <div class="report-empty">
                <div class="report-empty-icon">📋</div>
                <h3>还没有答题历史</h3>
                <p>完成一轮测验后，这里会自动生成你的成绩单：<br>
                   每道题的对错、跳过情况、是否用过提示，<br>
                   以及按知识点统计的正确率和进步趋势。</p>
                <button class="btn btn-primary" data-action="start-quiz">
                    <span>去做一轮测验</span>
                </button>
            </div>
        `;
    }

    /**
     * 成绩单主面板
     */
    renderDashboard(records) {
        const stats = this.computeStats(records);
        const topicStats = this.getTopicStats(records);
        const trend = this.getTrend(records);
        const rounds = Storage.getQuizRounds().slice(-10).reverse();

        this.body.innerHTML = `
            <section class="report-overview">
                ${this.overviewCard('总作答', stats.answered + stats.skipped, '题', '')}
                ${this.overviewCard('正确率', stats.accuracy, '%', stats.accuracy >= 60 ? 'good' : 'bad')}
                ${this.overviewCard('答对', stats.correct, '题', 'good')}
                ${this.overviewCard('答错', stats.wrong, '题', 'bad')}
                ${this.overviewCard('跳过', stats.skipped, '题', 'skip')}
                ${this.overviewCard('用提示', stats.hintUsed, '次', 'hint')}
            </section>

            <section class="report-section">
                <h3 class="report-section-title">📈 正确率趋势（按天）</h3>
                ${this.renderTrendChart(trend)}
            </section>

            <section class="report-section">
                <h3 class="report-section-title">📚 按知识点统计</h3>
                <div class="report-topic-list">
                    ${topicStats.map(t => this.renderTopicBar(t)).join('')}
                </div>
            </section>

            ${rounds.length ? `
            <section class="report-section">
                <h3 class="report-section-title">🗓️ 历史测验轮次</h3>
                <div class="report-round-list">
                    ${rounds.map(r => this.renderRoundChip(r)).join('')}
                </div>
                ${this.roundFilter ? `
                    <button class="btn btn-secondary btn-sm report-round-clear" data-action="clear-round">
                        查看全部记录（退出本轮筛选）
                    </button>` : ''}
            </section>` : ''}

            <section class="report-section">
                <div class="report-list-header">
                    <h3 class="report-section-title">📝 答题记录</h3>
                    <div class="report-list-actions">
                        ${stats.redoCount > 0 ? `
                        <button class="btn btn-secondary btn-sm" data-action="redo-all">
                            🔁 重做错题（${stats.redoCount}）
                        </button>` : ''}
                        <button class="btn btn-secondary btn-sm" data-action="clear">清空记录</button>
                    </div>
                </div>

                <div class="report-toolbar">
                    <input type="text" class="form-input report-search-inline"
                           placeholder="按题目 / 知识点检索…"
                           value="${this.esc(this.keyword)}" data-role="search">
                    <select class="form-input report-sort-inline" data-role="sort">
                        <option value="desc" ${this.sortOrder === 'desc' ? 'selected' : ''}>最新在前</option>
                        <option value="asc" ${this.sortOrder === 'asc' ? 'selected' : ''}>最早在前</option>
                    </select>
                </div>

                <div class="report-filter-chips">
                    ${this.filterChip('all', '全部', records.length)}
                    ${this.filterChip('correct', '答对', stats.correct)}
                    ${this.filterChip('wrong', '答错', stats.wrong)}
                    ${this.filterChip('skipped', '跳过', stats.skipped)}
                    <button class="btn btn-text btn-sm report-group-toggle" data-action="toggle-group">
                        ${this.groupByQuestion ? '按时间平铺' : '按题目分组'}
                    </button>
                </div>

                ${this.renderRecords(records)}
            </section>
        `;

        // 动态生成的检索 / 排序控件需要重新绑定
        const searchInput = this.body.querySelector('[data-role="search"]');
        if (searchInput) {
            searchInput.addEventListener('input', Utils.debounce((e) => {
                this.keyword = e.target.value.trim();
                this.renderBody();
            }, 200));
        }
        const sortSelect = this.body.querySelector('[data-role="sort"]');
        if (sortSelect) {
            sortSelect.addEventListener('change', (e) => {
                this.sortOrder = e.target.value;
                this.renderBody();
            });
        }
    }

    /**
     * 记录列表（分组 / 平铺）
     */
    renderRecords(records) {
        let list = this.filterRecords(records);

        list.sort((a, b) => this.sortOrder === 'desc'
            ? b.timestamp - a.timestamp
            : a.timestamp - b.timestamp);

        if (this.roundFilter) {
            list = list.filter(r => r.roundId === this.roundFilter);
        }

        if (list.length === 0) {
            return `<div class="report-no-match">没有符合条件的答题记录，换个关键词或筛选条件试试。</div>`;
        }

        // 检索时强制平铺，直接定位到某次作答
        if (!this.groupByQuestion || this.keyword) {
            return `<div class="report-attempt-list">
                ${list.map(r => this.renderAttemptRow(r)).join('')}
            </div>`;
        }

        // 按题目分组：组顺序跟随组内最近一次作答时间
        const groups = new Map();
        list.forEach(r => {
            if (!groups.has(r.questionId)) {
                groups.set(r.questionId, { questionId: r.questionId, title: r.title, topic: r.topic, records: [] });
            }
            groups.get(r.questionId).records.push(r);
        });
        const groupArr = Array.from(groups.values());
        groupArr.sort((g1, g2) => {
            const t1 = Math.max(...g1.records.map(r => r.timestamp));
            const t2 = Math.max(...g2.records.map(r => r.timestamp));
            return this.sortOrder === 'desc' ? t2 - t1 : t1 - t2;
        });

        return `<div class="report-group-list">
            ${groupArr.map(g => this.renderQuestionGroup(g)).join('')}
        </div>`;
    }

    /**
     * 单道题的分组卡片
     */
    renderQuestionGroup(group) {
        const latest = group.records.reduce((a, b) =>
            b.timestamp >= a.timestamp ? b : a);
        const counts = {
            correct: group.records.filter(r => r.status === 'correct').length,
            wrong: group.records.filter(r => r.status === 'wrong').length,
            skipped: group.records.filter(r => r.status === 'skipped').length
        };

        return `
            <div class="report-question-card" data-action="detail" data-id="${latest.id}">
                <div class="report-question-main">
                    <span class="report-status-dot ${latest.status}">${this.statusIcon(latest.status)}</span>
                    <div class="report-question-info">
                        <div class="report-question-title">${this.esc(group.title)}</div>
                        <div class="report-question-meta">
                            <span class="report-topic-tag">${this.esc(group.topic)}</span>
                            <span class="report-count-tag correct">对 ${counts.correct}</span>
                            <span class="report-count-tag wrong">错 ${counts.wrong}</span>
                            ${counts.skipped ? `<span class="report-count-tag skipped">跳 ${counts.skipped}</span>` : ''}
                            <span class="report-attempt-times">共答 ${group.records.length} 次</span>
                        </div>
                    </div>
                </div>
                <span class="report-chevron">›</span>
            </div>
        `;
    }

    /**
     * 单次作答行（平铺视图）
     */
    renderAttemptRow(record) {
        return `
            <div class="report-attempt-row" data-action="detail" data-id="${record.id}">
                <span class="report-status-dot ${record.status}">${this.statusIcon(record.status)}</span>
                <div class="report-attempt-info">
                    <div class="report-attempt-title">${this.esc(record.title)}</div>
                    <div class="report-attempt-meta">
                        <span class="report-topic-tag">${this.esc(record.topic || '综合')}</span>
                        ${record.roundMode === 'redo' ? '<span class="report-mode-tag redo">错题重做</span>' : ''}
                        ${record.hintUsed ? '<span class="report-hint-tag">💡 用了提示</span>' : ''}
                    </div>
                </div>
                <time class="report-attempt-time">${this.formatTime(record.timestamp)}</time>
                <span class="report-chevron">›</span>
            </div>
        `;
    }

    /**
     * 单条记录详情：当时的解法 + 正确思路
     */
    renderDetail(allRecords) {
        const record = allRecords.find(r => r.id === this.selectedRecordId) ||
                       Storage.getQuizHistory().find(r => r.id === this.selectedRecordId);
        if (!record) {
            this.view = 'list';
            this.selectedRecordId = null;
            this.renderDashboard(Storage.getQuizHistory());
            return;
        }

        const canRedo = record.status !== 'correct';
        const checks = record.userDetails || [];

        this.body.innerHTML = `
            <button class="btn btn-text btn-sm report-back" data-action="back">‹ 返回成绩单</button>

            <div class="report-detail-head">
                <span class="report-status-badge ${record.status}">${this.statusText(record.status)}</span>
                <h2 class="report-detail-title">${this.esc(record.title)}</h2>
                <div class="report-detail-meta">
                    <span class="report-topic-tag">${this.esc(record.topic || '综合')}</span>
                    <span>${this.formatTime(record.timestamp)}</span>
                    ${record.roundMode === 'redo' ? '<span class="report-mode-tag redo">错题重做</span>' : ''}
                    ${record.hintUsed ? '<span class="report-hint-tag">💡 使用过提示</span>' : ''}
                    ${record.status === 'correct' ? `<span class="report-score-tag">+${record.score} 分</span>` : ''}
                </div>
                <p class="report-detail-desc">${this.esc(record.description || '')}</p>
            </div>

            <section class="report-detail-block">
                <h3>🧪 我当时的解法</h3>
                ${record.userSolution ? `
                    <div class="report-solution-grid">
                        ${this.solutionItem('透镜类型', record.userSolution.lensTypeName)}
                        ${this.solutionItem('材料', record.userSolution.materialName)}
                        ${this.solutionItem('折射率', record.userSolution.refractiveIndex)}
                        ${this.solutionItem('曲率', record.userSolution.curvature + '%')}
                        ${this.solutionItem('尺寸', record.userSolution.size + '%')}
                        ${record.userSolution.focalLength !== null
                            ? this.solutionItem('焦距', record.userSolution.focalLength + ' px') : ''}
                        ${this.solutionItem('光源', record.userSolution.lightMode === 'parallel' ? '平行光' : '点光源')}
                    </div>
                    ${checks.length ? `
                        <div class="report-check-list">
                            ${checks.map(c => `
                                <div class="report-check-item ${c.correct ? 'correct' : 'incorrect'}">
                                    <span class="report-check-status">${c.correct ? '✓' : '✗'}</span>
                                    <span class="report-check-name">${this.esc(c.name)}</span>
                                    <span class="report-check-values">
                                        要求 ${this.esc(String(c.expected))} · 实际 ${this.esc(String(c.actual))}
                                    </span>
                                </div>
                            `).join('')}
                        </div>` : ''}
                ` : `
                    <p class="report-solution-empty">这道题被跳过了，画布上还没有放置透镜，没有留下参数记录。</p>
                `}
                ${record.receivedExplanation && record.status === 'wrong' ? `
                    <div class="report-received-explanation">${this.esc(record.receivedExplanation)}</div>` : ''}
            </section>

            <section class="report-detail-block">
                <h3>💡 正确思路</h3>
                <div class="report-require-list">
                    ${this.renderRequirements(record.requirements)}
                </div>
                <p class="report-correct-explanation">${this.esc(record.correctExplanation || '')}</p>
                ${record.hints && record.hints.length ? `
                    <details class="report-hints">
                        <summary>查看本题提示（${record.hints.length}）</summary>
                        <ul>
                            ${record.hints.map(h => `<li>${this.esc(h)}</li>`).join('')}
                        </ul>
                    </details>` : ''}
            </section>

            <div class="report-detail-actions">
                ${canRedo ? `
                    <button class="btn btn-primary" data-action="redo" data-qid="${record.questionId}">
                        🔁 重做本题
                    </button>` : ''}
                <button class="btn btn-secondary" data-action="back">返回成绩单</button>
            </div>
        `;
    }

    // ===================== 统计计算 =====================

    /**
     * 总体统计
     */
    computeStats(records) {
        const correct = records.filter(r => r.status === 'correct').length;
        const wrong = records.filter(r => r.status === 'wrong').length;
        const skipped = records.filter(r => r.status === 'skipped').length;
        const answered = correct + wrong;
        const hintUsed = records.filter(r => r.hintUsed && r.status !== 'skipped').length;

        return {
            correct,
            wrong,
            skipped,
            answered,
            hintUsed,
            accuracy: answered > 0 ? Math.round(correct / answered * 100) : 0,
            redoCount: this.getRedoQuestionIds(records).length
        };
    }

    /**
     * 按知识点统计正确率（跳过的题不计入正确率分母，单独列出）
     */
    getTopicStats(records) {
        const map = new Map();
        records.forEach(r => {
            const topic = r.topic || '综合';
            if (!map.has(topic)) {
                map.set(topic, { topic, correct: 0, wrong: 0, skipped: 0, hintUsed: 0, total: 0 });
            }
            const item = map.get(topic);
            item.total++;
            if (r.status === 'correct') item.correct++;
            else if (r.status === 'wrong') item.wrong++;
            else item.skipped++;
            if (r.hintUsed) item.hintUsed++;
        });

        return Array.from(map.values()).map(item => {
            const answered = item.correct + item.wrong;
            item.accuracy = answered > 0 ? Math.round(item.correct / answered * 100) : null;
            return item;
        }).sort((a, b) => (a.accuracy ?? 101) - (b.accuracy ?? 101));
    }

    /**
     * 按天聚合正确率趋势
     */
    getTrend(records) {
        const map = new Map();
        records.filter(r => r.status !== 'skipped').forEach(r => {
            const day = this.dayKey(r.timestamp);
            if (!map.has(day)) map.set(day, { day, correct: 0, total: 0 });
            const item = map.get(day);
            item.total++;
            if (r.status === 'correct') item.correct++;
        });

        return Array.from(map.values())
            .map(item => ({
                day: item.day,
                accuracy: item.total > 0 ? Math.round(item.correct / item.total * 100) : 0,
                total: item.total
            }))
            .sort((a, b) => a.day.localeCompare(b.day))
            .slice(-14);
    }

    /**
     * 需要重做的题目ID：
     * 最近一次非跳过作答为错误，或只有跳过记录的题
     */
    getRedoQuestionIds(records) {
        const byQuestion = new Map();
        records.forEach(r => {
            if (!byQuestion.has(r.questionId)) byQuestion.set(r.questionId, []);
            byQuestion.get(r.questionId).push(r);
        });

        const ids = [];
        byQuestion.forEach((list, questionId) => {
            const sorted = list.slice().sort((a, b) => a.timestamp - b.timestamp);
            const lastAnswered = sorted.filter(r => r.status !== 'skipped').pop();
            if (!lastAnswered) {
                ids.push(questionId); // 只跳过过，还没真正作答
            } else if (lastAnswered.status === 'wrong') {
                ids.push(questionId);
            }
        });
        return ids;
    }

    // ===================== 视图小部件 =====================

    overviewCard(label, value, unit, tone) {
        return `
            <div class="report-overview-card ${tone || ''}">
                <span class="report-overview-value">${this.esc(String(value))}<small>${unit}</small></span>
                <span class="report-overview-label">${label}</span>
            </div>
        `;
    }

    renderTopicBar(t) {
        const acc = t.accuracy === null ? '—' : t.accuracy + '%';
        const width = t.accuracy === null ? 0 : t.accuracy;
        const tone = t.accuracy === null ? '' : (t.accuracy >= 80 ? 'good' : t.accuracy < 60 ? 'bad' : 'mid');
        return `
            <div class="report-topic-item">
                <div class="report-topic-head">
                    <span class="report-topic-name">${this.esc(t.topic)}</span>
                    <span class="report-topic-stats">
                        正确率 <strong>${acc}</strong>
                        <em>（对${t.correct} 错${t.wrong}${t.skipped ? ` 跳${t.skipped}` : ''}）</em>
                    </span>
                </div>
                <div class="report-topic-track">
                    <div class="report-topic-fill ${tone}" style="width:${width}%"></div>
                </div>
            </div>
        `;
    }

    renderTrendChart(trend) {
        if (trend.length === 0) {
            return '<p class="report-trend-empty">还没有正式作答（跳过不计入趋势），答几道题后这里会画出进步曲线。</p>';
        }
        if (trend.length === 1) {
            return `<div class="report-trend-single">
                <span class="trend-dot"></span>
                ${trend[0].day}：正确率 ${trend[0].accuracy}%（${trend[0].total} 题）
                <span class="report-trend-hint">再多答几天就能看到趋势啦</span>
            </div>`;
        }

        const W = 320, H = 120, PAD_L = 30, PAD_R = 10, PAD_T = 12, PAD_B = 24;
        const innerW = W - PAD_L - PAD_R;
        const innerH = H - PAD_T - PAD_B;
        const x = i => PAD_L + (trend.length === 1 ? innerW / 2 : innerW * i / (trend.length - 1));
        const y = v => PAD_T + innerH * (1 - v / 100);

        const points = trend.map((t, i) => `${x(i).toFixed(1)},${y(t.accuracy).toFixed(1)}`).join(' ');
        const labelStep = Math.max(1, Math.ceil(trend.length / 6));

        return `
            <svg class="report-trend-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="正确率趋势">
                ${[0, 50, 100].map(v => `
                    <line x1="${PAD_L}" y1="${y(v)}" x2="${W - PAD_R}" y2="${y(v)}"
                          class="trend-grid" stroke-dasharray="${v === 0 ? '' : '3,3'}"/>
                    <text x="4" y="${y(v) + 4}" class="trend-axis-label">${v}</text>
                `).join('')}
                <polyline points="${points}" class="trend-line" fill="none"/>
                ${trend.map((t, i) => `
                    <circle cx="${x(i)}" cy="${y(t.accuracy)}" r="3.5"
                            class="trend-point ${t.accuracy >= 60 ? 'good' : 'bad'}">
                        <title>${t.day}：${t.accuracy}%（${t.total} 题）</title>
                    </circle>
                    ${i % labelStep === 0 || i === trend.length - 1 ? `
                        <text x="${x(i)}" y="${H - 6}" class="trend-x-label"
                              text-anchor="middle">${t.day.slice(5)}</text>` : ''}
                `).join('')}
            </svg>
        `;
    }

    renderRoundChip(round) {
        const active = this.roundFilter === round.id;
        const label = round.mode === 'redo' ? '错题重做' : '常规测验';
        const answered = (round.correct || 0) + (round.wrong || 0);
        const acc = answered > 0 ? Math.round(round.correct / answered * 100) : 0;
        return `
            <button class="report-round-chip ${active ? 'active' : ''}"
                    data-action="filter-round" data-id="${round.id}"
                    title="点击只看这一轮的答题记录">
                <span class="round-chip-title">${label}</span>
                <span class="round-chip-time">${this.formatTime(round.startedAt)}</span>
                <span class="round-chip-stats">
                    对${round.correct || 0} · 错${round.wrong || 0}
                    ${round.skipped ? ` · 跳${round.skipped}` : ''} · ${acc}%
                </span>
            </button>
        `;
    }

    renderRequirements(req) {
        if (!req) return '';
        const items = [];
        const typeNames = { convex: '凸透镜', concave: '凹透镜', plano: '平面透镜', aspheric: '非球面透镜' };
        const materialNames = { normal: '普通玻璃', highIndex: '高折射率镜片', lowDispersion: '低色散镜片' };

        if (req.lensType) items.push(`透镜类型：<strong>${typeNames[req.lensType] || req.lensType}</strong>`);
        if (req.material) items.push(`材料：<strong>${materialNames[req.material] || req.material}</strong>`);
        if (req.lightMode) items.push(`光源：<strong>${req.lightMode === 'parallel' ? '平行光' : '点光源'}</strong>`);
        if (req.minRefractiveIndex || req.maxRefractiveIndex) {
            items.push(`折射率：<strong>${req.minRefractiveIndex || 1.0} ~ ${req.maxRefractiveIndex || 2.0}</strong>`);
        }
        if (req.minCurvature || req.maxCurvature) {
            items.push(`曲率：<strong>${req.minCurvature || 0}% ~ ${req.maxCurvature || 100}%</strong>`);
        }
        if (req.minFocalLength || req.maxFocalLength) {
            items.push(`焦距：<strong>${req.minFocalLength || 50} ~ ${req.maxFocalLength || 500} px</strong>`);
        }

        if (items.length === 0) {
            return '<span class="report-require-empty">按题目描述在画布上完成实验即可</span>';
        }
        return items.map(t => `<span class="report-require-chip">${t}</span>`).join('');
    }

    filterChip(value, label, count) {
        const active = this.statusFilter === value;
        return `
            <button class="report-filter-chip ${active ? 'active' : ''}"
                    data-action="filter" data-filter="${value}">
                ${label} <em>${count}</em>
            </button>
        `;
    }

    solutionItem(label, value) {
        return `<div class="report-solution-item">
            <span class="solution-label">${label}</span>
            <span class="solution-value">${this.esc(String(value))}</span>
        </div>`;
    }

    // ===================== 交互处理 =====================

    handleClick(e) {
        const target = e.target.closest('[data-action]');
        if (!target || !this.body.contains(target)) return;

        const action = target.dataset.action;

        switch (action) {
        case 'start-quiz':
            this.close();
            window.dispatchEvent(new CustomEvent('requestStartQuiz'));
            break;
        case 'clear':
            if (window.confirm('确定要清空全部答题历史和轮次记录吗？此操作不可恢复。')) {
                Storage.clearQuizHistory();
                this.open();
                Utils.showToast('成绩单已清空', 'info');
            }
            break;
        case 'redo-all': {
            const ids = this.getRedoQuestionIds(Storage.getQuizHistory());
            this.startRedo(ids);
            break;
        }
        case 'detail':
            this.view = 'detail';
            this.selectedRecordId = target.dataset.id;
            this.renderBody();
            this.body.scrollTop = 0;
            break;
        case 'redo':
            this.startRedo([target.dataset.qid]);
            break;
        case 'back':
            this.view = 'list';
            this.selectedRecordId = null;
            this.renderBody();
            break;
        case 'filter':
            this.statusFilter = target.dataset.filter;
            this.renderBody();
            break;
        case 'filter-round':
            this.roundFilter = target.dataset.id;
            this.renderBody();
            break;
        case 'clear-round':
            this.roundFilter = null;
            this.renderBody();
            break;
        case 'toggle-group':
            this.groupByQuestion = !this.groupByQuestion;
            this.renderBody();
            break;
        }
    }

    /**
     * 发起错题重做
     */
    startRedo(questionIds) {
        if (!questionIds || questionIds.length === 0) {
            Utils.showToast('当前没有需要重做的题目', 'info');
            return;
        }
        this.close();
        window.dispatchEvent(new CustomEvent('requestRedo', {
            detail: { questionIds }
        }));
    }

    // ===================== 工具方法 =====================

    filterRecords(records) {
        let list = records;

        if (this.statusFilter !== 'all') {
            list = list.filter(r => r.status === this.statusFilter);
        }

        if (this.keyword) {
            const kw = this.keyword.toLowerCase();
            list = list.filter(r =>
                (r.title || '').toLowerCase().includes(kw) ||
                (r.topic || '').toLowerCase().includes(kw)
            );
        }

        return list;
    }

    statusIcon(status) {
        return { correct: '✓', wrong: '✗', skipped: '⏭' }[status] || '?';
    }

    statusText(status) {
        return { correct: '回答正确', wrong: '回答错误', skipped: '已跳过' }[status] || '';
    }

    dayKey(ts) {
        const d = new Date(ts);
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${d.getFullYear()}-${m}-${day}`;
    }

    formatTime(ts) {
        return Utils.formatDate(ts);
    }

    esc(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
}
