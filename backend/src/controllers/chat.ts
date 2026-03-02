/**
 * 对话路由（已废弃）
 */

import { Router, type Router as RouterType } from 'express'

const router: RouterType = Router()

router.post('/chat', (_req, res) => {
  res.status(410).json({
    success: false,
    error: 'HTTP 对话接口已废弃，请使用 WebSocket /api/v1/chat/ws',
  })
})

export { router as chatRouter }
