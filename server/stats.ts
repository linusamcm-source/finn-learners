import type Database from 'better-sqlite3'
import {
  TOPICS,
  TOPIC_LABELS,
  type ParentSummary,
  type SessionRow,
  type Topic,
  type TopicStat,
  type TrendPoint,
} from '../shared/types.ts'

function accuracy(correct: number, answered: number): number | null {
  return answered === 0 ? null : correct / answered
}

/** Midnight local time on the Monday of the week containing `now`. */
export function startOfWeek(now: Date): Date {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  // getDay(): 0 = Sunday. Shift so Monday is the first day of the week.
  const daysSinceMonday = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - daysSinceMonday)
  return d
}

export function parentSummary(
  db: Database.Database,
  content: { questions: number; scenarios: number; unverified: number },
  now = new Date(),
  trendDays = 14,
): ParentSummary {
  const weekStart = startOfWeek(now).toISOString()

  const sessionsThisWeek = (
    db
      .prepare('SELECT COUNT(*) AS n FROM sessions WHERE startedAt >= ?')
      .get(weekStart) as { n: number }
  ).n

  const itemsThisWeek = (
    db
      .prepare('SELECT COUNT(*) AS n FROM answers WHERE answeredAt >= ?')
      .get(weekStart) as { n: number }
  ).n

  const totals = db
    .prepare('SELECT COUNT(*) AS answered, COALESCE(SUM(correct), 0) AS correct FROM answers')
    .get() as { answered: number; correct: number }

  const totalSessions = (
    db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }
  ).n

  const topicRows = db
    .prepare(
      `SELECT topic, COUNT(*) AS answered, COALESCE(SUM(correct), 0) AS correct
         FROM answers GROUP BY topic`,
    )
    .all() as Array<{ topic: string; answered: number; correct: number }>
  const topicMap = new Map(topicRows.map((r) => [r.topic as Topic, r]))

  // Every topic appears, including ones never seen, so the parent view shows
  // gaps in coverage rather than silently omitting them.
  const byTopic: TopicStat[] = TOPICS.map((topic) => {
    const row = topicMap.get(topic)
    const answered = row?.answered ?? 0
    const correct = row?.correct ?? 0
    return { topic, label: TOPIC_LABELS[topic], answered, correct, accuracy: accuracy(correct, answered) }
  })

  // "Weak" needs a few answers behind it, otherwise one unlucky question
  // brands a topic as a problem area.
  const weakestTopics = byTopic
    .filter((t) => t.answered >= 5 && t.accuracy !== null && t.accuracy < 0.8)
    .sort((a, b) => (a.accuracy ?? 1) - (b.accuracy ?? 1))
    .slice(0, 3)

  const trendStart = new Date(now)
  trendStart.setHours(0, 0, 0, 0)
  trendStart.setDate(trendStart.getDate() - (trendDays - 1))

  const dayRows = db
    .prepare(
      `SELECT DATE(answeredAt, 'localtime') AS date,
              COUNT(*) AS answered,
              COALESCE(SUM(correct), 0) AS correct
         FROM answers
        WHERE answeredAt >= ?
        GROUP BY date`,
    )
    .all(trendStart.toISOString()) as Array<{ date: string; answered: number; correct: number }>
  const dayMap = new Map(dayRows.map((r) => [r.date, r]))

  const trend: TrendPoint[] = []
  for (let i = 0; i < trendDays; i++) {
    const d = new Date(trendStart)
    d.setDate(trendStart.getDate() + i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const row = dayMap.get(key)
    const answered = row?.answered ?? 0
    const correct = row?.correct ?? 0
    trend.push({ date: key, answered, correct, accuracy: accuracy(correct, answered) })
  }

  const recentSessions = (
    db
      .prepare(
        `SELECT s.id, s.startedAt, s.endedAt, s.itemCount,
                COALESCE(SUM(a.correct), 0) AS correct,
                COUNT(a.id) AS answered
           FROM sessions s
           LEFT JOIN answers a ON a.sessionId = s.id
          GROUP BY s.id
          ORDER BY s.startedAt DESC
          LIMIT 10`,
      )
      .all() as Array<SessionRow & { correct: number; answered: number }>
  ).map((s) => ({
    id: s.id,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    itemCount: s.itemCount,
    accuracy: accuracy(s.correct, s.answered),
  }))

  return {
    sessionsThisWeek,
    itemsThisWeek,
    totalItemsAnswered: totals.answered,
    totalSessions,
    overallAccuracy: accuracy(totals.correct, totals.answered),
    byTopic,
    weakestTopics,
    trend,
    recentSessions,
    content,
  }
}
