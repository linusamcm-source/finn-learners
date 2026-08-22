/**
 * Everything computed from the answer history. These run in Node against
 * plain arrays — the point of keeping derive.ts pure is that none of this
 * needs a browser or an IndexedDB shim.
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  deriveHistories,
  recentTopicPerformance,
  sessionEnd,
  startOfWeek,
  summarise,
  type StoredAnswer,
  type StoredSession,
} from '../src/store/derive.ts'
import { TOPICS, type Topic } from '../shared/types.ts'

const CONTENT = { questions: 200, scenarios: 16, unverified: 216 }
const BASE = new Date('2026-01-01T10:00:00Z')

let seq = 0
function answer(partial: Partial<StoredAnswer> = {}): StoredAnswer {
  seq += 1
  return {
    id: `a${seq}`,
    sessionId: 1,
    itemId: 'q1',
    topic: 'give-way',
    correct: true,
    responseTimeMs: 1000,
    answeredAt: new Date(BASE.getTime() + seq * 60_000).toISOString(),
    ...partial,
  }
}

function session(partial: Partial<StoredSession> = {}): StoredSession {
  return { id: 1, startedAt: BASE.toISOString(), endedAt: null, itemCount: 0, ...partial }
}

describe('item histories', () => {
  test('counts attempts and the streak since the last wrong answer', () => {
    const answers = [true, false, true, true].map((correct, i) =>
      answer({ correct, answeredAt: new Date(BASE.getTime() + i * 60_000).toISOString() }),
    )
    const history = deriveHistories(answers).get('q1')
    assert.equal(history?.attempts, 4)
    assert.equal(history?.streak, 2, 'the streak resets on the wrong answer and counts the two since')
    assert.equal(history?.lastCorrect, true)
  })

  test('a wrong answer resets the streak to zero', () => {
    const answers = [true, true, false].map((correct, i) =>
      answer({ correct, answeredAt: new Date(BASE.getTime() + i * 60_000).toISOString() }),
    )
    assert.equal(deriveHistories(answers).get('q1')?.streak, 0)
  })

  test('order of the input does not matter — history is by timestamp', () => {
    const first = answer({ correct: false, answeredAt: '2026-01-01T10:00:00.000Z' })
    const second = answer({ correct: true, answeredAt: '2026-01-01T11:00:00.000Z' })
    const forwards = deriveHistories([first, second]).get('q1')
    const backwards = deriveHistories([second, first]).get('q1')
    assert.deepEqual(forwards, backwards)
    assert.equal(forwards?.lastCorrect, true)
  })

  test('separate items keep separate histories', () => {
    const histories = deriveHistories([answer({ itemId: 'q1' }), answer({ itemId: 'q2', correct: false })])
    assert.equal(histories.get('q1')?.streak, 1)
    assert.equal(histories.get('q2')?.streak, 0)
  })
})

describe('recent topic performance', () => {
  test('only the most recent answers in each topic count', () => {
    // Ten wrong, then five right. A window of 5 should show perfect accuracy.
    const answers = Array.from({ length: 15 }, (_, i) =>
      answer({
        topic: 'roundabouts',
        correct: i >= 10,
        answeredAt: new Date(BASE.getTime() + i * 60_000).toISOString(),
      }),
    )
    assert.deepEqual(recentTopicPerformance(answers, 5), new Map([['roundabouts', { answered: 5, correct: 5 }]]))
  })

  test('topics are tracked independently', () => {
    const performance = recentTopicPerformance([
      answer({ topic: 'give-way', correct: false }),
      answer({ topic: 'road-signs', correct: true }),
    ])
    assert.deepEqual(performance.get('give-way'), { answered: 1, correct: 0 })
    assert.deepEqual(performance.get('road-signs'), { answered: 1, correct: 1 })
  })

  test('an untouched topic is absent rather than zero', () => {
    assert.equal(recentTopicPerformance([answer()]).has('roundabouts' as Topic), false)
  })
})

describe('session end', () => {
  test('an explicitly closed session keeps its recorded end', () => {
    const closed = session({ endedAt: '2026-01-01T12:00:00.000Z' })
    assert.equal(sessionEnd(closed, []), '2026-01-01T12:00:00.000Z')
  })

  test('a session left open ends at its last answer', () => {
    // The app was swiped away rather than navigated out of.
    const answers = [
      answer({ answeredAt: '2026-01-01T10:05:00.000Z' }),
      answer({ answeredAt: '2026-01-01T10:20:00.000Z' }),
    ]
    assert.equal(sessionEnd(session(), answers), '2026-01-01T10:20:00.000Z')
  })

  test('an open session with no answers has no end', () => {
    assert.equal(sessionEnd(session(), []), null)
  })
})

describe('parent summary', () => {
  test('an empty store reports nulls rather than zeroes or NaN', () => {
    const summary = summarise([], [], CONTENT)
    assert.equal(summary.overallAccuracy, null)
    assert.equal(summary.totalItemsAnswered, 0)
    assert.equal(summary.weakestTopics.length, 0)
  })

  test('every topic appears even when never practised', () => {
    const summary = summarise([], [], CONTENT)
    assert.equal(summary.byTopic.length, TOPICS.length)
    assert.ok(summary.byTopic.every((topic) => topic.answered === 0 && topic.accuracy === null))
  })

  test('overall accuracy counts every answer', () => {
    const summary = summarise([session()], [answer({ correct: true }), answer({ correct: false })], CONTENT)
    assert.equal(summary.totalItemsAnswered, 2)
    assert.equal(summary.overallAccuracy, 0.5)
  })

  test('a topic needs several answers before it is called weak', () => {
    const four = Array.from({ length: 4 }, () => answer({ topic: 'turns', correct: false }))
    assert.equal(summarise([session()], four, CONTENT).weakestTopics.length, 0)

    const five = [...four, answer({ topic: 'turns', correct: false })]
    const flagged = summarise([session()], five, CONTENT).weakestTopics
    assert.equal(flagged.length, 1)
    assert.equal(flagged[0]?.topic, 'turns')
  })

  test('a strong topic is never flagged as weak', () => {
    const answers = Array.from({ length: 10 }, () => answer({ topic: 'road-signs', correct: true }))
    assert.equal(summarise([session()], answers, CONTENT).weakestTopics.length, 0)
  })

  test('the weakest topics come first', () => {
    const answers = [
      ...Array.from({ length: 10 }, (_, i) => answer({ topic: 'give-way', correct: i < 3 })),
      ...Array.from({ length: 10 }, (_, i) => answer({ topic: 'turns', correct: i < 7 })),
    ]
    const weak = summarise([session()], answers, CONTENT).weakestTopics
    assert.equal(weak[0]?.topic, 'give-way')
    assert.equal(weak[1]?.topic, 'turns')
  })

  test('the trend covers the requested days, including empty ones', () => {
    const summary = summarise([], [], CONTENT, new Date('2026-03-15T12:00:00'), 14)
    assert.equal(summary.trend.length, 14)
    assert.ok(summary.trend.every((point) => point.answered === 0 && point.accuracy === null))
  })

  test('recent sessions carry their own accuracy', () => {
    const answers = [
      answer({ sessionId: 1, correct: true }),
      answer({ sessionId: 1, correct: false }),
      answer({ sessionId: 2, correct: true }),
    ]
    const summary = summarise([session({ id: 1, itemCount: 2 }), session({ id: 2, itemCount: 1 })], answers, CONTENT)
    const first = summary.recentSessions.find((s) => s.id === 1)
    const second = summary.recentSessions.find((s) => s.id === 2)
    assert.equal(first?.accuracy, 0.5)
    assert.equal(second?.accuracy, 1)
  })

  test('the week starts on Monday', () => {
    // 2026-03-15 is a Sunday; its week began Monday the 9th.
    const monday = startOfWeek(new Date('2026-03-15T12:00:00'))
    assert.equal(monday.getDay(), 1)
    assert.equal(monday.getDate(), 9)
  })

  test('a Monday is its own start of week', () => {
    const monday = startOfWeek(new Date('2026-03-16T12:00:00'))
    assert.equal(monday.getDate(), 16)
    assert.equal(monday.getHours(), 0)
  })
})
