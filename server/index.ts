/**
 * Minimal Node server: JSON API, plus static files for a built SPA and the
 * handbook assets. No framework — the surface is a handful of routes.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { openDb, repoRoot, startSession, endSession, recordAnswer, itemHistories, recentTopicPerformance, DB_PATH } from './db.ts'
import { loadContent } from './content.ts'
import { selectNextItem, type HistoryEntry, type SelectionState } from './feed.ts'
import { parentSummary } from './stats.ts'
import { isTopic, type Topic } from '../shared/types.ts'

const PORT = Number(process.env.PORT ?? 8787)

const db = openDb()
let content = loadContent()

if (content.problems.length > 0) {
  console.warn(`[content] ${content.problems.length} problem(s) — run 'just verify-content' for detail`)
}
console.log(
  `[content] ${content.questions.length} questions, ${content.scenarios.length} scenarios, ${content.unverified} awaiting human review`,
)

/**
 * Items served recently, newest first. Kept in memory rather than in the
 * database: it exists only to stop the same question reappearing minutes
 * apart, and it should reset when the server does.
 */
const recentItemIds: string[] = []
const RECENT_MAX = 40

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.ico': 'image/x-icon',
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > 1_000_000) throw new Error('request body too large')
    chunks.push(chunk as Buffer)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** Serve a file from one of the allowed roots, refusing anything that escapes. */
function serveStatic(res: ServerResponse, root: string, relPath: string): boolean {
  const safe = normalize(relPath).replace(/^(\.\.[/\\])+/, '')
  const full = join(root, safe)
  if (!full.startsWith(root)) return false
  if (!existsSync(full) || !statSync(full).isFile()) return false
  res.writeHead(200, { 'content-type': MIME[extname(full).toLowerCase()] ?? 'application/octet-stream' })
  createReadStream(full).pipe(res)
  return true
}

function historiesForSelection(): Map<string, HistoryEntry> {
  const out = new Map<string, HistoryEntry>()
  for (const [id, h] of itemHistories(db)) {
    out.set(id, {
      attempts: h.attempts,
      lastCorrect: h.lastCorrect,
      streak: h.streak,
      lastAnsweredAt: Date.parse(h.lastAnsweredAt),
    })
  }
  return out
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  const path = url.pathname
  const method = req.method ?? 'GET'

  try {
    if (path === '/api/health') {
      return sendJson(res, 200, { ok: true, db: DB_PATH, pool: content.pool.length })
    }

    if (path === '/api/session/start' && method === 'POST') {
      return sendJson(res, 200, startSession(db))
    }

    if (path === '/api/session/end' && method === 'POST') {
      const body = (await readBody(req)) as { sessionId?: number }
      if (typeof body.sessionId !== 'number') return sendJson(res, 400, { error: 'sessionId required' })
      endSession(db, body.sessionId)
      return sendJson(res, 200, { ok: true })
    }

    if (path === '/api/feed/next' && method === 'GET') {
      if (content.pool.length === 0) {
        return sendJson(res, 503, {
          error: 'no content loaded',
          hint: "run 'just content' to build content/questions.json and content/scenarios.json",
        })
      }
      const state: SelectionState = {
        histories: historiesForSelection(),
        topicPerformance: recentTopicPerformance(db),
        recentItemIds,
        now: Date.now(),
      }
      const item = selectNextItem(content.pool, state)
      if (!item) return sendJson(res, 503, { error: 'no item available' })
      recentItemIds.unshift(item.id)
      recentItemIds.length = Math.min(recentItemIds.length, RECENT_MAX)
      return sendJson(res, 200, item)
    }

    if (path === '/api/answer' && method === 'POST') {
      const body = (await readBody(req)) as Record<string, unknown>
      const sessionId = body.sessionId
      const itemId = body.itemId
      const topic = body.topic
      if (typeof sessionId !== 'number' || typeof itemId !== 'string' || !isTopic(topic)) {
        return sendJson(res, 400, { error: 'sessionId, itemId and a known topic are required' })
      }
      recordAnswer(db, {
        sessionId,
        itemId,
        topic: topic as Topic,
        correct: body.correct === true,
        responseTimeMs: Number(body.responseTimeMs) || 0,
      })
      return sendJson(res, 200, { ok: true })
    }

    if (path === '/api/summary' && method === 'GET') {
      return sendJson(
        res,
        200,
        parentSummary(db, {
          questions: content.questions.length,
          scenarios: content.scenarios.length,
          unverified: content.unverified,
        }),
      )
    }

    if (path === '/api/content/reload' && method === 'POST') {
      content = loadContent()
      return sendJson(res, 200, {
        questions: content.questions.length,
        scenarios: content.scenarios.length,
        problems: content.problems,
      })
    }

    if (path.startsWith('/content/') && serveStatic(res, join(repoRoot, 'content'), path.slice('/content/'.length))) return
    if (path.startsWith('/assets/') && serveStatic(res, join(repoRoot, 'assets'), path.slice('/assets/'.length))) return

    // A built SPA, when `just build` has run. In development Vite serves the
    // app and proxies these routes here instead.
    const dist = join(repoRoot, 'dist')
    if (existsSync(dist)) {
      if (serveStatic(res, dist, path === '/' ? 'index.html' : path.slice(1))) return
      if (!path.startsWith('/api/') && serveStatic(res, dist, 'index.html')) return
    }

    return sendJson(res, 404, { error: 'not found', path })
  } catch (err) {
    console.error('[server]', err)
    return sendJson(res, 500, { error: err instanceof Error ? err.message : 'internal error' })
  }
})

server.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT}  (db: ${DB_PATH})`)
})
