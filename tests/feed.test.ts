import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_OPTIONS,
  INTERVALS_MS,
  UNSEEN_DUENESS,
  duenessFor,
  intervalFor,
  scoreItems,
  selectNextItem,
  topicWeight,
  type HistoryEntry,
  type SelectionState,
} from '../server/feed.ts'
import type { FeedItem, Question, Scenario, Topic } from '../shared/types.ts'

const NOW = 1_700_000_000_000

function question(id: string, topic: Topic): FeedItem {
  const q: Question = {
    id,
    topic,
    text: 'text',
    options: ['a', 'b'],
    correctIndex: 0,
    explanation: 'because',
    ruleRef: { chapter: 'Giving way', page: null },
    verified: false,
  }
  return { kind: 'question', id, topic, question: q }
}

function scenario(id: string, topic: Topic): FeedItem {
  const s = {
    id,
    topic,
    title: 'scenario',
    durationMs: 5000,
    layout: { roadType: 'four-way-intersection', lanes: { north: 1 }, controls: [] },
    actors: [],
    ego: { startPosition: { x: 0, y: 0 }, path: [{ x: 0, y: 1 }], speed: 10, driverControlled: false },
    assessment: {
      kind: 'hazard-perception',
      responseWindowMs: { startMs: 0, endMs: 1000 },
      hazardArea: { centre: { x: 0, y: 0 }, radius: 2 },
      explanation: 'because',
    },
    verified: false,
  } as Scenario
  return { kind: 'scenario', id, topic, scenario: s }
}

function state(partial: Partial<SelectionState> = {}): SelectionState {
  return {
    histories: new Map(),
    topicPerformance: new Map(),
    recentItemIds: [],
    now: NOW,
    ...partial,
  }
}

function history(partial: Partial<HistoryEntry> = {}): HistoryEntry {
  return { attempts: 1, lastCorrect: true, streak: 1, lastAnsweredAt: NOW, ...partial }
}

/** Deterministic RNG cycling through fixed values, for reproducible draws. */
function seededRng(values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length]!
}

describe('spaced repetition intervals', () => {
  test('a missed item comes back within the same sitting', () => {
    assert.equal(intervalFor(0), 90_000)
  })

  test('intervals grow with each consecutive correct answer', () => {
    for (let streak = 1; streak < INTERVALS_MS.length; streak++) {
      assert.ok(
        intervalFor(streak) > intervalFor(streak - 1),
        `interval ${streak} should exceed ${streak - 1}`,
      )
    }
  })

  test('streaks beyond the ladder clamp to the longest interval', () => {
    assert.equal(intervalFor(99), INTERVALS_MS[INTERVALS_MS.length - 1])
    assert.equal(intervalFor(-5), INTERVALS_MS[0])
  })
})

describe('dueness', () => {
  test('an unseen item is treated as slightly overdue', () => {
    assert.equal(duenessFor(undefined, NOW), UNSEEN_DUENESS)
  })

  test('an item answered just now is not due', () => {
    assert.ok(duenessFor(history({ lastAnsweredAt: NOW }), NOW) < 1)
  })

  test('a missed item becomes due far sooner than a mastered one', () => {
    const elapsed = 5 * 60_000 // five minutes
    const missed = duenessFor(history({ streak: 0, lastCorrect: false, lastAnsweredAt: NOW - elapsed }), NOW)
    const mastered = duenessFor(history({ streak: 5, lastAnsweredAt: NOW - elapsed }), NOW)
    assert.ok(missed > 1, 'missed item should be due')
    assert.ok(mastered < 1, 'mastered item should not be due yet')
    assert.ok(missed > mastered * 10)
  })

  test('dueness is capped so one ancient item cannot dominate forever', () => {
    const ancient = duenessFor(history({ streak: 0, lastAnsweredAt: 0 }), NOW)
    assert.ok(ancient <= 4)
  })

  test('an item never drops to zero weight, so the feed can always serve something', () => {
    assert.ok(duenessFor(history({ streak: 6, lastAnsweredAt: NOW }), NOW) > 0)
  })
})

describe('topic weighting', () => {
  test('topics with too little history get an exploration boost', () => {
    assert.equal(topicWeight({ answered: 1, correct: 1 }, 4), 1.5)
    assert.equal(topicWeight(undefined, 4), 1.5)
  })

  test('a weak topic outweighs a mastered one by about five to one', () => {
    const weak = topicWeight({ answered: 20, correct: 0 }, 4)
    const mastered = topicWeight({ answered: 20, correct: 20 }, 4)
    assert.equal(mastered, 0.5)
    assert.equal(weak, 2.5)
    assert.equal(weak / mastered, 5)
  })

  test('weight falls as accuracy rises', () => {
    const mid = topicWeight({ answered: 10, correct: 5 }, 4)
    const good = topicWeight({ answered: 10, correct: 9 }, 4)
    assert.ok(mid > good)
  })
})

describe('selectNextItem', () => {
  test('returns null for an empty pool', () => {
    assert.equal(selectNextItem([], state()), null)
  })

  test('always returns an item when the pool is not empty', () => {
    const pool = [question('q1', 'give-way')]
    assert.equal(selectNextItem(pool, state())?.id, 'q1')
  })

  test('recently served items are held back', () => {
    const pool = [question('q1', 'give-way'), question('q2', 'give-way'), question('q3', 'give-way')]
    const chosen = selectNextItem(pool, state({ recentItemIds: ['q1', 'q2'] }), {
      ...DEFAULT_OPTIONS,
      rng: seededRng([0.5]),
    })
    assert.equal(chosen?.id, 'q3')
  })

  test('the cooldown shrinks rather than emptying a small pool', () => {
    const pool = [question('q1', 'give-way'), question('q2', 'give-way')]
    // Every item is "recent", but the feed must still produce one.
    const chosen = selectNextItem(pool, state({ recentItemIds: ['q1', 'q2'] }), {
      ...DEFAULT_OPTIONS,
      rng: seededRng([0.1]),
    })
    assert.ok(chosen, 'expected an item despite the whole pool being recent')
  })

  test('two scenarios are never served back to back', () => {
    const pool = [scenario('s1', 'give-way'), scenario('s2', 'give-way'), question('q1', 'give-way')]
    for (const roll of [0, 0.25, 0.5, 0.75, 0.99]) {
      const chosen = selectNextItem(pool, state({ recentItemIds: ['s1'] }), {
        ...DEFAULT_OPTIONS,
        rng: seededRng([roll]),
      })
      assert.equal(chosen?.kind, 'question', `roll ${roll} should not follow a scenario with a scenario`)
    }
  })

  test('a weak topic is drawn far more often than a mastered one', () => {
    const pool = [question('weak', 'give-way'), question('strong', 'road-signs')]
    const topicPerformance = new Map([
      ['give-way' as Topic, { answered: 20, correct: 4 }],
      ['road-signs' as Topic, { answered: 20, correct: 20 }],
    ])

    let weakDraws = 0
    const runs = 2000
    for (let i = 0; i < runs; i++) {
      // Sweep the RNG across its whole range instead of relying on Math.random.
      const rng = seededRng([i / runs])
      const chosen = selectNextItem(pool, state({ topicPerformance }), { ...DEFAULT_OPTIONS, rng })
      if (chosen?.id === 'weak') weakDraws += 1
    }
    const share = weakDraws / runs
    assert.ok(share > 0.7, `expected the weak topic to dominate, got ${(share * 100).toFixed(0)}%`)
    assert.ok(share < 1, 'the mastered topic should still appear sometimes')
  })

  test('a missed item outranks an unseen one in the same topic', () => {
    const pool = [question('missed', 'give-way'), question('fresh', 'give-way')]
    const histories = new Map([
      ['missed', history({ streak: 0, lastCorrect: false, lastAnsweredAt: NOW - 10 * 60_000 })],
    ])
    const scored = scoreItems(pool, state({ histories }))
    const missed = scored.find((s) => s.item.id === 'missed')!
    const fresh = scored.find((s) => s.item.id === 'fresh')!
    assert.ok(missed.score > fresh.score, 'a recently missed item should be the more urgent')
  })

  test('scenarios are damped relative to questions of equal dueness', () => {
    const pool = [question('q', 'give-way'), scenario('s', 'give-way')]
    const scored = scoreItems(pool, state())
    const q = scored.find((s) => s.item.id === 'q')!
    const s = scored.find((s) => s.item.id === 's')!
    assert.ok(s.score < q.score)
    assert.equal(s.score / q.score, DEFAULT_OPTIONS.scenarioWeight)
  })
})
