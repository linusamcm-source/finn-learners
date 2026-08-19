/**
 * Phase 5 — the parent summary.
 *
 * Read-only. Four things a parent actually wants: how much practice happened
 * this week, how much all up, which topics are weak, and whether it is
 * trending anywhere.
 */
import { api } from '../api.ts'
import { clear, el, formatPercent } from '../dom.ts'
import type { ParentSummary, TopicStat, TrendPoint } from '../../shared/types.ts'

export class ParentView {
  private readonly root: HTMLElement

  constructor(root: HTMLElement) {
    this.root = root
  }

  async start(): Promise<void> {
    clear(this.root)
    this.root.append(
      el('header', { class: 'bar' }, [
        el('h1', {}, ['Progress']),
        el('a', { class: 'link', href: '#/' }, ['Back to practice']),
      ]),
      el('main', { class: 'stage', id: 'stage' }, [el('p', { class: 'muted' }, ['Loading…'])]),
    )

    const stage = this.root.querySelector('#stage') as HTMLElement
    try {
      const summary = await api.summary()
      clear(stage)
      stage.append(...this.render(summary))
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
    // Nothing to tear down — the view holds no timers or listeners.
  }

  private render(summary: ParentSummary): HTMLElement[] {
    const cards: HTMLElement[] = [
      el('section', { class: 'card' }, [
        el('h2', {}, ['This week']),
        el('div', { class: 'stat-grid' }, [
          stat('Sessions', String(summary.sessionsThisWeek)),
          stat('Items answered', String(summary.itemsThisWeek)),
          stat('All-time items', String(summary.totalItemsAnswered)),
          stat('Overall accuracy', formatPercent(summary.overallAccuracy)),
        ]),
      ]),
    ]

    if (summary.totalItemsAnswered === 0) {
      cards.push(
        el('section', { class: 'card' }, [
          el('p', { class: 'muted' }, [
            'No practice recorded yet. Answers appear here as soon as the first session starts.',
          ]),
        ]),
      )
      return cards
    }

    if (summary.weakestTopics.length > 0) {
      cards.push(
        el('section', { class: 'card' }, [
          el('h2', {}, ['Worth some attention']),
          el(
            'ul',
            { class: 'weak-list' },
            summary.weakestTopics.map((topic) =>
              el('li', {}, [
                el('strong', {}, [topic.label]),
                ` — ${formatPercent(topic.accuracy)} across ${topic.answered} questions`,
              ]),
            ),
          ),
        ]),
      )
    }

    cards.push(
      el('section', { class: 'card' }, [
        el('h2', {}, ['Accuracy by topic']),
        el('div', { class: 'bars' }, summary.byTopic.map(topicBar)),
      ]),
      el('section', { class: 'card' }, [
        el('h2', {}, ['Last 14 days']),
        trendChart(summary.trend),
      ]),
      el('section', { class: 'card' }, [
        el('h2', {}, ['Recent sessions']),
        summary.recentSessions.length === 0
          ? el('p', { class: 'muted' }, ['None yet.'])
          : el('table', { class: 'sessions' }, [
              el('thead', {}, [
                el('tr', {}, [
                  el('th', {}, ['Started']),
                  el('th', {}, ['Items']),
                  el('th', {}, ['Accuracy']),
                ]),
              ]),
              el(
                'tbody',
                {},
                summary.recentSessions.map((session) =>
                  el('tr', {}, [
                    el('td', {}, [formatDateTime(session.startedAt)]),
                    el('td', {}, [String(session.itemCount)]),
                    el('td', {}, [formatPercent(session.accuracy)]),
                  ]),
                ),
              ),
            ]),
      ]),
      el('section', { class: 'card' }, [
        el('h2', {}, ['Content']),
        el('p', { class: 'muted' }, [
          `${summary.content.questions} questions and ${summary.content.scenarios} scenarios loaded.`,
        ]),
        summary.content.unverified > 0
          ? el('p', { class: 'warn' }, [
              `${summary.content.unverified} items have not yet been checked against the handbook. ` +
                'Run `just verify-content` and review them before relying on this for test preparation.',
            ])
          : null,
      ]),
    )

    return cards
  }
}

function stat(label: string, value: string): HTMLElement {
  return el('div', { class: 'stat' }, [
    el('div', { class: 'stat-value' }, [value]),
    el('div', { class: 'stat-label' }, [label]),
  ])
}

function topicBar(topic: TopicStat): HTMLElement {
  const percent = topic.accuracy === null ? 0 : Math.round(topic.accuracy * 100)
  const tone = topic.accuracy === null ? 'none' : percent >= 85 ? 'good' : percent >= 70 ? 'ok' : 'bad'
  return el('div', { class: 'bar-row' }, [
    el('div', { class: 'bar-label' }, [topic.label]),
    el('div', { class: 'bar-track' }, [
      el('div', { class: `bar-fill ${tone}`, style: `width:${percent}%` }),
    ]),
    el('div', { class: 'bar-value' }, [
      topic.answered === 0 ? 'not seen' : `${formatPercent(topic.accuracy)} (${topic.answered})`,
    ]),
  ])
}

/**
 * A plain column chart: height is how much was answered that day, colour is
 * how accurately. Drawn as inline SVG so it needs no charting dependency.
 */
function trendChart(trend: TrendPoint[]): HTMLElement {
  const width = 100
  const height = 34
  const max = Math.max(1, ...trend.map((point) => point.answered))
  const slot = width / Math.max(1, trend.length)

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  svg.setAttribute('class', 'trend')
  svg.setAttribute('preserveAspectRatio', 'none')
  svg.setAttribute('role', 'img')
  svg.setAttribute(
    'aria-label',
    `Items answered per day over the last ${trend.length} days, with accuracy shown by colour`,
  )

  trend.forEach((point, index) => {
    const barHeight = (point.answered / max) * (height - 4)
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    rect.setAttribute('x', String(index * slot + slot * 0.15))
    rect.setAttribute('y', String(height - barHeight))
    rect.setAttribute('width', String(slot * 0.7))
    rect.setAttribute('height', String(Math.max(point.answered > 0 ? 0.8 : 0, barHeight)))
    const accuracy = point.accuracy
    rect.setAttribute(
      'class',
      accuracy === null ? 'trend-bar none' : accuracy >= 0.85 ? 'trend-bar good' : accuracy >= 0.7 ? 'trend-bar ok' : 'trend-bar bad',
    )
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title')
    title.textContent = `${point.date}: ${point.answered} answered, ${formatPercent(point.accuracy)}`
    rect.append(title)
    svg.append(rect)
  })

  const first = trend[0]
  const last = trend[trend.length - 1]
  return el('div', { class: 'trend-wrap' }, [
    svg,
    el('div', { class: 'trend-axis' }, [
      el('span', {}, [first ? formatDate(first.date) : '']),
      el('span', {}, [last ? formatDate(last.date) : '']),
    ]),
  ])
}

function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`)
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-AU', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}
