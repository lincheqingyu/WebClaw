/**
 * 会话相关类型定义
 */
/** 创建 SessionId */
export function createSessionId(id) {
    return (id ?? generateId());
}
/** 生成随机 ID */
function generateId() {
    return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
//# sourceMappingURL=session.js.map