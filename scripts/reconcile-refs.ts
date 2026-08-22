/**
 * Fill in ruleRef page numbers from an ingested handbook.
 *
 *   just reconcile-refs
 *
 * For each question whose ruleRef has no page, this finds the handbook
 * chapter it names and picks the section whose text best matches the
 * question, then writes that section's page number back.
 *
 * Matching is deliberately conservative: a page is only written when one
 * section clearly beats the rest. Anything ambiguous is left null for a human,
 * because a confidently wrong page reference is worse than no reference.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Handbook, HandbookSection, Question } from '../shared/types.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const handbookPath = join(root, 'content', 'handbook.json')
const questionsPath = join(root, 'content', 'questions.json')

if (!existsSync(handbookPath)) {
  console.error('content/handbook.json not found — run `just ingest` first.')
  process.exit(1)
}

const handbook = JSON.parse(readFileSync(handbookPath, 'utf8')) as Handbook
const questions = JSON.parse(readFileSync(questionsPath, 'utf8')) as Question[]

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'at', 'is', 'are', 'you', 'your',
  'must', 'may', 'not', 'be', 'it', 'that', 'this', 'with', 'for', 'from', 'as', 'if',
  'what', 'when', 'where', 'who', 'which', 'how', 'do', 'does', 'should', 'can', 'will',
])

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word)),
  )
}

/** Proportion of the question's distinctive words that appear in the section. */
function score(question: Set<string>, section: HandbookSection): number {
  if (question.size === 0) return 0
  const haystack = tokens(`${section.title} ${section.body}`)
  let hits = 0
  for (const word of question) if (haystack.has(word)) hits += 1
  return hits / question.size
}

const MIN_SCORE = 0.25 // below this the match is noise
const MIN_MARGIN = 1.4 // the winner must beat the runner-up by this factor

let filled = 0
let ambiguous = 0
let noChapter = 0
let alreadySet = 0

for (const question of questions) {
  if (question.ruleRef.page !== null) {
    alreadySet += 1
    continue
  }

  const chapter = handbook.chapters.find(
    (c) => c.title.toLowerCase() === question.ruleRef.chapter.toLowerCase(),
  )
  if (!chapter) {
    noChapter += 1
    continue
  }

  const needle = tokens(`${question.text} ${question.explanation}`)
  const ranked = chapter.sections
    .map((section) => ({ section, value: score(needle, section) }))
    .sort((a, b) => b.value - a.value)

  const best = ranked[0]
  const runnerUp = ranked[1]
  if (!best || best.value < MIN_SCORE) {
    ambiguous += 1
    continue
  }
  if (runnerUp && runnerUp.value > 0 && best.value < runnerUp.value * MIN_MARGIN) {
    ambiguous += 1
    continue
  }

  question.ruleRef.page = best.section.pageRef
  filled += 1
}

writeFileSync(questionsPath, `${JSON.stringify(questions, null, 2)}\n`, 'utf8')

console.log(`filled:      ${filled}`)
console.log(`already set: ${alreadySet}`)
console.log(`ambiguous:   ${ambiguous} (left null — match one by hand)`)
console.log(`no chapter:  ${noChapter} (chapter name does not match the handbook)`)
