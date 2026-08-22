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

/* ------------------------------------------------------------------ *
 * Mastery
 *
 * What the learner sees on their own progress screen, as opposed to the
 * parent's. The point is to give something finishable — nine topics to get on
 * top of — rather than an accuracy percentage that drifts around forever.
 * ------------------------------------------------------------------ */

export type MasteryLevel = 'untouched' | 'shaky' | 'getting-there' | 'mastered'

export interface TopicMastery {
  topic: Topic
  label: string
  level: MasteryLevel
  /** Words for the level, because colour must never carry it alone. */
  levelLabel: string
  /** Status class for the meter: good | warning | critical | neutral. */
  tone: 'good' | 'warning' | 'critical' | 'neutral'
  answered: number
  /** Recent accuracy, or null when there is not enough history to judge. */
  accuracy: number | null
  /** How far to fill the meter, 0..1. Blends coverage with accuracy. */
  fill: number
}

/** Answers in a topic before its accuracy is taken seriously. */
export const MASTERY_SAMPLE = 10
const MASTERY_ACCURACY = 0.85
const GETTING_THERE_ACCURACY = 0.7

/**
 * Mastery needs both evidence and accuracy. A topic answered three times at
 * 100% is not mastered, it is barely sampled — so coverage gates the level and
 * the meter shows the lower of the two.
 */
export function topicMastery(answers: readonly StoredAnswer[], window = 20): TopicMastery[] {
  const recent = recentTopicPerformance(answers, window)
  const totals = new Map<Topic, number>()
  for (const answer of answers) totals.set(answer.topic, (totals.get(answer.topic) ?? 0) + 1)

  return TOPICS.map((topic) => {
    const answered = totals.get(topic) ?? 0
    const perf = recent.get(topic)
    const accuracy = perf && perf.answered > 0 ? perf.correct / perf.answered : null
    const coverage = Math.min(1, answered / MASTERY_SAMPLE)

    let level: MasteryLevel = 'untouched'
    if (answered === 0) level = 'untouched'
    else if (answered < MASTERY_SAMPLE) level = 'shaky'
    else if ((accuracy ?? 0) >= MASTERY_ACCURACY) level = 'mastered'
    else if ((accuracy ?? 0) >= GETTING_THERE_ACCURACY) level = 'getting-there'
    else level = 'shaky'

    const rated = answered >= MASTERY_SAMPLE
    const labels: Record<MasteryLevel, string> = {
      untouched: 'Not started',
      shaky: rated ? 'Needs work' : `${answered}/${MASTERY_SAMPLE} to rate`,
      'getting-there': 'Getting there',
      mastered: 'Mastered',
    }
    // Not having answered enough of a topic yet is information, not failure.
    // Marking it critical paints a beginner's whole screen red, which is a
    // discouraging way to describe having barely started.
    const tones: Record<MasteryLevel, TopicMastery['tone']> = {
      untouched: 'neutral',
      shaky: rated ? 'critical' : 'neutral',
      'getting-there': 'warning',
      mastered: 'good',
    }

    return {
      topic,
      label: TOPIC_LABELS[topic],
      level,
      levelLabel: labels[level],
      tone: tones[level],
      answered,
      accuracy,
      fill: Math.min(coverage, accuracy ?? coverage),
    }
  })
}

export interface Readiness {
  /** 0..100, for display. */
  percent: number
  mastered: number
  total: number
  /** A plain-language line about what to do next. */
  advice: string
  /** The topic most worth practising next, if there is an obvious one. */
  focus: TopicMastery | null
}

/**
 * A single number for "how ready am I".
 *
 * Deliberately framed as practice readiness, not a prediction about the real
 * test — this app has no idea what is on that, and telling a learner they will
 * pass would be both unfounded and unkind if they then did not.
 */
export function readiness(mastery: readonly TopicMastery[]): Readiness {
  const total = mastery.length
  const mastered = mastery.filter((m) => m.level === 'mastered').length
  const percent = Math.round((mastery.reduce((sum, m) => sum + m.fill, 0) / total) * 100)

  const untouched = mastery.filter((m) => m.level === 'untouched')
  // Only a topic with enough answers behind it can be called the weakest.
  // Naming one off two answers tells the learner something the data does not
  // actually support.
  const rated = mastery.filter((m) => m.answered >= MASTERY_SAMPLE)
  const weakest = rated
    .filter((m) => m.level !== 'mastered')
    .sort((a, b) => (a.accuracy ?? 1) - (b.accuracy ?? 1))[0]

  const focus = untouched[0] ?? weakest ?? null

  let advice: string
  if (mastered === total) advice = 'Every topic mastered. Keep practising to hold it there.'
  else if (untouched.length > 0) advice = `Start on ${untouched[0]!.label.toLowerCase()} — you have not seen it yet.`
  else if (weakest) advice = `${weakest.label} is the weakest right now.`
  else if (rated.length === 0) {
    advice = `Keep going — no topic has ${MASTERY_SAMPLE} answers behind it yet.`
  } else advice = 'Keep going.'

  return { percent, mastered, total, advice, focus }
}
