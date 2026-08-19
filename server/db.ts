import Database from 'better-sqlite3'
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AnswerInput, SessionRow, Topic } from '../shared/types.ts'

const here = dirname(fileURLToPath(import.meta.url))
export const repoRoot = join(here, '..')

export const DB_PATH = process.env.LEARNER_DASH_DB ?? join(repoRoot, 'data', 'learner-dash.db')

export interface ItemHistory {
  itemId: string
  topic: Topic
  attempts: number
  /** 1 if the most recent attempt was correct. */
  lastCorrect: boolean
  /** Consecutive correct attempts, counting back from the most recent. */
  streak: number
  lastAnsweredAt: string
}

export function openDb(path: string = DB_PATH): Database.Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path)
  db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'))
  return db
}

export function startSession(db: Database.Database, now = new Date()): SessionRow {
  const info = db
    .prepare('INSERT INTO sessions (startedAt, itemCount) VALUES (?, 0)')
    .run(now.toISOString())
  return {
    id: Number(info.lastInsertRowid),
    startedAt: now.toISOString(),
    endedAt: null,
    itemCount: 0,
  }
}

export function endSession(db: Database.Database, sessionId: number, now = new Date()): void {
  db.prepare('UPDATE sessions SET endedAt = ? WHERE id = ? AND endedAt IS NULL').run(
    now.toISOString(),
    sessionId,
  )
}

export function recordAnswer(
  db: Database.Database,
  answer: AnswerInput,
  now = new Date(),
): void {
  const tx = db.transaction((a: AnswerInput) => {
    db.prepare(
      `INSERT INTO answers (sessionId, itemId, topic, correct, responseTimeMs, answeredAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(a.sessionId, a.itemId, a.topic, a.correct ? 1 : 0, Math.max(0, a.responseTimeMs), now.toISOString())
    db.prepare('UPDATE sessions SET itemCount = itemCount + 1 WHERE id = ?').run(a.sessionId)
  })
  tx(answer)
}

/**
 * Per-item history for the scheduler. One row per item the learner has seen,
 * carrying the streak of consecutive correct answers ending at the most
 * recent attempt.
 */
export function itemHistories(db: Database.Database): Map<string, ItemHistory> {
  const rows = db
    .prepare(
      `SELECT itemId, topic, correct, answeredAt
         FROM answers
        ORDER BY itemId, answeredAt ASC, id ASC`,
    )
    .all() as Array<{ itemId: string; topic: string; correct: number; answeredAt: string }>

  const out = new Map<string, ItemHistory>()
  for (const row of rows) {
    const prev = out.get(row.itemId)
    const correct = row.correct === 1
    out.set(row.itemId, {
      itemId: row.itemId,
      topic: row.topic as Topic,
      attempts: (prev?.attempts ?? 0) + 1,
      lastCorrect: correct,
      streak: correct ? (prev?.streak ?? 0) + 1 : 0,
      lastAnsweredAt: row.answeredAt,
    })
  }
  return out
}

/**
 * Recent per-topic performance, over the last `window` answers in each topic.
 * The feed weights topic selection off this rather than lifetime accuracy so
 * that improvement shows up quickly.
 */
export function recentTopicPerformance(
  db: Database.Database,
  window = 20,
): Map<Topic, { answered: number; correct: number }> {
  const rows = db
    .prepare(
      `SELECT topic, correct
         FROM (
           SELECT topic, correct,
                  ROW_NUMBER() OVER (PARTITION BY topic ORDER BY answeredAt DESC, id DESC) AS rn
             FROM answers
         )
        WHERE rn <= ?`,
    )
    .all(window) as Array<{ topic: string; correct: number }>

  const out = new Map<Topic, { answered: number; correct: number }>()
  for (const row of rows) {
    const topic = row.topic as Topic
    const acc = out.get(topic) ?? { answered: 0, correct: 0 }
    acc.answered += 1
    acc.correct += row.correct
    out.set(topic, acc)
  }
  return out
}
