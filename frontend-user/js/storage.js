/**
 * 本地存储管理
 */
const Storage = {
    GUIDE_KEY: 'optics_guide_completed',
    QUIZ_HISTORY_KEY: 'optics_quiz_history',
    QUIZ_ROUNDS_KEY: 'optics_quiz_rounds',

    // 历史记录最多保留条数（超出时丢弃最旧的）
    MAX_QUIZ_RECORDS: 1000,
    MAX_QUIZ_ROUNDS: 100,

    /**
     * 读取并解析 localStorage 中的 JSON 数据
     * 解析失败或数据非法时返回 fallback
     */
    getJSON(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return fallback;
            const data = JSON.parse(raw);
            return data === null || data === undefined ? fallback : data;
        } catch (e) {
            return fallback;
        }
    },

    /**
     * 序列化并写入 localStorage
     */
    setJSON(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (e) {
            // 存储已满或被禁用时静默失败
            return false;
        }
    },

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
    },

    /**
     * 获取全部答题历史（按时间正序）
     */
    getQuizHistory() {
        const data = this.getJSON(this.QUIZ_HISTORY_KEY, []);
        return Array.isArray(data) ? data : [];
    },

    /**
     * 追加一条答题历史
     */
    addQuizRecord(record) {
        const history = this.getQuizHistory();
        history.push(record);
        if (history.length > this.MAX_QUIZ_RECORDS) {
            history.splice(0, history.length - this.MAX_QUIZ_RECORDS);
        }
        this.setJSON(this.QUIZ_HISTORY_KEY, history);
        return record;
    },

    /**
     * 获取全部测验轮次（按开始时间正序）
     */
    getQuizRounds() {
        const data = this.getJSON(this.QUIZ_ROUNDS_KEY, []);
        return Array.isArray(data) ? data : [];
    },

    /**
     * 追加一轮测验记录
     */
    addQuizRound(round) {
        const rounds = this.getQuizRounds();
        rounds.push(round);
        if (rounds.length > this.MAX_QUIZ_ROUNDS) {
            rounds.splice(0, rounds.length - this.MAX_QUIZ_ROUNDS);
        }
        this.setJSON(this.QUIZ_ROUNDS_KEY, rounds);
        return round;
    },

    /**
     * 更新一轮测验记录（用于结束时回填统计）
     */
    updateQuizRound(roundId, updates) {
        const rounds = this.getQuizRounds();
        const index = rounds.findIndex(r => r.id === roundId);
        if (index === -1) return null;
        rounds[index] = Object.assign({}, rounds[index], updates);
        this.setJSON(this.QUIZ_ROUNDS_KEY, rounds);
        return rounds[index];
    },

    /**
     * 清空全部测验历史（含轮次）
     */
    clearQuizHistory() {
        try {
            localStorage.removeItem(this.QUIZ_HISTORY_KEY);
            localStorage.removeItem(this.QUIZ_ROUNDS_KEY);
        } catch (e) {
            // 忽略存储错误
        }
    }
};
