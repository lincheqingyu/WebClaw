import { Router, type Router as RouterType } from 'express'
import { z } from 'zod'
import { createHttpError } from '../middlewares/error-handler.js'
import { getMemoryConfig, saveMemoryConfig } from '../core/memory/index.js'
import { listMemoryFiles, readMemoryFile } from '../memory/store.js'

const router: RouterType = Router()

const updateConfigSchema = z.object({
  flushTurns: z.number().int().min(1).optional(),
  embeddingBaseUrl: z.string().url().or(z.literal('')).optional(),
})

const readFileQuerySchema = z.object({
  name: z.string().min(1),
})

router.get('/memory/config', async (_req, res, next) => {
  try {
    const config = await getMemoryConfig()
    res.json({ success: true, data: config })
  } catch (error) {
    next(error)
  }
})

router.put('/memory/config', async (req, res, next) => {
  try {
    const parsed = updateConfigSchema.safeParse(req.body)
    if (!parsed.success) {
      throw createHttpError(400, parsed.error.issues.map((i) => i.message).join('; '))
    }
    const config = await saveMemoryConfig(parsed.data)
    res.json({ success: true, data: config })
  } catch (error) {
    next(error)
  }
})

router.get('/memory/files', async (_req, res, next) => {
  try {
    const files = await listMemoryFiles()
    res.json({ success: true, data: { files } })
  } catch (error) {
    next(error)
  }
})

router.get('/memory/file', async (req, res, next) => {
  try {
    const parsed = readFileQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      throw createHttpError(400, parsed.error.issues.map((i) => i.message).join('; '))
    }
    const content = await readMemoryFile(parsed.data.name)
    res.json({ success: true, data: { name: parsed.data.name, content } })
  } catch (error) {
    next(error)
  }
})

export { router as memoryRouter }
