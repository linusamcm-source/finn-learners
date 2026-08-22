/**
 * IndexedDB storage for sessions and answers.
 *
 * This is the whole of the app's persistence: there is no server. The
 * consequence worth knowing is that iOS evicts data belonging to web apps
 * that go unused for a stretch, which is why requestPersistentStorage() below
 * exists and why the parent view offers an export.
 *
 * The layer is deliberately thin. It reads and writes rows; everything
 * computed from them lives in derive.ts as pure functions.
 */
import type { Topic } from '../../shared/types.ts'
import type { StoredAnswer, StoredSession } from './derive.ts'

const DB_NAME = 'learner-dash'
const DB_VERSION = 1
const SESSIONS = 'sessions'
const ANSWERS = 'answers'

let handle: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  handle ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SESSIONS)) {
        db.createObjectStore(SESSIONS, { keyPath: 'id', autoIncrement: true })
      }
      if (!db.objectStoreNames.contains(ANSWERS)) {
        const store = db.createObjectStore(ANSWERS, { keyPath: 'id' })
        store.createIndex('sessionId', 'sessionId')
        store.createIndex('answeredAt', 'answeredAt')
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('could not open IndexedDB'))
  })
  return handle
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function transaction(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
): [IDBTransaction, Promise<void>] {
  const tx = db.transaction(stores, mode)
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
  return [tx, done]
}

/**
 * Ask the browser not to evict this data.
 *
 * Safari grants this to installed home-screen web apps far more readily than
 * to a tab, which is the single best thing that can be done about iOS's
 * eviction of unused web app data. It is a request, not a guarantee — hence
 * the export in the parent view.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  try {
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    return { usage, quota }
  } catch {
    return null
  }
}

export async function isPersisted(): Promise<boolean> {
  if (!navigator.storage?.persisted) return false
  try {
    return await navigator.storage.persisted()
  } catch {
    return false
  }
}

export async function startSession(now = new Date()): Promise<StoredSession> {
  const db = await open()
  const [tx, done] = transaction(db, [SESSIONS], 'readwrite')
  const record = { startedAt: now.toISOString(), endedAt: null, itemCount: 0 }
  const id = await promisify(tx.objectStore(SESSIONS).add(record) as IDBRequest<IDBValidKey>)
  await done
  return { id: Number(id), ...record }
}

export async function endSession(sessionId: number, now = new Date()): Promise<void> {
  const db = await open()
  const [tx, done] = transaction(db, [SESSIONS], 'readwrite')
  const store = tx.objectStore(SESSIONS)
  const session = await promisify(store.get(sessionId) as IDBRequest<StoredSession | undefined>)
  // Only the first close counts, so a pagehide after an explicit end does not
  // stretch the session's recorded length.
  if (session && !session.endedAt) store.put({ ...session, endedAt: now.toISOString() })
  await done
}

export interface AnswerInput {
  sessionId: number
  itemId: string
  topic: Topic
  correct: boolean
  responseTimeMs: number
}

function newId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export async function recordAnswer(answer: AnswerInput, now = new Date()): Promise<StoredAnswer> {
  const db = await open()
  const [tx, done] = transaction(db, [ANSWERS, SESSIONS], 'readwrite')

  const record: StoredAnswer = {
    id: newId(),
    sessionId: answer.sessionId,
    itemId: answer.itemId,
    topic: answer.topic,
    correct: answer.correct,
    responseTimeMs: Math.max(0, Math.round(answer.responseTimeMs)),
    answeredAt: now.toISOString(),
  }
  tx.objectStore(ANSWERS).add(record)

  const sessions = tx.objectStore(SESSIONS)
  const session = await promisify(sessions.get(answer.sessionId) as IDBRequest<StoredSession | undefined>)
  if (session) sessions.put({ ...session, itemCount: session.itemCount + 1 })

  await done
  return record
}

export async function allAnswers(): Promise<StoredAnswer[]> {
  const db = await open()
  const [tx, done] = transaction(db, [ANSWERS], 'readonly')
  const rows = await promisify(tx.objectStore(ANSWERS).getAll() as IDBRequest<StoredAnswer[]>)
  await done
  return rows
}

export async function allSessions(): Promise<StoredSession[]> {
  const db = await open()
  const [tx, done] = transaction(db, [SESSIONS], 'readonly')
  const rows = await promisify(tx.objectStore(SESSIONS).getAll() as IDBRequest<StoredSession[]>)
  await done
  return rows
}

/* ------------------------------------------------------------------ *
 * Backup
 * ------------------------------------------------------------------ */

export interface ProgressExport {
  format: 'learner-dash-progress'
  version: 1
  exportedAt: string
  sessions: StoredSession[]
  answers: StoredAnswer[]
}

export async function exportProgress(): Promise<ProgressExport> {
  const [sessions, answers] = await Promise.all([allSessions(), allAnswers()])
  return {
    format: 'learner-dash-progress',
    version: 1,
    exportedAt: new Date().toISOString(),
    sessions,
    answers,
  }
}

export interface ImportResult {
  sessionsAdded: number
  answersAdded: number
  answersSkipped: number
}

/**
 * Merge an exported file back in.
 *
 * Answers carry a stable client-generated id, so importing the same file
 * twice adds nothing the second time. Sessions are re-keyed on the way in
 * because their ids autoincrement and would otherwise collide with sessions
 * recorded since the export.
 */
export async function importProgress(data: unknown): Promise<ImportResult> {
  const parsed = data as Partial<ProgressExport>
  if (parsed?.format !== 'learner-dash-progress' || !Array.isArray(parsed.answers)) {
    throw new Error('That file is not a learner-dash progress export.')
  }

  const db = await open()
  const [tx, done] = transaction(db, [SESSIONS, ANSWERS], 'readwrite')
  const sessions = tx.objectStore(SESSIONS)
  const answers = tx.objectStore(ANSWERS)

  const existing = new Set(
    (await promisify(answers.getAllKeys() as IDBRequest<IDBValidKey[]>)).map(String),
  )

  const sessionIdMap = new Map<number, number>()
  let sessionsAdded = 0
  for (const session of parsed.sessions ?? []) {
    const { id: oldId, ...rest } = session
    const newKey = await promisify(sessions.add(rest) as IDBRequest<IDBValidKey>)
    sessionIdMap.set(oldId, Number(newKey))
    sessionsAdded += 1
  }

  let answersAdded = 0
  let answersSkipped = 0
  for (const answer of parsed.answers) {
    if (existing.has(String(answer.id))) {
      answersSkipped += 1
      continue
    }
    answers.add({ ...answer, sessionId: sessionIdMap.get(answer.sessionId) ?? answer.sessionId })
    answersAdded += 1
  }

  await done
  return { sessionsAdded, answersAdded, answersSkipped }
}

/** Delete everything. The parent view confirms before calling this. */
export async function resetProgress(): Promise<void> {
  const db = await open()
  const [tx, done] = transaction(db, [SESSIONS, ANSWERS], 'readwrite')
  tx.objectStore(SESSIONS).clear()
  tx.objectStore(ANSWERS).clear()
  await done
}
