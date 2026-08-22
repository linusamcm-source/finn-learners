/**
 * Hash router. Four screens, so a router library would outweigh the router.
 */
import { FeedView } from './views/feed.ts'
import { TestView } from './views/test.ts'
import { ProgressView } from './views/progress.ts'
import { ParentView } from './views/parent.ts'
import { registerServiceWorker } from './pwa.ts'

const rootNode = document.querySelector<HTMLElement>('#app')
if (!rootNode) throw new Error('#app not found')
const root: HTMLElement = rootNode

interface View {
  start(): Promise<void>
  stop(): void
}

let current: View | null = null

function viewFor(hash: string): View {
  switch (hash) {
    case '#/test':
      return new TestView(root)
    case '#/progress':
      return new ProgressView(root)
    case '#/parent':
      return new ParentView(root)
    default:
      return new FeedView(root)
  }
}

async function route(): Promise<void> {
  current?.stop()
  const view = viewFor(window.location.hash)
  current = view
  window.scrollTo(0, 0)
  await view.start()
}

window.addEventListener('hashchange', () => void route())
void route()
registerServiceWorker()
