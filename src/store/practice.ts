/**
 * The practice session: what the feed view talks to instead of an API.
 *
 * Holds the loaded content pool and the open session, picks the next item,
 * and records answers. Everything is local, so there is no network failure
 * mode to design around — but IndexedDB can still refuse (a full disk, or
 * Safari's private browsing), and those errors surface rather than being
 * swallowed.
 */
import type { FeedItem } from '../../shared/types.ts'
import { loadContent } from '../content/load.ts'
import type { ContentPack } from '../content/validate.ts'
import { selectNextItem, type SelectionState } from '../feed/select.ts'
import { deriveHistories, recentTopicPerformance, type StoredAnswer } from './derive.ts'
import {
  allAnswers,
  endSession,
  recordAnswer,
  requestPersistentStorage,
  startSession,
  type AnswerInput,
} from './idb.ts'

/**
 * Recently served item ids, newest first. In memory only: it exists to stop
 * the same question reappearing minutes apart, and should reset when the app
 * is reopened.
 */
const RECENT_MAX = 40

export class PracticeSession {
  private content: ContentPack | null = null
  private answers: StoredAnswer[] = []
  private sessionId: number | null = null
  private readonly recentItemIds: string[] = []

  async start(): Promise<void> {
    // Asked for on first use rather than at load: Safari is more likely to
    // grant persistence to an app the user is actually using.
    void requestPersistentStorage()

    const [content, answers, session] = await Promise.all([
      loadContent(),
      allAnswers(),
      startSession(),
    ])
    this.content = content
    this.answers = answers
    this.sessionId = session.id
  }

  get pool(): readonly FeedItem[] {
    return this.content?.pool ?? []
  }

  get contentCounts(): { questions: number; scenarios: number; unverified: number } {
    return {
      questions: this.content?.questions.length ?? 0,
      scenarios: this.content?.scenarios.length ?? 0,
      unverified: this.content?.unverified ?? 0,
    }
  }

  nextItem(): FeedItem | null {
    if (!this.content || this.content.pool.length === 0) return null
    const state: SelectionState = {
      histories: deriveHistories(this.answers),
      topicPerformance: recentTopicPerformance(this.answers),
      recentItemIds: this.recentItemIds,
      now: Date.now(),
    }
    const item = selectNextItem(this.content.pool, state)
    if (item) {
      this.recentItemIds.unshift(item.id)
      this.recentItemIds.length = Math.min(this.recentItemIds.length, RECENT_MAX)
    }
    return item
  }

  async record(answer: Omit<AnswerInput, 'sessionId'>): Promise<void> {
    if (this.sessionId === null) throw new Error('no open session')
    const stored = await recordAnswer({ ...answer, sessionId: this.sessionId })
    // Kept in memory too, so the next selection reflects this answer without
    // re-reading the whole store.
    this.answers.push(stored)
  }

  async end(): Promise<void> {
    if (this.sessionId === null) return
    const id = this.sessionId
    this.sessionId = null
    await endSession(id)
  }
}
