/**
 * Content check: schema, ids, answer key balance, and whether every ruleRef
 * resolves against an ingested handbook.
 *
 *   just verify-content
 *
 * Exits non-zero on a real problem (something the app would serve wrongly).
 * Unresolved rule references and unverified items are reported but do not
 * fail the run — they are work for a human, not bugs.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readContent } from './lib/read-content.ts'
import { TOPICS, type Handbook, type RuleRef } from '../shared/types.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const content = readContent(root)

let failed = false
const say = (line = ''): void => console.log(line)

say(`questions:  ${content.questions.length}`)
say(`scenarios:  ${content.scenarios.length}`)
say(`feed pool:  ${content.pool.length}`)
say()

if (content.problems.length > 0) {
  failed = true
  say(`${content.problems.length} item(s) rejected and NOT served:`)
  for (const problem of content.problems) say(`  ✗ ${problem}`)
  say()
}

/* Topic coverage ---------------------------------------------------- */

const byTopic = new Map<string, number>()
for (const item of content.pool) byTopic.set(item.topic, (byTopic.get(item.topic) ?? 0) + 1)

say('coverage by topic:')
for (const topic of TOPICS) {
  const count = byTopic.get(topic) ?? 0
  if (count === 0) {
    failed = true
    say(`  ✗ ${topic.padEnd(24)} 0 — the feed can never serve this topic`)
  } else {
    say(`    ${topic.padEnd(24)} ${count}`)
  }
}
say()

/* Answer key balance ------------------------------------------------ */

const positions = new Map<number, number>()
for (const question of content.questions) {
  positions.set(question.correctIndex, (positions.get(question.correctIndex) ?? 0) + 1)
}
const total = content.questions.length
const spread = [...positions.entries()].sort((a, b) => a[0] - b[0])
say(`answer key spread: ${spread.map(([i, n]) => `${String.fromCharCode(65 + i)}=${n}`).join('  ')}`)
const worst = Math.max(...positions.values())
if (total > 0 && worst / total > 0.4) {
  say(`  ! ${Math.round((worst / total) * 100)}% of answers sit in one position — a learner could guess the pattern`)
}
say()

/* Rule references against the handbook ------------------------------ */

const handbookPath = join(root, 'content', 'handbook.json')
const refs: Array<{ id: string; ref: RuleRef }> = [
  ...content.questions.map((q) => ({ id: q.id, ref: q.ruleRef })),
  ...content.scenarios.flatMap((s) =>
    s.assessment.kind === 'rules-question' ? [{ id: s.id, ref: s.assessment.ruleRef }] : [],
  ),
]

if (!existsSync(handbookPath)) {
  say('handbook: content/handbook.json not found — run `just ingest` to build it.')
  say(`  ${refs.length} rule reference(s) cannot be checked until then.`)
} else {
  const handbook = JSON.parse(readFileSync(handbookPath, 'utf8')) as Handbook
  const chapters = new Map(handbook.chapters.map((c) => [c.title.toLowerCase(), c]))
  let unresolvedChapter = 0
  let missingPage = 0
  let badPage = 0

  for (const { id, ref } of refs) {
    const chapter = chapters.get(ref.chapter.toLowerCase())
    if (!chapter) {
      unresolvedChapter += 1
      say(`  ? ${id}: chapter "${ref.chapter}" not found in the handbook`)
      continue
    }
    if (ref.page === null) {
      missingPage += 1
    } else if (ref.page < chapter.startPage || ref.page > chapter.endPage) {
      badPage += 1
      failed = true
      say(`  ✗ ${id}: page ${ref.page} is outside "${chapter.title}" (p${chapter.startPage}-${chapter.endPage})`)
    }
  }

  say(
    `handbook: ${refs.length - unresolvedChapter - missingPage - badPage}/${refs.length} references resolved` +
      `, ${missingPage} without a page number, ${unresolvedChapter} unknown chapter, ${badPage} out of range`,
  )
  if (missingPage > 0) say('  run `just reconcile-refs` to fill in page numbers where they can be matched')
}
say()

/* Human review ------------------------------------------------------ */

if (content.unverified > 0) {
  say(`${content.unverified} of ${content.pool.length} items are not yet marked verified.`)
  say('Every question and scenario needs a human pass against the handbook before')
  say('this is relied on for test preparation. Set "verified": true as you check them.')
} else {
  say('All items are marked verified.')
}

process.exit(failed ? 1 : 0)
