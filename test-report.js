/**
 * 成绩单功能的逻辑测试：在 Node 中模拟浏览器环境
 * 运行：node /workspace/test-report.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const JS_DIR = path.join(__dirname, 'frontend-user', 'js');

// ---- 浏览器环境 mock ----
const storage = {};
const listeners = {};
const sandbox = {
    console,
    localStorage: {
        getItem: k => (k in storage ? storage[k] : null),
        setItem: (k, v) => { storage[k] = String(v); },
        removeItem: k => { delete storage[k]; }
    },
    window: {
        innerWidth: 1024,
        addEventListener: () => {},
        dispatchEvent: (evt) => {
            (listeners[evt.type] || []).forEach(fn => fn(evt));
        }
    },
    document: {
        readyState: 'complete',
        addEventListener: () => {},
        getElementById: () => null,
        querySelector: () => null,
        createElement: () => ({ classList: { add: () => {}, remove: () => {} }, remove: () => {} })
    },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    Date, Math, JSON, Object, Array, String, Number, isNaN, isFinite
};
sandbox.CustomEvent = function (type, opts) { this.type = type; this.detail = opts && opts.detail; };
sandbox.navigator = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// report.js 构造函数会访问 DOM，单独屏蔽
const load = file => vm.runInContext(fs.readFileSync(path.join(JS_DIR, file), 'utf8'), sandbox, { filename: file });
['config.js', 'utils.js', 'storage.js', 'physics.js', 'lens.js', 'renderer.js', 'quiz.js', 'report.js'].forEach(load);
// 顶层 class/const 是词法绑定，显式挂到全局供测试使用
vm.runInContext('globalThis.CONFIG=CONFIG; globalThis.Storage=Storage; globalThis.Lens=Lens; globalThis.QuizManager=QuizManager; globalThis.ReportManager=ReportManager;', sandbox);

let pass = 0, fail = 0;
function assert(cond, msg) {
    if (cond) { pass++; console.log('  ✓', msg); }
    else { fail++; console.error('  ✗', msg); }
}

// ---- mock canvasManager / renderer ----
const mkLens = (over = {}) => new (sandbox.Lens)(Object.assign({
    type: 'convex', material: 'normal', refractiveIndex: 1.5, curvature: 50, size: 100
}, over));

const mkCanvas = (lensOver = {}, lightMode = 'parallel') => ({
    lenses: lensOver === null ? [] : [mkLens(lensOver)],
    getRenderer() {
        return { lightMode, incidentAngle: 0, isRunning: true };
    }
});

console.log('\n=== 1. 完整测验流程：正确作答 + 错误 + 跳过 + 用提示 ===');
const QuizManager = sandbox.QuizManager;
let qm = new QuizManager(mkCanvas());

// 强制指定题目
const focusQ = sandbox.CONFIG.QUIZ_QUESTIONS.find(q => q.id === 'focus_convex');
qm.isQuizMode = true;
qm.hintUsed = true;
qm.startRound();
qm.currentQuestion = focusQ;
let r1 = qm.submitAnswer();
assert(r1.isCorrect === true, '凸透镜正确作答判定为正确');
assert(r1.score === 5, '使用提示后只得 5 分');

// 错误作答（凹透镜做凸透镜题）
qm.currentQuestion = focusQ;
qm.hintUsed = false;
qm.canvasManager = mkCanvas({ type: 'concave' });
let r2 = qm.submitAnswer();
assert(r2.isCorrect === false, '凹透镜判定为错误');

// 跳过（模拟画布上没有透镜）
qm.canvasManager = mkCanvas(null);
qm.currentQuestion = focusQ;
qm.hintUsed = false;
const skipRec = qm.skipQuestion();
assert(skipRec.status === 'skipped' && skipRec.skipped === true, '跳过记录状态为 skipped');

const round = qm.stopQuizMode();
assert(round.total === 3 && round.correct === 1 && round.wrong === 1 && round.skipped === 1,
    `轮次统计正确（${JSON.stringify({ t: round.total, c: round.correct, w: round.wrong, s: round.skipped })}）`);

console.log('\n=== 2. 持久化与记录字段 ===');
const history = sandbox.Storage.getQuizHistory();
assert(history.length === 3, 'localStorage 中保留 3 条记录');
assert(history[0].topic === '凸透镜成像', '记录包含知识点 topic');
assert(history[0].roundId === history[1].roundId, '同一轮记录共享 roundId');
assert(history[0].userSolution && history[0].userSolution.lensType === 'convex', '记录包含当时参数 userSolution');
assert(history[0].userSolution.refractiveIndex === 1.5, '记录折射率参数');
assert(history[0].correctExplanation && history[0].correctExplanation.length > 0, '记录包含正确思路');
assert(history[0].requirements.lensType === 'convex', '记录包含题目要求');
assert(history[0].hints.length === 3, '记录包含题目提示');
assert(history[2].userSolution === null, '跳过时画布参数为 null');
assert(sandbox.Storage.getQuizRounds().length === 1, 'localStorage 中保留 1 轮记录');

console.log('\n=== 3. 无透镜提交不计入历史 ===');
let qm2 = new QuizManager(mkCanvas(null));
qm2.currentQuestion = focusQ;
const early = qm2.submitAnswer();
assert(early.isCorrect === false && early.details.length === 0, '无透镜时返回提示');
assert(sandbox.Storage.getQuizHistory().length === 3, '未真正提交，历史仍为 3 条');

console.log('\n=== 4. 模拟"重新进入页面"：数据仍在 ===');
const historyReload = sandbox.Storage.getQuizHistory();
assert(historyReload.length === 3, '重新加载后历史仍在（localStorage 持久化）');

console.log('\n=== 5. ReportManager 统计逻辑（只测纯计算方法） ===');
// 直接 new 一个 ReportManager 需要 DOM，改成通过原型对象借用全部方法
const RP = sandbox.ReportManager.prototype;
const fakeReport = Object.create(RP);
const compute = RP.computeStats.call(fakeReport, historyReload);
assert(compute.correct === 1 && compute.wrong === 1 && compute.skipped === 1, `总览统计正确 ${JSON.stringify(compute)}`);
assert(compute.accuracy === 50, '正确率排除跳过题：1/(1+1)=50%');
assert(compute.redoCount === 1, '错题重做集合含 focus_convex（最近作答为错…实际最后为跳过）');

// focus_convex 的最后非跳过记录是 wrong → 需要重做
const redoIds = RP.getRedoQuestionIds.call(fakeReport, historyReload);
assert(redoIds.includes('focus_convex'), 'focus_convex 在错题重做集合中');

const topicStats = RP.getTopicStats.call(fakeReport, historyReload);
assert(topicStats.some(t => t.topic === '凸透镜成像' && t.accuracy === 50), '知识点正确率 50%');
assert(topicStats[0].skipped === 1, '知识点跳过单独计数');

const trend = RP.getTrend.call(fakeReport, historyReload);
assert(trend.length === 1 && trend[0].accuracy === 50 && trend[0].total === 2, '按天趋势只统计正式作答（2 题）');

console.log('\n=== 6. 做对后移出错题集合 ===');
// 新一轮答对 focus_convex
let qm3 = new QuizManager(mkCanvas());
qm3.isQuizMode = true;
qm3.startRound();
qm3.currentQuestion = focusQ;
qm3.submitAnswer();
qm3.stopQuizMode();
const redoIds2 = RP.getRedoQuestionIds.call(fakeReport, sandbox.Storage.getQuizHistory());
assert(!redoIds2.includes('focus_convex'), '最新一次答对后不再需要重做');

console.log('\n=== 7. 只跳过过的题也要重做 ===');
let qm4 = new QuizManager(mkCanvas());
qm4.isQuizMode = true;
qm4.startRound();
qm4.currentQuestion = sandbox.CONFIG.QUIZ_QUESTIONS.find(q => q.id === 'magnifier');
qm4.skipQuestion();
qm4.stopQuizMode();
const redoIds3 = RP.getRedoQuestionIds.call(fakeReport, sandbox.Storage.getQuizHistory());
assert(redoIds3.includes('magnifier'), '只跳过未作答的题进入错题重做集合');

console.log('\n=== 8. 错题重做模式：题池用尽派发 quizPoolEmpty ===');
let poolEvents = 0;
listeners['quizPoolEmpty'] = [() => poolEvents++];
let qm5 = new QuizManager(mkCanvas());
const started = qm5.startRedoMode(['magnifier']);
assert(started === true && qm5.roundMode === 'redo', '错题重做模式启动');
// 答对这道题后，再取下一题应为空
assert(qm5.currentQuestion.id === 'magnifier', '重做第一题来自错题池');
qm5.submitAnswer();
const next = qm5.nextQuestion();
assert(next === null && qm5.currentQuestion === null, '错题池用尽返回 null');
assert(poolEvents === 1, '派发 quizPoolEmpty 事件');
qm5.stopQuizMode();

console.log('\n=== 9. 重做轮次带 redo 标记 ===');
const rounds = sandbox.Storage.getQuizRounds();
assert(rounds[rounds.length - 1].mode === 'redo', '最后一轮标记为 redo');
const lastRecord = sandbox.Storage.getQuizHistory().slice(-1)[0];
assert(lastRecord.roundMode === 'redo', '重做产生的记录带 roundMode=redo');

console.log('\n=== 10. 清空历史 ===');
sandbox.Storage.clearQuizHistory();
assert(sandbox.Storage.getQuizHistory().length === 0, '答题历史已清空');
assert(sandbox.Storage.getQuizRounds().length === 0, '轮次记录已清空');

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
