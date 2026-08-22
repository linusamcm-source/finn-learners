/**
 * The bits of UI every screen shares: the top bar and the bottom tab bar.
 *
 * A bottom tab bar rather than links in a header, because this is used one
 * handed on a phone and the thumb lives at the bottom of the screen.
 */
import { el } from '../dom.ts'
import { soundEnabled, toggleSound } from '../sound.ts'

export type Route = '#/' | '#/test' | '#/progress' | '#/parent'

interface TopBarOptions {
  /** Rendered on the right of the bar — the streak while practising. */
  trailing?: HTMLElement | null
  showSound?: boolean
}

export function topBar({ trailing, showSound = true }: TopBarOptions = {}): HTMLElement {
  const soundButton = el(
    'button',
    {
      class: 'icon-button',
      type: 'button',
      'aria-label': soundEnabled() ? 'Turn sound off' : 'Turn sound on',
      title: 'Sound',
    },
    [soundEnabled() ? '🔊' : '🔇'],
  )
  soundButton.addEventListener('click', () => {
    const on = toggleSound()
    soundButton.textContent = on ? '🔊' : '🔇'
    soundButton.setAttribute('aria-label', on ? 'Turn sound off' : 'Turn sound on')
  })

  return el('header', { class: 'topbar' }, [
    el('div', { class: 'brand' }, [el('span', { class: 'brand-mark' }, ['L']), 'learner-dash']),
    el('div', { class: 'topbar-spacer' }),
    trailing ?? null,
    showSound ? soundButton : null,
  ])
}

const TABS: Array<{ route: Route; glyph: string; label: string }> = [
  { route: '#/', glyph: '🚗', label: 'Practice' },
  { route: '#/test', glyph: '📝', label: 'Test' },
  { route: '#/progress', glyph: '📈', label: 'Progress' },
]

export function tabBar(active: Route): HTMLElement {
  return el(
    'nav',
    { class: 'tabbar' },
    TABS.map((tab) =>
      el(
        'a',
        {
          class: `tab${tab.route === active ? ' active' : ''}`,
          href: tab.route,
          'aria-current': tab.route === active ? 'page' : undefined,
        },
        [el('span', { class: 'tab-glyph' }, [tab.glyph]), tab.label],
      ),
    ),
  )
}
