/**
 * 本地存储管理（简化版）
 */
const Storage = {
    GUIDE_KEY: 'optics_guide_completed',

    /**
     * 检查引导是否完成
     */
    isGuideCompleted() {
        try {
            return localStorage.getItem(this.GUIDE_KEY) === 'true';
        } catch (e) {
            return false;
        }
    },

    /**
     * 标记引导完成
     */
    setGuideCompleted() {
        try {
            localStorage.setItem(this.GUIDE_KEY, 'true');
        } catch (e) {
            // 忽略存储错误
        }
    },

    /**
     * 重置引导状态
     */
    resetGuide() {
        try {
            localStorage.removeItem(this.GUIDE_KEY);
        } catch (e) {
            // 忽略存储错误
        }
    }
};

/**
 * 测验成绩单存储
 *
 * 数据结构：
 * {
 *   sessions: [{ id, startTime, endTime, total, correct, skipped, wrong, score, source }],
 *   records:  [{ id, sessionId, questionId, title, knowledgePoint, description,
 *                status: 'correct'|'wrong'|'skipped', score, hintUsed, timestamp,
 *                params, details, explanation, solution }]
 * }
 */
const ReportStore = {
    REPORT_KEY: 'optics_quiz_report',
    MAX_RECORDS: 500,
    MAX_SESSIONS: 200,

    /**
     * 读取成绩单数据
     */
    load() {
        try {
            const raw = localStorage.getItem(this.REPORT_KEY);
            if (!raw) return { sessions: [], records: [] };
            const data = JSON.parse(raw);
            if (!Array.isArray(data.sessions) || !Array.isArray(data.records)) {
                return { sessions: [], records: [] };
            }
            return data;
        } catch (e) {
            return { sessions: [], records: [] };
        }
    },

    /**
     * 保存成绩单数据（同时裁剪超出上限的旧数据）
     */
    save(data) {
        try {
            const sessions = (data.sessions || []).slice(-this.MAX_SESSIONS);
            const sessionIds = new Set(sessions.map(s => s.id));
            let records = (data.records || []).filter(r => sessionIds.has(r.sessionId));
            records = records.slice(-this.MAX_RECORDS);
            localStorage.setItem(this.REPORT_KEY, JSON.stringify({ sessions, records }));
        } catch (e) {
            // 存储空间不足等情况下忽略错误
        }
    },

    /**
     * 开始一个新的测验轮次，返回轮次 id
     */
    startSession(source = 'normal') {
        const data = this.load();
        const session = {
            id: Utils.generateId(),
            source: source, // normal：正常一轮；redo：重做错题
            startTime: Date.now(),
            endTime: null,
            total: 0,
            correct: 0,
            wrong: 0,
            skipped: 0,
            score: 0
        };
        data.sessions.push(session);
        this.save(data);
        return session.id;
    },

    /**
     * 追加一条答题记录
     */
    addRecord(record) {
        const data = this.load();
        data.records.push(record);

        // 同步累计当前轮次的统计
        const session = data.sessions.find(s => s.id === record.sessionId);
        if (session) {
            session.total++;
            session.score += record.score || 0;
            if (record.status === 'correct') {
                session.correct++;
            } else if (record.status === 'skipped') {
                session.skipped++;
            } else {
                session.wrong++;
            }
        }
        this.save(data);
    },

    /**
     * 结束某一轮测验
     */
    endSession(sessionId) {
        const data = this.load();
        const session = data.sessions.find(s => s.id === sessionId);
        if (session && !session.endTime) {
            session.endTime = Date.now();
            this.save(data);
        }
    },

    /**
     * 清空所有成绩单数据
     */
    clear() {
        try {
            localStorage.removeItem(this.REPORT_KEY);
        } catch (e) {
            // 忽略存储错误
        }
    }
};
