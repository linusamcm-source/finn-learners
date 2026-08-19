/**
 * Fill the database with plausible practice history so the parent view has
 * something to draw during development.
 *
 *   just seed-demo
 *
 * Development aid only — it writes to the same database the app uses, so run
 * `just reset-db` first if you want it to be the only data there.
 */
import { openDb, startSession, recordAnswer, endSession } from '../server/db.ts'
import { loadContent } from '../server/content.ts'
import type { Topic } from '../shared/types.ts'

const db = openDb()
const content = loadContent()
if (content.pool.length === 0) {
  console.error('no content loaded — nothing to seed')
  process.exit(1)
}

// A learner who is solid on signs and shaky on give way and roundabouts,
// improving slowly over a fortnight.
const SKILL: Partial<Record<Topic, number>> = {
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
/** Deterministic RNG, so the demo data is the same every run. */
function random(): number {
  rngState = (rngState * 1103515245 + 12345) % 2147483648
  return rngState / 2147483648
}

const DAYS = 14
let sessions = 0
let answers = 0

for (let dayOffset = DAYS - 1; dayOffset >= 0; dayOffset--) {
  // Practice on roughly two days in three.
  if (random() > 0.68) continue

  const day = new Date()
  day.setDate(day.getDate() - dayOffset)
  day.setHours(17, Math.floor(random() * 50), 0, 0)

  const session = startSession(db, day)
  sessions += 1

  const itemCount = 8 + Math.floor(random() * 18)
  for (let i = 0; i < itemCount; i++) {
    const item = content.pool[Math.floor(random() * content.pool.length)]!
    const base = SKILL[item.topic] ?? 0.75
    // Improvement over the fortnight, strongest where they started weakest.
    const improvement = ((DAYS - dayOffset) / DAYS) * (1 - base) * 0.5
    const correct = random() < base + improvement

    const at = new Date(day.getTime() + i * 45_000)
    recordAnswer(
      db,
      {
        sessionId: session.id,
        itemId: item.id,
        topic: item.topic,
        correct,
        responseTimeMs: 3_000 + Math.floor(random() * 12_000),
      },
      at,
    )
    answers += 1
  }

  endSession(db, session.id, new Date(day.getTime() + itemCount * 45_000))
}

console.log(`seeded ${sessions} sessions and ${answers} answers across the last ${DAYS} days`)
