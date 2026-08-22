/**
 * Practice — the endless feed.
 *
 * The loop is built around pace. A correct answer costs one tap and the feed
 * moves on by itself after a short beat; only a wrong answer stops to explain
 * itself, because that is the only moment the explanation is worth reading.
 * Tapping during the beat holds it, for when you do want to read why.
 *
 * The streak is the reward. It is the one number on screen while practising.
 */
import { clear, el } from '../dom.ts'
import { PracticeSession } from '../store/practice.ts'
import { ScenarioRenderer, hazardHit } from '../scenario/renderer.ts'
import { sfx } from '../sound.ts'
import { tabBar, topBar } from './chrome.ts'
import { TOPIC_LABELS, type FeedItem, type Question, type Scenario } from '../../shared/types.ts'

interface Outcome {
  correct: boolean
  responseTimeMs: number
}

/** How long a correct answer sits before the feed moves on. */
const HOLD_MS = 900

/** Streaks worth making a noise about. */
const MILESTONES = new Set([5, 10, 20, 35, 50, 75, 100])

export class FeedView {
  private readonly root: HTMLElement
  private readonly session = new PracticeSession()
  private started = false
  private answered = 0
  private correct = 0
  private streak = 0
  private best = 0
  private stopped = false
  private warned = false

  constructor(root: HTMLElement) {
    this.root = root
  }

  async start(): Promise<void> {
    this.stopped = false
    this.renderShell()
    try {
      await this.session.start()
      this.started = true
      window.addEventListener('pagehide', this.handleUnload)
    } catch (err) {
      return this.showError(err)
    }
    await this.loop()
  }

  stop(): void {
    this.stopped = true
    window.removeEventListener('pagehide', this.handleUnload)
    if (this.started) {
      this.started = false
      void this.session.end().catch(() => {})
    }
  }

  private handleUnload = (): void => {
    if (this.started) void this.session.end().catch(() => {})
  }

  private renderShell(): void {
    clear(this.root)
    const streak = el('span', { class: 'streak', id: 'streak' }, ['🔥 0'])
    this.root.append(
      topBar({ trailing: streak }),
      el('div', { class: 'session-progress' }, [el('div', { id: 'session-bar' })]),
      el('main', { class: 'screen', id: 'stage' }, [el('p', { class: 'muted' }, ['Loading…'])]),
      tabBar('#/'),
    )
  }

  private get stage(): HTMLElement {
    return this.root.querySelector('#stage') as HTMLElement
  }

  private updateStreak(): void {
    const node = this.root.querySelector('#streak')
    if (!node) return
    node.textContent = `🔥 ${this.streak}`
    node.classList.toggle('hot', this.streak >= 5)
    // Retrigger the pop each time rather than only on the first bump.
    node.classList.remove('bump')
    void (node as HTMLElement).offsetWidth
    node.classList.add('bump')
    setTimeout(() => node.classList.remove('bump'), 240)

    const bar = this.root.querySelector('#session-bar') as HTMLElement | null
    // No fixed session length, so the bar shows momentum towards a round
    // number rather than progress towards an end.
    if (bar) bar.style.width = `${Math.min(100, (this.answered % 20) * 5)}%`
  }

  private showError(err: unknown): void {
    clear(this.stage)
    this.stage.append(
      el('div', { class: 'card error enter' }, [
        el('h2', {}, ['Something went wrong']),
        el('p', { class: 'muted' }, [err instanceof Error ? err.message : String(err)]),
        el('button', { class: 'primary', onclick: () => void this.start() }, ['Try again']),
      ]),
    )
  }

  private showNoContent(): void {
    clear(this.stage)
    this.stage.append(
      el('div', { class: 'card error enter' }, [
        el('h2', {}, ['No questions loaded']),
        el('p', { class: 'muted' }, [
          'The question files could not be read. If this is a fresh deployment, check they were published alongside the app.',
        ]),
        el('button', { class: 'primary', onclick: () => void this.start() }, ['Try again']),
      ]),
    )
  }

  private warnOnce(): void {
    if (this.warned) return
    this.warned = true
    this.root
      .querySelector('.session-progress')
      ?.after(
        el('div', { class: 'banner warn-banner' }, [
          'Progress could not be saved on this device. Practice still works.',
        ]),
      )
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      const item = this.session.nextItem()
      if (!item) return this.showNoContent()

      const outcome =
        item.kind === 'question'
          ? await this.presentQuestion(item.question)
          : await this.presentScenario(item.scenario)

      if (this.stopped) return

      this.answered += 1
      if (outcome.correct) {
        this.correct += 1
        this.streak += 1
        this.best = Math.max(this.best, this.streak)
      } else {
        this.streak = 0
      }
      this.updateStreak()

      try {
        await this.session.record({
          itemId: item.id,
          topic: item.topic,
          correct: outcome.correct,
          responseTimeMs: outcome.responseTimeMs,
        })
      } catch (err) {
        console.error('[practice] could not record answer:', err)
        this.warnOnce()
      }
    }
  }

  /**
   * Feedback shared by plain questions and by the rules questions attached to
   * scenarios: green on the right answer and move on; red, an explanation and
   * a button on a wrong one.
   */
  private settle(options: {
    correct: boolean
    explanation: string
    ruleRef?: { chapter: string; page: number | null }
    feedback: HTMLElement
    done: () => void
  }): void {
    const { correct, explanation, ruleRef, feedback, done } = options

    if (correct) {
      sfx.correct()
      if (MILESTONES.has(this.streak + 1)) sfx.milestone()

      const bar = el('div', { class: 'autoadvance' }, [el('div')])
      bar.style.setProperty('--hold', `${HOLD_MS}ms`)
      feedback.append(
        el('div', { class: 'verdict good' }, ['✓ Correct']),
        bar,
      )

      let cancelled = false
      const timer = setTimeout(() => {
        if (!cancelled) done()
      }, HOLD_MS)

      // Tapping during the beat holds it, for when the reasoning is wanted.
      const hold = (): void => {
        if (cancelled) return
        cancelled = true
        clearTimeout(timer)
        bar.remove()
        feedback.append(
          ...[
            el('p', { class: 'explanation' }, [explanation]),
            ruleRef ? this.ruleRefLine(ruleRef.chapter, ruleRef.page) : null,
            el('button', { class: 'primary', onclick: done }, ['Next']),
          ].filter((node): node is HTMLElement => node !== null),
        )
      }
      this.stage.addEventListener('click', hold, { once: true })
      return
    }

    sfx.wrong()
    feedback.append(
      ...[
        el('div', { class: 'verdict bad' }, ['✕ Not quite']),
        el('p', { class: 'explanation' }, [explanation]),
        ruleRef ? this.ruleRefLine(ruleRef.chapter, ruleRef.page) : null,
        el('button', { class: 'primary', onclick: done }, ['Got it']),
      ].filter((node): node is HTMLElement => node !== null),
    )
    ;(feedback.querySelector('.primary') as HTMLElement | null)?.focus()
  }

  private ruleRefLine(chapter: string, page: number | null): HTMLElement {
    return el('p', { class: 'ruleref' }, [
      page === null ? `Handbook: ${chapter}` : `Handbook: ${chapter}, p.${page}`,
    ])
  }

  private presentQuestion(question: Question): Promise<Outcome> {
    return new Promise((resolve) => {
      const shownAt = performance.now()
      clear(this.stage)

      const optionList = el('div', { class: 'options' })
      const feedback = el('div', { class: 'feedback' })

      this.stage.append(
        el('section', { class: 'card enter' }, [
          el('div', { class: 'topic-chip' }, [TOPIC_LABELS[question.topic]]),
          el('h2', { class: 'prompt' }, [question.text]),
          question.image
            ? el('img', { class: 'diagram', src: `/${question.image}`, alt: 'Handbook diagram' })
            : null,
          optionList,
          feedback,
        ]),
      )

      const buttons = question.options.map((option, index) =>
        el('button', { class: 'option', type: 'button', onclick: () => choose(index) }, [
          el('span', { class: 'option-key' }, [String.fromCharCode(65 + index)]),
          option,
        ]),
      )
      optionList.append(...buttons)

      const choose = (index: number): void => {
        const responseTimeMs = Math.round(performance.now() - shownAt)
        const correct = index === question.correctIndex
        buttons.forEach((button, i) => {
          button.disabled = true
          if (i === question.correctIndex) button.classList.add('correct')
          if (i === index && !correct) button.classList.add('wrong')
        })
        this.settle({
          correct,
          explanation: question.explanation,
          ruleRef: question.ruleRef,
          feedback,
          done: () => resolve({ correct, responseTimeMs }),
        })
      }
    })
  }

  private presentScenario(scenario: Scenario): Promise<Outcome> {
    return new Promise((resolve) => {
      clear(this.stage)

      const canvas = el('canvas', { class: 'scenario-canvas' })
      const controls = el('div', { class: 'scenario-controls' })
      const feedback = el('div', { class: 'feedback' })

      this.stage.append(
        el('section', { class: 'card enter' }, [
          el('div', { class: 'topic-chip' }, [TOPIC_LABELS[scenario.topic]]),
          el('h2', { class: 'prompt' }, [scenario.title]),
          el('div', { class: 'canvas-wrap' }, [canvas]),
          controls,
          feedback,
        ]),
      )

      const renderer = new ScenarioRenderer(canvas, scenario)
      const onResize = (): void => {
        renderer.resize()
        renderer.draw(lastFrameMs, { revealHazard: revealing })
      }
      window.addEventListener('resize', onResize)

      let startedAt = 0
      let lastFrameMs = 0
      let revealing = false
      let frame = 0
      let answered = false

      const isHazard = scenario.assessment.kind === 'hazard-perception'

      const stopLoop = (): void => {
        if (frame) cancelAnimationFrame(frame)
        frame = 0
      }

      const finish = (correct: boolean, responseTimeMs: number): void => {
        answered = true
        stopLoop()
        window.removeEventListener('resize', onResize)
        canvas.classList.remove('tappable')
        resolve({ correct, responseTimeMs })
      }

      const tick = (now: number): void => {
        lastFrameMs = now - startedAt
        if (lastFrameMs >= scenario.durationMs) {
          lastFrameMs = scenario.durationMs
          renderer.draw(lastFrameMs, { revealHazard: revealing })
          stopLoop()
          if (isHazard && !answered) showHazardResult(false, scenario.durationMs, 'You did not tap in time.')
          else if (!isHazard && !answered) showRulesQuestion()
          return
        }
        renderer.draw(lastFrameMs, { revealHazard: revealing })
        frame = requestAnimationFrame(tick)
      }

      const play = (reveal = false): void => {
        stopLoop()
        revealing = reveal
        startedAt = performance.now()
        frame = requestAnimationFrame(tick)
      }

      // pointerdown rather than click: on touch, click can lag the tap by a few
      // hundred milliseconds, and this timing is the thing being measured.
      const onCanvasTap = (event: PointerEvent): void => {
        if (answered || scenario.assessment.kind !== 'hazard-perception') return
        const at = lastFrameMs
        const point = renderer.toScenarioPoint(event.clientX, event.clientY)
        const { startMs, endMs } = scenario.assessment.responseWindowMs
        const inWindow = at >= startMs && at <= endMs
        const onHazard = hazardHit(scenario, point, at)
        stopLoop()

        if (inWindow && onHazard) showHazardResult(true, at, 'Spotted it in time.')
        else if (!onHazard) showHazardResult(false, at, 'That was not the hazard.')
        else if (at < startMs) showHazardResult(false, at, 'Too early — the hazard had not developed yet.')
        else showHazardResult(false, at, 'Too late — by then you would already have needed to react.')
      }

      const showHazardResult = (correct: boolean, atMs: number, note: string): void => {
        if (answered) return
        answered = true
        canvas.classList.remove('tappable')
        canvas.removeEventListener('pointerdown', onCanvasTap)
        clear(controls)
        revealing = true
        renderer.draw(Math.min(atMs, scenario.durationMs), { revealHazard: true })

        const assessment = scenario.assessment
        const explanation =
          assessment.kind === 'hazard-perception' ? `${note} ${assessment.explanation}` : note

        this.settle({
          correct,
          explanation,
          feedback,
          done: () => finish(correct, Math.round(atMs)),
        })
      }

      const showRulesQuestion = (): void => {
        if (scenario.assessment.kind !== 'rules-question') return
        const assessment = scenario.assessment
        const shownAt = performance.now()
        clear(controls)
        controls.append(el('button', { class: 'secondary', onclick: () => play(false) }, ['↻ Replay']))

        const optionList = el('div', { class: 'options' })
        feedback.append(el('p', { class: 'prompt-sub' }, [assessment.text]), optionList)

        const buttons = assessment.options.map((option, index) =>
          el('button', { class: 'option', type: 'button', onclick: () => choose(index) }, [
            el('span', { class: 'option-key' }, [String.fromCharCode(65 + index)]),
            option,
          ]),
        )
        optionList.append(...buttons)

        const choose = (index: number): void => {
          const responseTimeMs = Math.round(performance.now() - shownAt)
          const correct = index === assessment.correctIndex
          buttons.forEach((button, i) => {
            button.disabled = true
            if (i === assessment.correctIndex) button.classList.add('correct')
            if (i === index && !correct) button.classList.add('wrong')
          })
          this.settle({
            correct,
            explanation: assessment.explanation,
            ruleRef: assessment.ruleRef,
            feedback,
            done: () => finish(correct, responseTimeMs),
          })
        }
      }

      if (isHazard) {
        canvas.classList.add('tappable')
        canvas.addEventListener('pointerdown', onCanvasTap)
        controls.append(el('p', { class: 'note' }, ['Tap the hazard as soon as you see it.']))
      } else {
        controls.append(el('p', { class: 'note' }, ['Watch, then answer.']))
      }

      renderer.draw(0)
      play(false)
    })
  }
}
