/**
 * 成绩单 UI 渲染冒烟测试：精简 DOM mock
 * 运行：node /workspace/test-report-ui.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.join(__dirname, 'frontend-user', 'js');

function mkClassList() {
    const set = new Set();
    return {
        add: c => set.add(c),
        remove: c => set.delete(c),
        contains: c => set.has(c),
        toggle: c => set.has(c) ? set.delete(c) : set.add(c)
    };
}

function mkElement(tag = 'div') {
    const el = {
        tagName: tag.toUpperCase(),
        classList: mkClassList(),
        _innerHTML: '',
        _text: '',
        _value: '',
        style: {},
        dataset: {},
        scrollTop: 0,
        listeners: {},
        addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
        appendChild() {},
        remove() {},
        contains: () => true,
        querySelector: () => mkElement('input'),
        querySelectorAll: () => [],
        get textContent() { return this._text; },
        set textContent(v) { this._text = v; },
        get value() { return this._value; },
        set value(v) { this._value = v; },
        get innerHTML() { return this._innerHTML; },
        set innerHTML(v) { this._innerHTML = v; }
    };
    return el;
}

const store = {};
const ids = {};
const getEl = id => { if (!ids[id]) ids[id] = mkElement(); return ids[id]; };
const winListeners = {};

const sandbox = {
    console,
    localStorage: {
        getItem: k => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: k => { delete store[k]; }
    },
    window: {
        innerWidth: 1024,
        addEventListener: (t, fn) => { (winListeners[t] = winListeners[t] || []).push(fn); },
        dispatchEvent: evt => (winListeners[evt.type] || []).forEach(fn => fn(evt))
    },
    document: {
        readyState: 'loading',
        addEventListener: () => {},
        getElementById: getEl,
        querySelector: () => null,
        createElement: () => mkElement()
    },
    confirm: () => true,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    Date, Math, JSON, Object, Array, String, Number
};
sandbox.CustomEvent = function (type, opts) { this.type = type; this.detail = opts && opts.detail; };
vm.createContext(sandbox);

const load = f => vm.runInContext(fs.readFileSync(path.join(JS_DIR, f), 'utf8'), sandbox, { filename: f });
['config.js', 'utils.js', 'storage.js', 'physics.js', 'lens.js', 'renderer.js', 'canvas.js', 'quiz.js', 'report.js'].forEach(load);
vm.runInContext('globalThis.CONFIG=CONFIG; globalThis.Storage=Storage; globalThis.Lens=Lens; globalThis.QuizManager=QuizManager; globalThis.ReportManager=ReportManager;', sandbox);

let pass = 0, fail = 0;
function assert(cond, msg) {
    if (cond) { pass++; console.log('  ✓', msg); }
    else { fail++; console.error('  ✗', msg); }
}
const bodyHTML = () => getEl('quiz-report-body')._innerHTML;

// 模拟点击 data-action 元素
function click(dataset) {
    const target = mkElement();
    target.dataset = dataset;
    target.closest = sel => (sel && dataset.action) ? target : null;
    const evt = { target };
    getEl('quiz-report-body').listeners.click.forEach(fn => fn(evt));
}

console.log('\n=== 1. 无历史时空态 ===');
const rm = new sandbox.ReportManager();
rm.open();
assert(bodyHTML().includes('还没有答题历史'), '渲染空态说明');
assert(bodyHTML().includes('start-quiz'), '空态有「去做一轮测验」入口');
assert(!getEl('quiz-report-modal').classList.contains('hidden'), '成绩单已显示');
rm.close();
assert(getEl('quiz-report-modal').classList.contains('hidden'), '成绩单可关闭');

console.log('\n=== 2. 制造答题历史（对/错/跳各一）===');
const mkLens = o => new sandbox.Lens(Object.assign({ type: 'convex', material: 'normal', refractiveIndex: 1.5, curvature: 50, size: 100 }, o));
const mkCanvas = (lensOver, mode = 'parallel') => ({
    lenses: lensOver === null ? [] : [mkLens(lensOver)],
    getRenderer: () => ({ lightMode: mode, incidentAngle: 0 })
});
const qm = new sandbox.QuizManager(mkCanvas());
qm.isQuizMode = true;
const focusQ = sandbox.CONFIG.QUIZ_QUESTIONS.find(q => q.id === 'focus_convex');
qm.startRound();
qm.currentQuestion = focusQ;
qm.hintUsed = true;
qm.submitAnswer();
qm.canvasManager = mkCanvas({ type: 'concave' });
qm.currentQuestion = focusQ;
qm.submitAnswer();
qm.canvasManager = mkCanvas(null);
qm.currentQuestion = focusQ;
qm.skipQuestion();
qm.stopQuizMode();
assert(sandbox.Storage.getQuizHistory().length === 3, '生成 3 条历史');

console.log('\n=== 3. 打开成绩单：主面板各模块 ===');
rm.open();
const html = bodyHTML();
assert(html.includes('正确率趋势'), '有趋势区');
assert(html.includes('按知识点统计'), '有知识点统计区');
assert(html.includes('答题记录'), '有答题记录区');
assert(html.includes('历史测验轮次'), '有轮次区');
assert(html.includes('平行光聚焦实验'), '记录中显示题目标题');
assert(html.includes('重做错题（1）'), '错题重做按钮带数量');
assert(html.includes('对 1') && html.includes('错 1') && html.includes('跳 1'), '分组卡片显示对/错/跳计数');

console.log('\n=== 4. 筛选答错 ===');
click({ action: 'filter', filter: 'wrong' });
assert(rm.statusFilter === 'wrong', '切换到 wrong 筛选');

console.log('\n=== 5. 检索（按题目关键词）===');
rm.keyword = '聚焦';
rm.groupByQuestion = true; // 有关键词时强制平铺
rm.renderBody();
assert(bodyHTML().includes('平行光聚焦实验'), '关键词命中题目');
rm.keyword = '不存在的题xyz';
rm.renderBody();
assert(bodyHTML().includes('没有符合条件'), '无命中时给出提示');
rm.keyword = '';

console.log('\n=== 6. 时间排序 ===');
rm.sortOrder = 'asc';
rm.renderBody();
// 不报错即可
assert(true, '最早在前排序渲染成功');

console.log('\n=== 7. 打开单条详情 ===');
rm.sortOrder = 'desc';
rm.renderBody();
const wrongId = sandbox.Storage.getQuizHistory().find(r => r.status === 'wrong').id;
click({ action: 'detail', id: wrongId });
assert(rm.view === 'detail' && rm.selectedRecordId === wrongId, '进入详情视图');
const detailHtml = bodyHTML();
assert(detailHtml.includes('我当时的解法'), '详情显示当时的解法');
assert(detailHtml.includes('正确思路'), '详情显示正确思路');
assert(detailHtml.includes('透镜类型'), '详情显示当时参数项');
assert(detailHtml.includes('重做本题'), '错误/跳过记录可重做本题');
assert(detailHtml.includes('凸透镜'), '正确思路中包含要求的透镜类型');
assert(detailHtml.includes('查看本题提示'), '可展开题目提示');

console.log('\n=== 8. 详情返回 ===');
click({ action: 'back' });
assert(rm.view === 'list', '返回列表视图');

console.log('\n=== 9. 答对的记录不显示重做按钮 ===');
const correctId = sandbox.Storage.getQuizHistory().find(r => r.status === 'correct').id;
click({ action: 'detail', id: correctId });
assert(!bodyHTML().includes('重做本题'), '答对的记录不提供重做');
click({ action: 'back' });

console.log('\n=== 10. 跳过记录详情显示空参数说明 ===');
const skipped = sandbox.Storage.getQuizHistory().find(r => r.status === 'skipped');
click({ action: 'detail', id: skipped.id });
assert(bodyHTML().includes('没有留下参数记录'), '跳过记录说明无参数');
click({ action: 'back' });

console.log('\n=== 11. 重做本题派发 requestRedo ===');
let redoPayload = null;
winListeners.requestRedo = [e => { redoPayload = e.detail; }];
click({ action: 'detail', id: skipped.id });
click({ action: 'redo', qid: skipped.questionId });
assert(redoPayload && redoPayload.questionIds[0] === 'focus_convex', '派发 requestRedo 并带上题目ID');
assert(getEl('quiz-report-modal').classList.contains('hidden'), '发起重做时关闭成绩单');

console.log('\n=== 12. 一键重做全部错题 ===');
rm.open();
let redoAllPayload = null;
winListeners.requestRedo = [e => { redoAllPayload = e.detail; }];
click({ action: 'redo-all' });
assert(redoAllPayload && redoAllPayload.questionIds.length === 1, '一键重做派发错题集合');

console.log('\n=== 13. 轮次筛选 ===');
rm.open();
const roundId = sandbox.Storage.getQuizRounds()[0].id;
click({ action: 'filter-round', id: roundId });
assert(rm.roundFilter === roundId, '可按轮次筛选');
assert(bodyHTML().includes('退出本轮筛选'), '显示退出筛选入口');
click({ action: 'clear-round' });
assert(rm.roundFilter === null, '退出轮次筛选');

console.log('\n=== 14. 空态按钮发起测验 ===');
sandbox.Storage.clearQuizHistory();
rm.open();
assert(bodyHTML().includes('还没有答题历史'), '清空后回到空态');
let startRequested = false;
winListeners.requestStartQuiz = [() => { startRequested = true; }];
click({ action: 'start-quiz' });
assert(startRequested, '空态按钮派发 requestStartQuiz');

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
