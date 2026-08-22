/**
 * Everything computed from the answer history.
 *
 * Deliberately pure: these take plain arrays and return plain values, so the
 * scheduler and the parent view can be tested with fabricated data in Node,
 * where there is no IndexedDB. The storage layer in idb.ts does nothing but
 * read rows and hand them to these functions.
 *
 * Nothing derived here is ever persisted. Streaks, dueness and topic accuracy
 * are all functions of the answers table, so there is no cached copy that can
 * fall out of step with it.
 */
import {
  TOPICS,
  TOPIC_LABELS,
  type ParentSummary,
  type Topic,
  type TopicStat,
  type TrendPoint,
} from '../../shared/types.ts'
import type { HistoryEntry, TopicPerformance } from '../feed/select.ts'

export interface StoredSession {
  id: number
  startedAt: string
  endedAt: string | null
  itemCount: number
}

export interface StoredAnswer {
  /** Client-generated, so an exported file can be re-imported without duplicating. */
  id: string
  sessionId: number
  itemId: string
  topic: Topic
  correct: boolean
  responseTimeMs: number
  answeredAt: string
}

function accuracy(correct: number, answered: number): number | null {
  return answered === 0 ? null : correct / answered
}

function byTimeAscending(a: StoredAnswer, b: StoredAnswer): number {
  return a.answeredAt < b.answeredAt ? -1 : a.answeredAt > b.answeredAt ? 1 : a.id < b.id ? -1 : 1
}

/**
 * Per-item scheduling state: how many attempts, and the run of consecutive
 * correct answers ending at the most recent one.
 */
export function deriveHistories(answers: readonly StoredAnswer[]): Map<string, HistoryEntry> {
  const out = new Map<string, HistoryEntry>()
  for (const answer of [...answers].sort(byTimeAscending)) {
    const prev = out.get(answer.itemId)
    out.set(answer.itemId, {
      attempts: (prev?.attempts ?? 0) + 1,
      lastCorrect: answer.correct,
      streak: answer.correct ? (prev?.streak ?? 0) + 1 : 0,
      lastAnsweredAt: Date.parse(answer.answeredAt),
    })
  }
  return out
}

/**
 * Recent accuracy per topic, over the last `window` answers in each topic.
 * Recent rather than lifetime, so that improvement shows up quickly instead of
 * being averaged away by a bad first week.
 */
export function recentTopicPerformance(
  answers: readonly StoredAnswer[],
  window = 20,
): Map<Topic, TopicPerformance> {
  const byTopic = new Map<Topic, StoredAnswer[]>()
  for (const answer of answers) {
    const list = byTopic.get(answer.topic)
    if (list) list.push(answer)
    else byTopic.set(answer.topic, [answer])
  }

  const out = new Map<Topic, TopicPerformance>()
  for (const [topic, list] of byTopic) {
    const recent = list.sort(byTimeAscending).slice(-window)
    out.set(topic, {
      answered: recent.length,
      correct: recent.filter((a) => a.correct).length,
    })
  }
  return out
}

/** Midnight local time on the Monday of the week containing `now`. */
export function startOfWeek(now: Date): Date {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)) // getDay(): 0 = Sunday
  return d
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * A session's effective end. A session that was never closed — the app was
 * swiped away rather than navigated out of — is treated as ending at its last
 * answer, which is more truthful than leaving it open forever.
 */
export function sessionEnd(session: StoredSession, answers: readonly StoredAnswer[]): string | null {
  if (session.endedAt) return session.endedAt
  const mine = answers.filter((a) => a.sessionId === session.id)
  if (mine.length === 0) return null
  return mine.reduce((latest, a) => (a.answeredAt > latest ? a.answeredAt : latest), mine[0]!.answeredAt)
}

export function summarise(
  sessions: readonly StoredSession[],
  answers: readonly StoredAnswer[],
  content: { questions: number; scenarios: number; unverified: number },
  now = new Date(),
  trendDays = 14,
): ParentSummary {
  const weekStart = startOfWeek(now).toISOString()

  const sessionsThisWeek = sessions.filter((s) => s.startedAt >= weekStart).length
  const itemsThisWeek = answers.filter((a) => a.answeredAt >= weekStart).length
  const totalCorrect = answers.filter((a) => a.correct).length

  const perTopic = new Map<Topic, { answered: number; correct: number }>()
  for (const answer of answers) {
    const acc = perTopic.get(answer.topic) ?? { answered: 0, correct: 0 }
    acc.answered += 1
    if (answer.correct) acc.correct += 1
    perTopic.set(answer.topic, acc)
  }

  // Every topic appears, including ones never practised, so gaps in coverage
  // are visible rather than silently omitted.
  const byTopic: TopicStat[] = TOPICS.map((topic) => {
    const row = perTopic.get(topic)
    const answered = row?.answered ?? 0
    const correct = row?.correct ?? 0
    return { topic, label: TOPIC_LABELS[topic], answered, correct, accuracy: accuracy(correct, answered) }
  })

  // "Weak" needs a few answers behind it, or one unlucky question brands a
  // topic as a problem area.
  const weakestTopics = byTopic
    .filter((t) => t.answered >= 5 && t.accuracy !== null && t.accuracy < 0.8)
    .sort((a, b) => (a.accuracy ?? 1) - (b.accuracy ?? 1))
    .slice(0, 3)

  const trendStart = new Date(now)
  trendStart.setHours(0, 0, 0, 0)
  trendStart.setDate(trendStart.getDate() - (trendDays - 1))

  const perDay = new Map<string, { answered: number; correct: number }>()
  for (const answer of answers) {
    const at = new Date(answer.answeredAt)
    if (at < trendStart) continue
    const key = localDateKey(at)
    const acc = perDay.get(key) ?? { answered: 0, correct: 0 }
    acc.answered += 1
    if (answer.correct) acc.correct += 1
    perDay.set(key, acc)
  }

  const trend: TrendPoint[] = []
  for (let i = 0; i < trendDays; i++) {
    const day = new Date(trendStart)
    day.setDate(trendStart.getDate() + i)
    const key = localDateKey(day)
    const row = perDay.get(key)
    const answered = row?.answered ?? 0
    const correct = row?.correct ?? 0
    trend.push({ date: key, answered, correct, accuracy: accuracy(correct, answered) })
  }

  const recentSessions = [...sessions]
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
    .slice(0, 10)
    .map((session) => {
      const mine = answers.filter((a) => a.sessionId === session.id)
      return {
        id: session.id,
        startedAt: session.startedAt,
        endedAt: sessionEnd(session, answers),
        itemCount: session.itemCount,
        accuracy: accuracy(mine.filter((a) => a.correct).length, mine.length),
      }
    })

  return {
    sessionsThisWeek,
    itemsThisWeek,
    totalItemsAnswered: answers.length,
    totalSessions: sessions.length,
    overallAccuracy: accuracy(totalCorrect, answers.length),
    byTopic,
    weakestTopics,
    trend,
    recentSessions,
    content,
  }
}
