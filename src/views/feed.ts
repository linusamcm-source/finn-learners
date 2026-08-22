/**
 * Phase 4 — the feed view.
 *
 * An endless loop: fetch an item, present it, grade the answer, report it,
 * fetch the next. There is no end state and no score to chase; the session
 * ends when the learner walks away.
 */
import { api, endSessionOnUnload, OfflineError } from '../api.ts'
import { clear, el } from '../dom.ts'
import { ScenarioRenderer, hazardHit } from '../scenario/renderer.ts'
import { TOPIC_LABELS, type FeedItem, type Question, type Scenario } from '../../shared/types.ts'

interface Outcome {
  correct: boolean
  responseTimeMs: number
}

export class FeedView {
  private readonly root: HTMLElement
  private sessionId: number | null = null
  private answeredThisSession = 0
  private correctThisSession = 0
  private streak = 0
  private stopped = false

  constructor(root: HTMLElement) {
    this.root = root
  }

  async start(): Promise<void> {
    this.stopped = false
    this.renderShell()
    try {
      const session = await api.startSession()
      this.sessionId = session.id
      window.addEventListener('pagehide', this.handleUnload)
    } catch (err) {
      return this.showError(err)
    }
    await this.loop()
  }

  stop(): void {
    this.stopped = true
    window.removeEventListener('pagehide', this.handleUnload)
    if (this.sessionId !== null) {
      void api.endSession(this.sessionId).catch(() => {})
      this.sessionId = null
    }
  }

  private handleUnload = (): void => {
    if (this.sessionId !== null) endSessionOnUnload(this.sessionId)
  }

  private renderShell(): void {
    clear(this.root)
    this.root.append(
      el('header', { class: 'bar' }, [
        el('h1', {}, ['learner-dash']),
        el('div', { class: 'bar-stats', id: 'session-stats' }, ['—']),
        el('a', { class: 'link', href: '#/parent' }, ['Parent view']),
      ]),
      el('main', { class: 'stage', id: 'stage' }, [el('p', { class: 'muted' }, ['Loading…'])]),
    )
  }

  private get stage(): HTMLElement {
    return this.root.querySelector('#stage') as HTMLElement
  }

  private updateStats(): void {
    const node = this.root.querySelector('#session-stats')
    if (!node) return
    const accuracy =
      this.answeredThisSession === 0
        ? '—'
        : `${Math.round((this.correctThisSession / this.answeredThisSession) * 100)}%`
    node.textContent = `${this.answeredThisSession} answered · ${accuracy} · streak ${this.streak}`
  }

  private showError(err: unknown): void {
    const offline = err instanceof OfflineError
    clear(this.stage)
    this.stage.append(
      el('div', { class: 'card error' }, [
        el('h2', {}, [offline ? 'Cannot reach the server' : 'Something went wrong']),
        el('p', {}, [err instanceof Error ? err.message : String(err)]),
        offline
          ? el('p', { class: 'muted' }, [
              'The app itself is installed and its questions are cached, so this screen works offline — but answers are recorded on the server, and practising without recording it would lose the progress.',
            ])
          : null,
        el('button', { class: 'primary', onclick: () => void this.loop() }, ['Try again']),
      ]),
    )
  }

  /** The endless loop itself. */
  private async loop(): Promise<void> {
    while (!this.stopped) {
      let item: FeedItem
      try {
        item = await api.nextItem()
      } catch (err) {
        return this.showError(err)
      }

      const outcome =
        item.kind === 'question'
          ? await this.presentQuestion(item.question)
          : await this.presentScenario(item.scenario)

      if (this.stopped) return

      this.answeredThisSession += 1
      if (outcome.correct) {
        this.correctThisSession += 1
        this.streak += 1
      } else {
        this.streak = 0
      }
      this.updateStats()

      if (this.sessionId !== null) {
        await api
          .recordAnswer({
            sessionId: this.sessionId,
            itemId: item.id,
            topic: item.topic,
            correct: outcome.correct,
            responseTimeMs: outcome.responseTimeMs,
          })
          .catch(() => {
            // A dropped answer should not end the session — the learner keeps going.
          })
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * Plain and diagram questions
   * ---------------------------------------------------------------- */

  private presentQuestion(question: Question): Promise<Outcome> {
    return new Promise((resolve) => {
      const shownAt = performance.now()
      clear(this.stage)

      const optionList = el('div', { class: 'options' })
      const feedback = el('div', { class: 'feedback' })

      const card = el('section', { class: 'card' }, [
        el('div', { class: 'topic-chip' }, [TOPIC_LABELS[question.topic]]),
        el('h2', { class: 'prompt' }, [question.text]),
        question.image
          ? el('img', { class: 'diagram', src: `/${question.image}`, alt: 'Handbook diagram' })
          : null,
        optionList,
        feedback,
      ])
      this.stage.append(card)

      const buttons = question.options.map((option, index) =>
        el(
          'button',
          {
            class: 'option',
            type: 'button',
            onclick: () => choose(index),
          },
          [el('span', { class: 'option-key' }, [String.fromCharCode(65 + index)]), option],
        ),
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
        feedback.append(
          el('div', { class: correct ? 'verdict good' : 'verdict bad' }, [
            correct ? 'Correct' : 'Not quite',
          ]),
          el('p', { class: 'explanation' }, [question.explanation]),
          this.ruleRefLine(question.ruleRef.chapter, question.ruleRef.page),
          el(
            'button',
            { class: 'primary', onclick: () => resolve({ correct, responseTimeMs }) },
            ['Next'],
          ),
        )
        ;(feedback.querySelector('.primary') as HTMLElement | null)?.focus()
      }
    })
  }

  private ruleRefLine(chapter: string, page: number | null): HTMLElement {
    return el('p', { class: 'ruleref' }, [
      page === null ? `Handbook: ${chapter}` : `Handbook: ${chapter}, p.${page}`,
    ])
  }

  /* ---------------------------------------------------------------- *
   * Scenarios
   * ---------------------------------------------------------------- */

  private presentScenario(scenario: Scenario): Promise<Outcome> {
    return new Promise((resolve) => {
      clear(this.stage)

      const canvas = el('canvas', { class: 'scenario-canvas' })
      const controls = el('div', { class: 'scenario-controls' })
      const feedback = el('div', { class: 'feedback' })

      const card = el('section', { class: 'card' }, [
        el('div', { class: 'topic-chip' }, [TOPIC_LABELS[scenario.topic]]),
        el('h2', { class: 'prompt' }, [scenario.title]),
        el('div', { class: 'canvas-wrap' }, [canvas]),
        controls,
        feedback,
      ])
      this.stage.append(card)

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
          if (isHazard && !answered) onHazardTimeout()
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

      /* ---- hazard perception ---- */

      const onHazardTimeout = (): void => {
        showHazardResult(false, scenario.durationMs, 'You did not tap in time.')
      }

      // pointerdown rather than click: on touch, click can lag the actual tap
      // by a few hundred milliseconds, and this timing is the thing being
      // measured. pointerdown fires as the finger lands.
      const onCanvasTap = (event: PointerEvent): void => {
        if (answered || scenario.assessment.kind !== 'hazard-perception') return
        const at = lastFrameMs
        const point = renderer.toScenarioPoint(event.clientX, event.clientY)
        const { startMs, endMs } = scenario.assessment.responseWindowMs
        const inWindow = at >= startMs && at <= endMs
        const onHazard = hazardHit(scenario, point, at)
        stopLoop()

        if (inWindow && onHazard) {
          showHazardResult(true, at, 'You spotted the hazard in time.')
        } else if (!onHazard) {
          showHazardResult(false, at, 'That was not the hazard.')
        } else if (at < startMs) {
          showHazardResult(false, at, 'Too early — the hazard had not developed yet.')
        } else {
          showHazardResult(false, at, 'Too late — by then you would already have needed to react.')
        }
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
        feedback.append(
          el('div', { class: correct ? 'verdict good' : 'verdict bad' }, [
            correct ? 'Correct' : 'Not quite',
          ]),
          el('p', { class: 'note' }, [note]),
          el('p', { class: 'explanation' }, [
            assessment.kind === 'hazard-perception' ? assessment.explanation : '',
          ]),
          el('div', { class: 'row' }, [
            el(
              'button',
              {
                class: 'secondary',
                onclick: () => {
                  clear(feedback)
                  answered = false
                  replayThenResult(correct, atMs, note)
                },
              },
              ['Replay with the hazard shown'],
            ),
            el(
              'button',
              { class: 'primary', onclick: () => finish(correct, Math.round(atMs)) },
              ['Next'],
            ),
          ]),
        )
        ;(feedback.querySelector('.primary') as HTMLElement | null)?.focus()
      }

      const replayThenResult = (correct: boolean, atMs: number, note: string): void => {
        revealing = true
        startedAt = performance.now()
        stopLoop()
        const replayTick = (now: number): void => {
          lastFrameMs = now - startedAt
          if (lastFrameMs >= scenario.durationMs) {
            renderer.draw(scenario.durationMs, { revealHazard: true })
            stopLoop()
            showHazardResult(correct, atMs, note)
            return
          }
          renderer.draw(lastFrameMs, { revealHazard: true })
          frame = requestAnimationFrame(replayTick)
        }
        frame = requestAnimationFrame(replayTick)
      }

      /* ---- rules question over a scenario ---- */

      const showRulesQuestion = (): void => {
        if (scenario.assessment.kind !== 'rules-question') return
        const assessment = scenario.assessment
        const shownAt = performance.now()
        clear(controls)
        controls.append(
          el('button', { class: 'secondary', onclick: () => play(false) }, ['Replay']),
        )

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
          feedback.append(
            el('div', { class: correct ? 'verdict good' : 'verdict bad' }, [
              correct ? 'Correct' : 'Not quite',
            ]),
            el('p', { class: 'explanation' }, [assessment.explanation]),
            this.ruleRefLine(assessment.ruleRef.chapter, assessment.ruleRef.page),
            el('button', { class: 'primary', onclick: () => finish(correct, responseTimeMs) }, [
              'Next',
            ]),
          )
          ;(feedback.querySelector('.primary') as HTMLElement | null)?.focus()
        }
      }

      if (isHazard) {
        canvas.classList.add('tappable')
        canvas.addEventListener('pointerdown', onCanvasTap)
        controls.append(
          el('p', { class: 'note' }, ['Tap the hazard as soon as you see it.']),
        )
      } else {
        controls.append(el('p', { class: 'note' }, ['Watch, then answer.']))
      }

      // A frame at t=0 so the scene is visible before playback starts.
      renderer.draw(0)
      play(false)
    })
  }
}
