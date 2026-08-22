/**
 * Progress — the learner's own screen, as opposed to the parent's.
 *
 * The job here is to make the work feel finishable. Nine topics to get on top
 * of beats an accuracy percentage that drifts up and down forever, so mastery
 * is the headline and everything else supports it.
 *
 * Every meter states its level in words. Colour is a second channel, never the
 * only one.
 */
import { clear, el } from '../dom.ts'
import { loadContent } from '../content/load.ts'
import {
  readiness,
  summarise,
  topicMastery,
  type TopicMastery,
} from '../store/derive.ts'
import { allAnswers, allSessions } from '../store/idb.ts'
import { tabBar, topBar } from './chrome.ts'
import type { TrendPoint } from '../../shared/types.ts'

export class ProgressView {
  private readonly root: HTMLElement

  constructor(root: HTMLElement) {
    this.root = root
  }

  async start(): Promise<void> {
    clear(this.root)
    this.root.append(
      topBar({ showSound: true }),
      el('main', { class: 'screen', id: 'stage' }, [el('p', { class: 'muted' }, ['Loading…'])]),
      tabBar('#/progress'),
    )
    const stage = this.root.querySelector('#stage') as HTMLElement

    try {
      const [content, sessions, answers] = await Promise.all([loadContent(), allSessions(), allAnswers()])
      const mastery = topicMastery(answers)
      const ready = readiness(mastery)
      const summary = summarise(sessions, answers, {
        questions: content.questions.length,
        scenarios: content.scenarios.length,
        unverified: content.unverified,
      })

      clear(stage)

      if (answers.length === 0) {
        stage.append(
          el('section', { class: 'card hero enter' }, [
            el('div', { class: 'hero-value' }, ['0%']),
            el('div', { class: 'hero-label' }, ['ready']),
            el('div', { class: 'hero-sub' }, ['Answer a few questions and this fills in.']),
            el('a', { class: 'primary', href: '#/', style: 'text-decoration:none;display:inline-block;margin-top:16px' }, [
              'Start practising',
            ]),
          ]),
        )
        return
      }

      stage.append(
        // A single number is the right form here: the question is "how am I
        // going", and one figure answers it better than any chart.
        el('section', { class: 'card hero enter' }, [
          el('div', { class: 'hero-value' }, [`${ready.percent}%`]),
          el('div', { class: 'hero-label' }, ['ready']),
          el('div', { class: 'hero-sub' }, [ready.advice]),
        ]),

        el('section', { class: 'card' }, [
          el('div', { class: 'stat-grid' }, [
            stat(`${ready.mastered}/${ready.total}`, 'Topics mastered'),
            stat(String(summary.totalItemsAnswered), 'Questions answered'),
            stat(String(summary.sessionsThisWeek), 'Sessions this week'),
            stat(pct(summary.overallAccuracy), 'Overall accuracy'),
          ]),
        ]),

        el('section', { class: 'card' }, [
          el('h2', {}, ['Topics']),
          el('div', { class: 'meters' }, mastery.map(meter)),
        ]),

        el('section', { class: 'card' }, [
          el('h2', {}, ['Last 14 days']),
          trendChart(summary.trend),
        ]),

        el('section', { class: 'card' }, [
          el('h2', {}, ['Question bank']),
          el('p', { class: 'muted small' }, [
            `${summary.content.questions} questions and ${summary.content.scenarios} scenarios.`,
          ]),
          summary.content.unverified > 0
            ? el('p', { class: 'small', style: 'color:var(--warning)' }, [
                `${summary.content.unverified} not yet checked against the handbook.`,
              ])
            : null,
          el('a', { class: 'secondary', href: '#/parent', style: 'text-decoration:none;display:inline-block;margin-top:10px' }, [
            'Parent view',
          ]),
        ]),
      )
    } catch (err) {
      clear(stage)
      stage.append(
        el('div', { class: 'card error' }, [
          el('p', {}, [err instanceof Error ? err.message : String(err)]),
        ]),
      )
    }
  }

  stop(): void {
    // No timers or listeners held.
  }
}

function pct(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`
}

function stat(value: string, label: string): HTMLElement {
  return el('div', { class: 'stat' }, [
    el('div', { class: 'stat-value' }, [value]),
    el('div', { class: 'stat-label' }, [label]),
  ])
}

function meter(topic: TopicMastery): HTMLElement {
  return el('div', {}, [
    el('div', { class: 'meter-head' }, [
      el('span', { class: 'meter-name' }, [topic.label]),
      // The level in words: colour is a second channel, never the only one.
      el('span', { class: `meter-level ${topic.tone}` }, [topic.levelLabel]),
    ]),
    el('div', { class: 'meter-track' }, [
      el('div', { class: `meter-fill ${topic.tone}`, style: `width:${Math.round(topic.fill * 100)}%` }),
    ]),
  ])
}

/**
 * Questions answered per day. Height is the count; there is no second encoding,
 * because the only question this answers is "have I been showing up".
 */
function trendChart(trend: TrendPoint[]): HTMLElement {
  const width = 100
  const height = 30
  const max = Math.max(1, ...trend.map((p) => p.answered))
  const slot = width / Math.max(1, trend.length)

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  svg.setAttribute('class', 'trend')
  svg.setAttribute('preserveAspectRatio', 'none')
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', `Questions answered per day over the last ${trend.length} days`)

  trend.forEach((point, i) => {
    const h = point.answered === 0 ? 0.7 : (point.answered / max) * (height - 2)
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.setAttribute('x', String(i * slot + slot * 0.2))
    rect.setAttribute('y', String(height - h))
    rect.setAttribute('width', String(slot * 0.6))
    rect.setAttribute('height', String(h))
    rect.setAttribute('rx', '1')
    rect.setAttribute('class', point.answered === 0 ? 'trend-bar empty' : 'trend-bar')
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title')
    title.textContent = `${point.date}: ${point.answered} answered`
    rect.append(title)
    svg.append(rect)
  })

  const first = trend[0]
  const last = trend[trend.length - 1]
  return el('div', {}, [
    svg,
    el('div', { class: 'trend-axis' }, [
      el('span', {}, [first ? shortDate(first.date) : '']),
      el('span', {}, [last ? shortDate(last.date) : '']),
    ]),
  ])
}

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}
