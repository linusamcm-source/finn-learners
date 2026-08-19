/**
 * Hash router. Two screens, so a router library would outweigh the router.
 */
import { FeedView } from './views/feed.ts'
import { ParentView } from './views/parent.ts'

const rootNode = document.querySelector<HTMLElement>('#app')
if (!rootNode) throw new Error('#app not found')
const root: HTMLElement = rootNode

interface View {
  start(): Promise<void>
  stop(): void
}

let current: View | null = null

async function route(): Promise<void> {
  current?.stop()
  const view: View = window.location.hash === '#/parent' ? new ParentView(root) : new FeedView(root)
  current = view
  await view.start()
}

window.addEventListener('hashchange', () => void route())
void route()
