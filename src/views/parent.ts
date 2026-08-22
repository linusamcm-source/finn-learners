/**
 * Phase 5 — the parent summary.
 *
 * Read-only. Four things a parent actually wants: how much practice happened
 * this week, how much all up, which topics are weak, and whether it is
 * trending anywhere.
 */
import { clear, el, formatPercent } from '../dom.ts'
import { tabBar, topBar } from './chrome.ts'
import { loadContent } from '../content/load.ts'
import { summarise } from '../store/derive.ts'
import {
  allAnswers,
  allSessions,
  exportProgress,
  importProgress,
  isPersisted,
  requestPersistentStorage,
  resetProgress,
} from '../store/idb.ts'
import type { ParentSummary, TopicStat, TrendPoint } from '../../shared/types.ts'

export class ParentView {
  private readonly root: HTMLElement

  constructor(root: HTMLElement) {
    this.root = root
  }

  async start(): Promise<void> {
    clear(this.root)
    this.root.append(
      topBar({ showSound: false }),
      el('main', { class: 'screen', id: 'stage' }, [el('p', { class: 'muted' }, ['Loading…'])]),
      tabBar('#/progress'),
    )

    const stage = this.root.querySelector('#stage') as HTMLElement
    try {
      const [content, sessions, answers, persisted] = await Promise.all([
        loadContent(),
        allSessions(),
        allAnswers(),
        isPersisted(),
      ])
      const summary = summarise(sessions, answers, {
        questions: content.questions.length,
        scenarios: content.scenarios.length,
        unverified: content.unverified,
      })
      clear(stage)
      stage.append(...this.render(summary), this.dataCard(persisted))
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

  /**
   * Progress lives only on this device, so the parent view owns backing it up.
   *
   * Two reasons this matters more than it would with a server: iOS evicts data
   * belonging to web apps that go unused for a stretch, and a parent otherwise
   * has to pick up the learner's phone to see any of this.
   */
  private dataCard(persisted: boolean): HTMLElement {
    const status = el('p', { class: 'muted' }, [])

    const card = el('section', { class: 'card' }, [
      el('h2', {}, ['This device holds the only copy']),
      el('p', { class: 'muted' }, [
        persisted
          ? 'The browser has been asked to keep this data and agreed. It is still worth exporting a copy now and then.'
          : 'The browser has not guaranteed to keep this data, and iOS clears web app storage that goes unused for a while. Export a copy to be safe.',
      ]),
      el('div', { class: 'row' }, [
        el('button', { class: 'secondary', onclick: () => void this.doExport(status) }, [
          'Export progress',
        ]),
        el('button', { class: 'secondary', onclick: () => void this.doImport(status) }, [
          'Import a file',
        ]),
        el('button', { class: 'secondary danger', onclick: () => void this.doReset(status) }, [
          'Erase all progress',
        ]),
      ]),
      status,
    ])
    return card
  }

  private async doExport(status: HTMLElement): Promise<void> {
    try {
      const data = await exportProgress()
      const stamp = data.exportedAt.slice(0, 10)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const file = `learner-dash-progress-${stamp}.json`

      // On iOS the share sheet is how a file actually leaves the phone; a
      // download link often just opens the JSON in a tab.
      const shareable = typeof File !== 'undefined' ? new File([blob], file, { type: 'application/json' }) : null
      if (shareable && navigator.canShare?.({ files: [shareable] })) {
        await navigator.share({ files: [shareable], title: 'learner-dash progress' })
        status.textContent = `Shared ${data.answers.length} answers.`
        return
      }

      const url = URL.createObjectURL(blob)
      const link = el('a', { href: url, download: file })
      link.click()
      URL.revokeObjectURL(url)
      status.textContent = `Exported ${data.answers.length} answers across ${data.sessions.length} sessions.`
    } catch (err) {
      status.textContent = `Export failed: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  private async doImport(status: HTMLElement): Promise<void> {
    const input = el('input', { type: 'file', accept: 'application/json,.json' })
    input.addEventListener('change', () => {
      void (async () => {
        const file = input.files?.[0]
        if (!file) return
        try {
          const result = await importProgress(JSON.parse(await file.text()))
          status.textContent =
            `Imported ${result.answersAdded} answers` +
            (result.answersSkipped > 0 ? `, skipped ${result.answersSkipped} already present.` : '.')
          await this.start()
        } catch (err) {
          status.textContent = `Import failed: ${err instanceof Error ? err.message : String(err)}`
        }
      })()
    })
    input.click()
  }

  private async doReset(status: HTMLElement): Promise<void> {
    if (!window.confirm('Erase all recorded sessions and answers on this device? This cannot be undone.')) {
      return
    }
    try {
      await resetProgress()
      void requestPersistentStorage()
      await this.start()
    } catch (err) {
      status.textContent = `Could not erase: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  private render(summary: ParentSummary): HTMLElement[] {
    const cards: HTMLElement[] = [
      el('section', { class: 'card enter' }, [
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
        el('div', { class: 'meters' }, summary.byTopic.map(topicBar)),
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
  const tone =
    topic.accuracy === null ? 'neutral' : percent >= 85 ? 'good' : percent >= 70 ? 'warning' : 'critical'
  return el('div', {}, [
    el('div', { class: 'meter-head' }, [
      el('span', { class: 'meter-name' }, [topic.label]),
      // Always spelled out — the colour is a second channel, not the only one.
      el('span', { class: `meter-level ${tone}` }, [
        topic.answered === 0 ? 'not seen' : `${formatPercent(topic.accuracy)} of ${topic.answered}`,
      ]),
    ]),
    el('div', { class: 'meter-track' }, [
      el('div', { class: `meter-fill ${tone}`, style: `width:${percent}%` }),
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
    rect.setAttribute('class', point.answered === 0 ? 'trend-bar empty' : 'trend-bar')
    void accuracy
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
