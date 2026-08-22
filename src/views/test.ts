/**
 * Practice test.
 *
 * A fixed run of questions with no feedback until the end, because that is the
 * thing the endless feed cannot give you: a score, and the nerve of not
 * knowing how you are going while you answer.
 *
 * On the target: this app does not know the official pass mark for the
 * Tasmanian knowledge test, and inventing one would be worse than useless to
 * someone relying on it. 80% is stated as a practice target and labelled as
 * one — confirm the real figure with Transport Services.
 */
import { clear, el } from '../dom.ts'
import { loadContent } from '../content/load.ts'
import { deriveHistories, recentTopicPerformance } from '../store/derive.ts'
import { allAnswers, recordAnswer, startSession, endSession } from '../store/idb.ts'
import { selectNextItem, type SelectionState } from '../feed/select.ts'
import { sfx } from '../sound.ts'
import { tabBar, topBar } from './chrome.ts'
import { TOPIC_LABELS, type Question, type Topic } from '../../shared/types.ts'

const TEST_LENGTH = 30
const TARGET = 0.8

interface Attempt {
  question: Question
  chosen: number
}

export class TestView {
  private readonly root: HTMLElement
  private questions: Question[] = []
  private attempts: Attempt[] = []
  private index = 0
  private sessionId: number | null = null
  private stopped = false

  constructor(root: HTMLElement) {
    this.root = root
  }

  async start(): Promise<void> {
    this.stopped = false
    clear(this.root)
    this.root.append(topBar(), el('main', { class: 'screen', id: 'stage' }, []), tabBar('#/test'))
    this.showIntro()
  }

  stop(): void {
    this.stopped = true
    if (this.sessionId !== null) {
      void endSession(this.sessionId).catch(() => {})
      this.sessionId = null
    }
  }

  private get stage(): HTMLElement {
    return this.root.querySelector('#stage') as HTMLElement
  }

  private showIntro(): void {
    clear(this.stage)
    this.stage.append(
      el('section', { class: 'card enter' }, [
        el('h2', {}, ['Practice test']),
        el('p', { class: 'muted' }, [
          `${TEST_LENGTH} questions, no feedback until the end. Weaker topics come up more often, so it is not the same ${TEST_LENGTH} questions every time.`,
        ]),
        el('p', { class: 'muted small' }, [
          `The target here is ${Math.round(TARGET * 100)}%. That is a practice goal set by this app, not the official pass mark — check that with Transport Services.`,
        ]),
        el('button', { class: 'primary', onclick: () => void this.begin() }, ['Start the test']),
      ]),
    )
  }

  /**
   * Pick the paper up front, weighted the way the feed is, so a test leans
   * towards what the learner is actually weak at — but without repeats, which
   * a straight run of feed picks would allow.
   */
  private async begin(): Promise<void> {
    const [content, answers] = await Promise.all([loadContent(), allAnswers()])
    const questionsOnly = content.pool.filter((item) => item.kind === 'question')
    if (questionsOnly.length === 0) return

    const state: SelectionState = {
      histories: deriveHistories(answers),
      topicPerformance: recentTopicPerformance(answers),
      recentItemIds: [],
      now: Date.now(),
    }

    const picked: Question[] = []
    const used = new Set<string>()
    while (picked.length < Math.min(TEST_LENGTH, questionsOnly.length)) {
      const remaining = questionsOnly.filter((item) => !used.has(item.id))
      const item = selectNextItem(remaining, { ...state, recentItemIds: [] })
      if (!item || item.kind !== 'question') break
      used.add(item.id)
      picked.push(item.question)
    }

    this.questions = picked
    this.attempts = []
    this.index = 0
    this.sessionId = (await startSession()).id
    this.showQuestion()
  }

  private showQuestion(): void {
    if (this.stopped) return
    const question = this.questions[this.index]
    if (!question) {
      void this.showResults()
      return
    }

    const shownAt = performance.now()
    clear(this.stage)
    const optionList = el('div', { class: 'options' })

    this.stage.append(
      el('section', { class: 'card enter' }, [
        el('div', { class: 'test-progress' }, [
          el('span', {}, [`Question ${this.index + 1} of ${this.questions.length}`]),
          el('span', {}, [TOPIC_LABELS[question.topic]]),
        ]),
        el(
          'div',
          { class: 'pips' },
          this.questions.map((_, i) => el('span', { class: `pip${i < this.index ? ' done' : ''}` })),
        ),
        el('h2', { class: 'prompt', style: 'margin-top:16px' }, [question.text]),
        question.image
          ? el('img', { class: 'diagram', src: `/${question.image}`, alt: 'Handbook diagram' })
          : null,
        optionList,
      ]),
    )

    const choose = (chosen: number): void => {
      sfx.tick()
      this.attempts.push({ question, chosen })
      void this.record(question, chosen, Math.round(performance.now() - shownAt))
      this.index += 1
      this.showQuestion()
    }

    optionList.append(
      ...question.options.map((option, i) =>
        el('button', { class: 'option', type: 'button', onclick: () => choose(i) }, [
          el('span', { class: 'option-key' }, [String.fromCharCode(65 + i)]),
          option,
        ]),
      ),
    )
  }

  /** Test answers count towards progress like any other — they are real practice. */
  private async record(question: Question, chosen: number, responseTimeMs: number): Promise<void> {
    if (this.sessionId === null) return
    try {
      await recordAnswer({
        sessionId: this.sessionId,
        itemId: question.id,
        topic: question.topic,
        correct: chosen === question.correctIndex,
        responseTimeMs,
      })
    } catch {
      // Losing one answer should not derail a test in progress.
    }
  }

  private async showResults(): Promise<void> {
    if (this.sessionId !== null) {
      await endSession(this.sessionId).catch(() => {})
      this.sessionId = null
    }

    const total = this.attempts.length
    const right = this.attempts.filter((a) => a.chosen === a.question.correctIndex).length
    const share = total === 0 ? 0 : right / total
    const hit = share >= TARGET
    if (hit) sfx.milestone()
    else sfx.wrong()

    const missed = this.attempts.filter((a) => a.chosen !== a.question.correctIndex)

    const perTopic = new Map<Topic, { right: number; total: number }>()
    for (const attempt of this.attempts) {
      const row = perTopic.get(attempt.question.topic) ?? { right: 0, total: 0 }
      row.total += 1
      if (attempt.chosen === attempt.question.correctIndex) row.right += 1
      perTopic.set(attempt.question.topic, row)
    }

    clear(this.stage)
    this.stage.append(
      el('section', { class: 'card hero enter' }, [
        el('div', { class: 'hero-value', style: `color:${hit ? 'var(--good)' : 'var(--critical)'}` }, [
          `${Math.round(share * 100)}%`,
        ]),
        el('div', { class: 'hero-label' }, [`${right} of ${total} correct`]),
        el('div', { class: 'hero-sub' }, [
          hit
            ? `Above the ${Math.round(TARGET * 100)}% practice target.`
            : `Below the ${Math.round(TARGET * 100)}% practice target — worth another run.`,
        ]),
      ]),

      // Actions sit up here rather than at the foot of the page: with a long
      // review below, the bottom of this screen is a long way down.
      el('div', { class: 'row' }, [
        el('button', { class: 'primary', onclick: () => void this.begin() }, ['Take another']),
        el('a', {
          class: 'secondary',
          href: '#/',
          style: 'text-decoration:none;display:inline-flex;align-items:center',
        }, ['Back to practice']),
      ]),

      el('section', { class: 'card' }, [
        el('h2', {}, ['By topic']),
        el(
          'div',
          { class: 'meters' },
          [...perTopic.entries()]
            .sort((a, b) => a[1].right / a[1].total - b[1].right / b[1].total)
            .map(([topic, row]) => {
              const pct = Math.round((row.right / row.total) * 100)
              const tone = pct >= 85 ? 'good' : pct >= 70 ? 'warning' : 'critical'
              return el('div', {}, [
                el('div', { class: 'meter-head' }, [
                  el('span', { class: 'meter-name' }, [TOPIC_LABELS[topic]]),
                  el('span', { class: `meter-level ${tone}` }, [`${row.right}/${row.total}`]),
                ]),
                el('div', { class: 'meter-track' }, [
                  el('div', { class: `meter-fill ${tone}`, style: `width:${pct}%` }),
                ]),
              ])
            }),
        ),
      ]),

      missed.length > 0
        ? el('section', { class: 'card' }, [
            el('h2', {}, [`What you missed (${missed.length})`]),
            el('p', { class: 'muted small', style: 'margin:-8px 0 10px' }, [
              'Tap a question to see the answer.',
            ]),
            el('div', { class: 'review' }, missed.map(reviewItem)),
          ])
        : el('section', { class: 'card' }, [
            el('h2', {}, ['Nothing missed']),
            el('p', { class: 'muted' }, ['A clean run.']),
          ]),
    )
  }
}

/**
 * One missed question, collapsed to its text. Twenty wrong answers expanded in
 * full make a page nobody scrolls to the end of.
 */
function reviewItem(attempt: Attempt): HTMLElement {
  return el('details', { class: 'review-item' }, [
    el('summary', {}, [attempt.question.text]),
    el('p', { class: 'small', style: 'margin:8px 0 4px;color:var(--critical)' }, [
      `You said: ${attempt.question.options[attempt.chosen] ?? '—'}`,
    ]),
    el('p', { class: 'small', style: 'margin:0 0 6px;color:var(--good)' }, [
      `Answer: ${attempt.question.options[attempt.question.correctIndex]}`,
    ]),
    el('p', { class: 'small muted', style: 'margin:0' }, [attempt.question.explanation]),
  ])
}
