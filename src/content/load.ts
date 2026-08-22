/**
 * Fetch the content the app serves.
 *
 * These files are precached by the service worker, so after the first visit
 * this resolves with no network at all — which is what lets practice work on
 * a phone with no signal.
 */
import type { Question, Scenario } from '../../shared/types.ts'
import { validateContent, type ContentPack } from './validate.ts'

let cached: Promise<ContentPack> | null = null

async function fetchJson<T>(path: string): Promise<T[]> {
  const response = await fetch(path)
  if (!response.ok) throw new Error(`${path}: ${response.status} ${response.statusText}`)
  return (await response.json()) as T[]
}

export function loadContent(): Promise<ContentPack> {
  cached ??= (async () => {
    const [questions, scenarios] = await Promise.all([
      fetchJson<Question>('/content/questions.json'),
      fetchJson<Scenario>('/content/scenarios.json'),
    ])
    const pack = validateContent(questions, scenarios)
    if (pack.problems.length > 0) {
      console.warn(`[content] ${pack.problems.length} item(s) rejected:`, pack.problems)
    }
    return pack
  })()
  return cached
}
