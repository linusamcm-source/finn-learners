/**
 * Write a demo progress file that can be imported into the app.
 *
 *   just seed-demo        →  demo-progress.json
 *
 * Progress now lives in the browser's IndexedDB, which a Node script cannot
 * write to. So instead of seeding a database this emits a file in the app's
 * own export format: open the parent view, choose "Import a file", and pick
 * it. Development aid only.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readContent, repoRoot } from './lib/read-content.ts'
import type { StoredAnswer, StoredSession } from '../src/store/derive.ts'
import type { Topic } from '../shared/types.ts'

const content = readContent()
if (content.pool.length === 0) {
  console.error('no content loaded — nothing to seed')
  process.exit(1)
}

// A learner who is solid on signs and shaky on give way and roundabouts,
// improving slowly over a fortnight.
const SKILL: Record<Topic, number> = {
  'road-signs': 0.92,
  'speed-limits': 0.86,
  'alcohol-drugs-fatigue': 0.9,
  'learner-p-plater': 0.84,
  'line-markings': 0.78,
  turns: 0.74,
  'sharing-road': 0.72,
  roundabouts: 0.58,
  'give-way': 0.55,
}

let rngState = 42
/** Deterministic, so the demo file is identical every run. */
function random(): number {
  rngState = (rngState * 1103515245 + 12345) % 2147483648
  return rngState / 2147483648
}

const DAYS = 14
const sessions: StoredSession[] = []
const answers: StoredAnswer[] = []
let nextSessionId = 1

for (let dayOffset = DAYS - 1; dayOffset >= 0; dayOffset--) {
  if (random() > 0.68) continue // practice on roughly two days in three

  const day = new Date()
  day.setDate(day.getDate() - dayOffset)
  day.setHours(17, Math.floor(random() * 50), 0, 0)

  const sessionId = nextSessionId++
  const itemCount = 8 + Math.floor(random() * 18)

  for (let i = 0; i < itemCount; i++) {
    const item = content.pool[Math.floor(random() * content.pool.length)]!
    const base = SKILL[item.topic]
    // Improvement over the fortnight, strongest where they started weakest.
    const improvement = ((DAYS - dayOffset) / DAYS) * (1 - base) * 0.5
    answers.push({
      id: `demo-${sessionId}-${i}`,
      sessionId,
      itemId: item.id,
      topic: item.topic,
      correct: random() < base + improvement,
      responseTimeMs: 3_000 + Math.floor(random() * 12_000),
      answeredAt: new Date(day.getTime() + i * 45_000).toISOString(),
    })
  }

  sessions.push({
    id: sessionId,
    startedAt: day.toISOString(),
    endedAt: new Date(day.getTime() + itemCount * 45_000).toISOString(),
    itemCount,
  })
}

const out = join(repoRoot, 'demo-progress.json')
writeFileSync(
  out,
  `${JSON.stringify(
    { format: 'learner-dash-progress', version: 1, exportedAt: new Date().toISOString(), sessions, answers },
    null,
    2,
  )}\n`,
  'utf8',
)

console.log(`wrote ${out}`)
console.log(`${sessions.length} sessions, ${answers.length} answers across the last ${DAYS} days`)
console.log('Import it from the parent view: "Import a file".')
