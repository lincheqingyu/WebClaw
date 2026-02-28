/**
 * API 地址配置
 * 通过环境变量覆盖，消除硬编码
 */

export const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:5000'
export const WS_BASE = import.meta.env.VITE_WS_BASE ?? 'ws://localhost:5000'
export const API_V1 = `${API_BASE}/api/v1`
