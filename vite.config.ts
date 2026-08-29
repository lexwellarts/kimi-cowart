import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Kimi Cowart 数据目录（dataDir）：
 * 优先环境变量 KIMI_COWART_DATA_DIR，否则默认 <process.cwd()>/canvas
 * 结构：kimi-cowart.json / assets/ / requests/ / annotations/
 */
function resolveDataDir(): string {
  const env = process.env.KIMI_COWART_DATA_DIR
  const dir = env ? path.resolve(env) : path.join(process.cwd(), 'canvas')
  for (const sub of ['', 'assets', 'requests', 'annotations']) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true })
  }
  return dir
}

/** 只允许访问 dataDir 内部路径，防止目录穿越 */
function safeJoin(root: string, rel: string): string | null {
  const p = path.resolve(root, rel)
  if (p !== root && !p.startsWith(root + path.sep)) return null
  return p
}

function sanitizeName(name: string): string {
  const base = path.basename(name).replace(/[^\w.一-龥-]+/g, '_')
  return base || 'file'
}

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
}

function readBody(req: IncomingMessage, limit = 200 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

/** 先写临时文件再 rename，避免写一半被读到 */
function writeJsonAtomic(file: string, data: unknown): void {
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, file)
}

function genReqId(): string {
  return `req-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`
}

function serveFile(res: ServerResponse, file: string | null): void {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return sendJson(res, 404, { ok: false, error: '文件不存在' })
  }
  res.statusCode = 200
  res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream')
  fs.createReadStream(file).pipe(res)
}

/** 极简 JSON API，全部以 Vite 中间件实现，不引入额外服务框架 */
function canvasApiPlugin(): Plugin {
  return {
    name: 'kimi-cowart-api',
    configureServer(server) {
      const dataDir = resolveDataDir()
      const canvasFile = path.join(dataDir, 'kimi-cowart.json')
      console.log(`[kimi-cowart] 数据目录: ${dataDir}`)

      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        try {
          if (!req.url || !req.url.startsWith('/api/')) return next()
          const url = new URL(req.url, 'http://localhost')
          const pathname = decodeURIComponent(url.pathname)
          const method = req.method ?? 'GET'

          // GET /api/canvas —— 读取画布快照（含服务端更新时间）
          if (pathname === '/api/canvas' && method === 'GET') {
            if (!fs.existsSync(canvasFile)) {
              return sendJson(res, 200, { snapshot: null, updatedAt: null })
            }
            const stat = fs.statSync(canvasFile)
            const snapshot = JSON.parse(fs.readFileSync(canvasFile, 'utf-8'))
            return sendJson(res, 200, { snapshot, updatedAt: Math.round(stat.mtimeMs) })
          }

          // PUT /api/canvas —— 保存画布快照（自动备份上一份为 .bak）
          if (pathname === '/api/canvas' && method === 'PUT') {
            const body = await readBody(req)
            const snapshot = JSON.parse(body.toString('utf-8'))
            if (!snapshot || typeof snapshot !== 'object' || typeof snapshot.store !== 'object') {
              return sendJson(res, 400, { ok: false, error: '非法快照：缺少 store 字段' })
            }
            if (fs.existsSync(canvasFile)) fs.copyFileSync(canvasFile, `${canvasFile}.bak`)
            writeJsonAtomic(canvasFile, snapshot)
            const stat = fs.statSync(canvasFile)
            return sendJson(res, 200, { ok: true, updatedAt: Math.round(stat.mtimeMs) })
          }

          // POST /api/assets?name=xx.png —— 上传图片到 assets/
          if (pathname === '/api/assets' && method === 'POST') {
            const name = sanitizeName(url.searchParams.get('name') || 'image.png')
            const fname = `u${Date.now().toString(36)}-${name}`
            const buf = await readBody(req)
            fs.writeFileSync(path.join(dataDir, 'assets', fname), buf)
            return sendJson(res, 200, {
              ok: true,
              path: `assets/${fname}`,
              url: `/api/assets/${encodeURIComponent(fname)}`,
            })
          }

          // GET /api/assets/<file> —— 读取 assets 图片
          if (pathname.startsWith('/api/assets/') && method === 'GET') {
            return serveFile(
              res,
              safeJoin(path.join(dataDir, 'assets'), pathname.slice('/api/assets/'.length))
            )
          }

          // POST /api/annotations?name=xx.png —— 保存标注导出 PNG
          if (pathname === '/api/annotations' && method === 'POST') {
            const name = sanitizeName(
              url.searchParams.get('name') || `anno-${Date.now().toString(36)}.png`
            )
            const buf = await readBody(req)
            fs.writeFileSync(path.join(dataDir, 'annotations', name), buf)
            return sendJson(res, 200, {
              ok: true,
              path: `annotations/${name}`,
              url: `/api/annotations/${encodeURIComponent(name)}`,
            })
          }

          // GET /api/annotations/<file> —— 读取标注图
          if (pathname.startsWith('/api/annotations/') && method === 'GET') {
            return serveFile(
              res,
              safeJoin(path.join(dataDir, 'annotations'), pathname.slice('/api/annotations/'.length))
            )
          }

          // POST /api/ai-request —— 写入 AI 请求文件 requests/<id>.json
          if (pathname === '/api/ai-request' && method === 'POST') {
            const body = JSON.parse((await readBody(req)).toString('utf-8'))
            if (!body || (body.type !== 'image-gen' && body.type !== 'image-edit')) {
              return sendJson(res, 400, { ok: false, error: 'type 必须是 image-gen 或 image-edit' })
            }
            const id = sanitizeName(String(body.id || genReqId()))
            const request = {
              id,
              type: body.type,
              prompt: String(body.prompt ?? ''),
              references: Array.isArray(body.references) ? body.references.map(String) : [],
              frame: body.frame ?? null,
              annotationPng: body.annotationPng ?? null,
              bounds: body.bounds ?? null,
              status: 'pending',
              createdAt: new Date().toISOString(),
            }
            writeJsonAtomic(path.join(dataDir, 'requests', `${id}.json`), request)
            return sendJson(res, 200, { ok: true, id, path: `requests/${id}.json` })
          }

          // GET /api/requests —— 列出全部请求（客户端轮询 pending 数量用）
          if (pathname === '/api/requests' && method === 'GET') {
            const dir = path.join(dataDir, 'requests')
            const requests = fs
              .readdirSync(dir)
              .filter(f => f.endsWith('.json'))
              .map(f => {
                try {
                  return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'))
                } catch {
                  return null
                }
              })
              .filter(Boolean)
            return sendJson(res, 200, { requests })
          }

          return sendJson(res, 404, { ok: false, error: `未知 API: ${method} ${pathname}` })
        } catch (err) {
          return sendJson(res, 500, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), canvasApiPlugin()],
})
