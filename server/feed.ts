/**
 * Phase 4 — the feed.
 *
 * Pure selection logic: given the item pool, what the learner has answered
 * before, and what they have just been shown, choose the next item. No
 * database and no clock of its own, so the whole thing is testable with
 * plain data and a seeded RNG.
 *
 * Two forces decide the pick:
 *
 *   topic weight — recent per-topic accuracy. Weak topics come up several
 *                  times more often than mastered ones, and a topic with
 *                  too little history to judge gets an exploration boost.
 *
 *   dueness      — per-item spaced repetition. Each consecutive correct
 *                  answer pushes an item further out; a wrong answer drops
 *                  it back to the shortest interval, so misses resurface
 *                  within the same sitting.
 *
 * The two multiply, and the result is a weighted random draw rather than an
 * argmax: the highest-scoring item should be the most likely next item, not
 * the certain one, or the feed marches through the pool in lockstep.
 */

import type { FeedItem, Topic } from '../shared/types.ts'

export interface HistoryEntry {
  attempts: number
  lastCorrect: boolean
  streak: number
  /** Epoch milliseconds. */
  lastAnsweredAt: number
}

export interface TopicPerformance {
  answered: number
  correct: number
}

export interface SelectionState {
  histories: Map<string, HistoryEntry>
  topicPerformance: Map<Topic, TopicPerformance>
  /** Item ids most recently served, newest first. */
  recentItemIds: string[]
  /** Epoch milliseconds. */
  now: number
}

export interface SelectionOptions {
  /** How many recently served items are excluded from the next draw. */
  cooldown: number
  /** Answers in a topic before its real accuracy is trusted. */
  minTopicSample: number
  /** Scenarios are slower to work through, so they are damped down. */
  scenarioWeight: number
  rng: () => number
}

export const DEFAULT_OPTIONS: SelectionOptions = {
  cooldown: 12,
  minTopicSample: 4,
  scenarioWeight: 0.45,
  rng: Math.random,
}

/**
 * Spaced repetition ladder, in milliseconds, indexed by the number of
 * consecutive correct answers. A missed item sits at index 0 and comes back
 * inside 90 seconds; a mastered one falls to roughly once every three weeks.
 */
export const INTERVALS_MS = [
  90_000, //  0 — just missed
  600_000, //  1 — ten minutes
  3_600_000, //  2 — an hour
  86_400_000, //  3 — a day
  259_200_000, //  4 — three days
  604_800_000, //  5 — a week
  1_814_400_000, //  6+ — three weeks
] as const

export function intervalFor(streak: number): number {
  const i = Math.min(Math.max(streak, 0), INTERVALS_MS.length - 1)
  return INTERVALS_MS[i]!
}

/**
 * How overdue an item is, as a multiple of its own interval. 1.0 means due
 * now. Unseen items sit just above 1 so new material mixes in readily while
 * still yielding to something badly overdue.
 */
export const UNSEEN_DUENESS = 1.2
const DUENESS_CAP = 4
const NOT_DUE_FLOOR = 0.15

export function duenessFor(history: HistoryEntry | undefined, now: number): number {
  if (!history) return UNSEEN_DUENESS
  const elapsed = Math.max(0, now - history.lastAnsweredAt)
  const ratio = elapsed / intervalFor(history.streak)
  // An item that is not yet due keeps a small floor rather than dropping to
  // zero: the feed is endless and must always be able to serve something.
  return Math.min(Math.max(ratio, NOT_DUE_FLOOR), DUENESS_CAP)
}

/**
 * Topic weight from recent accuracy. Perfect recall bottoms out at 0.5 and a
 * topic being got wrong every time tops out at 2.5, so the weakest topic is
 * drawn about five times as often as a mastered one.
 */
export function topicWeight(
  performance: TopicPerformance | undefined,
  minSample: number,
): number {
  if (!performance || performance.answered < minSample) return 1.5
  const accuracy = performance.correct / performance.answered
  return 0.5 + 2 * (1 - accuracy)
}

export interface ScoredItem {
  item: FeedItem
  score: number
  topicWeight: number
  dueness: number
}

export function scoreItems(
  pool: readonly FeedItem[],
  state: SelectionState,
  options: SelectionOptions = DEFAULT_OPTIONS,
): ScoredItem[] {
  return pool.map((item) => {
    const tw = topicWeight(state.topicPerformance.get(item.topic), options.minTopicSample)
    const dueness = duenessFor(state.histories.get(item.id), state.now)
    const kindWeight = item.kind === 'scenario' ? options.scenarioWeight : 1
    return { item, score: tw * dueness * kindWeight, topicWeight: tw, dueness }
  })
}

/** Weighted draw without replacement. Returns null for an empty list. */
function weightedPick<T extends { score: number }>(scored: T[], rng: () => number): T | null {
  const total = scored.reduce((sum, s) => sum + s.score, 0)
  if (scored.length === 0) return null
  if (total <= 0) return scored[Math.floor(rng() * scored.length)] ?? null
  let target = rng() * total
  for (const entry of scored) {
    target -= entry.score
    if (target <= 0) return entry
  }
  return scored[scored.length - 1] ?? null
}

/**
 * Choose the next item to serve.
 *
 * Recently served items are held back, but never so many that the pool is
 * emptied — with a small pool the cooldown shrinks rather than failing.
 */
export function selectNextItem(
  pool: readonly FeedItem[],
  state: SelectionState,
  options: SelectionOptions = DEFAULT_OPTIONS,
): FeedItem | null {
  if (pool.length === 0) return null

  const cooldown = Math.min(options.cooldown, Math.max(0, pool.length - 1))
  const blocked = new Set(state.recentItemIds.slice(0, cooldown))

  // Two scenarios back to back make for a slow, samey stretch of feed.
  const lastId = state.recentItemIds[0]
  const lastWasScenario = pool.find((i) => i.id === lastId)?.kind === 'scenario'

  let candidates = pool.filter((item) => !blocked.has(item.id))
  if (candidates.length === 0) candidates = [...pool]

  if (lastWasScenario) {
    const questionsOnly = candidates.filter((i) => i.kind === 'question')
    if (questionsOnly.length > 0) candidates = questionsOnly
  }

  const scored = scoreItems(candidates, state, options)
  return weightedPick(scored, options.rng)?.item ?? null
}
