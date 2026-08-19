import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { openDb, startSession, recordAnswer, endSession, recentTopicPerformance, itemHistories } from '../server/db.ts'
import { parentSummary, startOfWeek } from '../server/stats.ts'
import { TOPICS } from '../shared/types.ts'

const CONTENT = { questions: 200, scenarios: 16, unverified: 216 }

function freshDb() {
  return openDb(':memory:')
}

describe('sessions and answers', () => {
  test('recording an answer increments the session item count', () => {
    const db = freshDb()
    const session = startSession(db)
    recordAnswer(db, { sessionId: session.id, itemId: 'q1', topic: 'give-way', correct: true, responseTimeMs: 1000 })
    recordAnswer(db, { sessionId: session.id, itemId: 'q2', topic: 'give-way', correct: false, responseTimeMs: 2000 })
    const summary = parentSummary(db, CONTENT)
    assert.equal(summary.recentSessions[0]?.itemCount, 2)
    assert.equal(summary.totalItemsAnswered, 2)
    assert.equal(summary.overallAccuracy, 0.5)
  })

  test('ending a session twice does not overwrite the first end time', () => {
    const db = freshDb()
    const session = startSession(db)
    const first = new Date('2026-01-01T10:00:00Z')
    const second = new Date('2026-01-01T11:00:00Z')
    endSession(db, session.id, first)
    endSession(db, session.id, second)
    const row = db.prepare('SELECT endedAt FROM sessions WHERE id = ?').get(session.id) as { endedAt: string }
    assert.equal(row.endedAt, first.toISOString())
  })

  test('a negative response time is stored as zero rather than skewing stats', () => {
    const db = freshDb()
    const session = startSession(db)
    recordAnswer(db, { sessionId: session.id, itemId: 'q1', topic: 'turns', correct: true, responseTimeMs: -50 })
    const row = db.prepare('SELECT responseTimeMs FROM answers').get() as { responseTimeMs: number }
    assert.equal(row.responseTimeMs, 0)
  })
})

describe('item histories', () => {
  test('tracks the streak of consecutive correct answers', () => {
    const db = freshDb()
    const session = startSession(db)
    const base = new Date('2026-01-01T10:00:00Z')
    const answers = [true, false, true, true]
    answers.forEach((correct, i) => {
      recordAnswer(
        db,
        { sessionId: session.id, itemId: 'q1', topic: 'give-way', correct, responseTimeMs: 1000 },
        new Date(base.getTime() + i * 60_000),
      )
    })
    const history = itemHistories(db).get('q1')
    assert.equal(history?.attempts, 4)
    assert.equal(history?.streak, 2, 'the streak resets on the wrong answer and counts the two since')
    assert.equal(history?.lastCorrect, true)
  })

  test('a wrong answer resets the streak to zero', () => {
    const db = freshDb()
    const session = startSession(db)
    const base = new Date('2026-01-01T10:00:00Z')
    ;[true, true, false].forEach((correct, i) => {
      recordAnswer(
        db,
        { sessionId: session.id, itemId: 'q1', topic: 'give-way', correct, responseTimeMs: 1000 },
        new Date(base.getTime() + i * 60_000),
      )
    })
    assert.equal(itemHistories(db).get('q1')?.streak, 0)
  })
})

describe('recent topic performance', () => {
  test('only the most recent answers in each topic count', () => {
    const db = freshDb()
    const session = startSession(db)
    const base = new Date('2026-01-01T10:00:00Z')
    // Ten wrong, then five right. A window of 5 should show perfect accuracy.
    for (let i = 0; i < 15; i++) {
      recordAnswer(
        db,
        { sessionId: session.id, itemId: `q${i}`, topic: 'roundabouts', correct: i >= 10, responseTimeMs: 1000 },
        new Date(base.getTime() + i * 60_000),
      )
    }
    const performance = recentTopicPerformance(db, 5)
    assert.deepEqual(performance.get('roundabouts'), { answered: 5, correct: 5 })
  })
})

describe('parent summary', () => {
  test('every topic appears even when never practised', () => {
    const summary = parentSummary(freshDb(), CONTENT)
    assert.equal(summary.byTopic.length, TOPICS.length)
    assert.ok(summary.byTopic.every((topic) => topic.answered === 0 && topic.accuracy === null))
  })

  test('an empty database reports nulls rather than zeroes or NaN', () => {
    const summary = parentSummary(freshDb(), CONTENT)
    assert.equal(summary.overallAccuracy, null)
    assert.equal(summary.totalItemsAnswered, 0)
    assert.equal(summary.weakestTopics.length, 0)
  })

  test('a topic needs several answers before it is called weak', () => {
    const db = freshDb()
    const session = startSession(db)
    // Four wrong answers is not enough evidence to flag a topic.
    for (let i = 0; i < 4; i++) {
      recordAnswer(db, { sessionId: session.id, itemId: `q${i}`, topic: 'turns', correct: false, responseTimeMs: 1000 })
    }
    assert.equal(parentSummary(db, CONTENT).weakestTopics.length, 0)

    recordAnswer(db, { sessionId: session.id, itemId: 'q4', topic: 'turns', correct: false, responseTimeMs: 1000 })
    const flagged = parentSummary(db, CONTENT).weakestTopics
    assert.equal(flagged.length, 1)
    assert.equal(flagged[0]?.topic, 'turns')
  })

  test('a strong topic is never flagged as weak', () => {
    const db = freshDb()
    const session = startSession(db)
    for (let i = 0; i < 10; i++) {
      recordAnswer(db, { sessionId: session.id, itemId: `q${i}`, topic: 'road-signs', correct: true, responseTimeMs: 1000 })
    }
    assert.equal(parentSummary(db, CONTENT).weakestTopics.length, 0)
  })

  test('the trend covers the requested number of days, including empty ones', () => {
    const summary = parentSummary(freshDb(), CONTENT, new Date('2026-03-15T12:00:00'), 14)
    assert.equal(summary.trend.length, 14)
    assert.ok(summary.trend.every((point) => point.answered === 0 && point.accuracy === null))
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
