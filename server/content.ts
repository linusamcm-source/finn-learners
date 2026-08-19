import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { repoRoot } from './db.ts'
import { isTopic, type FeedItem, type Question, type Scenario } from '../shared/types.ts'

export interface ContentPack {
  questions: Question[]
  scenarios: Scenario[]
  pool: FeedItem[]
  unverified: number
  problems: string[]
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

/**
 * Load and validate the question bank and scenario set.
 *
 * Validation is deliberately strict about anything that would mislead the
 * learner — a correctIndex pointing past the end of the options, a duplicate
 * id shadowing another item — and those items are dropped rather than served.
 * Problems are collected so `just verify-content` can report them.
 */
export function loadContent(root: string = repoRoot): ContentPack {
  const questions = readJson<Question[]>(join(root, 'content', 'questions.json'), [])
  const scenarios = readJson<Scenario[]>(join(root, 'content', 'scenarios.json'), [])
  const problems: string[] = []
  const seen = new Set<string>()

  const validQuestions = questions.filter((q) => {
    if (!q.id) return problems.push('question with no id'), false
    if (seen.has(q.id)) return problems.push(`duplicate id: ${q.id}`), false
    if (!isTopic(q.topic)) return problems.push(`${q.id}: unknown topic ${q.topic}`), false
    if (!Array.isArray(q.options) || q.options.length < 2) {
      return problems.push(`${q.id}: needs at least two options`), false
    }
    if (new Set(q.options).size !== q.options.length) {
      return problems.push(`${q.id}: duplicate options`), false
    }
    if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= q.options.length) {
      return problems.push(`${q.id}: correctIndex ${q.correctIndex} out of range`), false
    }
    if (!q.explanation?.trim()) return problems.push(`${q.id}: missing explanation`), false
    seen.add(q.id)
    return true
  })

  const validScenarios = scenarios.filter((s) => {
    if (!s.id) return problems.push('scenario with no id'), false
    if (seen.has(s.id)) return problems.push(`duplicate id: ${s.id}`), false
    if (!isTopic(s.topic)) return problems.push(`${s.id}: unknown topic ${s.topic}`), false
    if (!s.ego?.path?.length) return problems.push(`${s.id}: ego has no path`), false
    if (s.assessment.kind === 'rules-question') {
      const a = s.assessment
      if (a.correctIndex < 0 || a.correctIndex >= a.options.length) {
        return problems.push(`${s.id}: correctIndex out of range`), false
      }
    } else {
      const a = s.assessment
      if (!a.hazardActorId && !a.hazardArea) {
        return problems.push(`${s.id}: hazard assessment names no hazard`), false
      }
      if (a.hazardActorId && !s.actors.some((actor) => actor.id === a.hazardActorId)) {
        return problems.push(`${s.id}: hazard actor ${a.hazardActorId} not in actors`), false
      }
      if (a.responseWindowMs.endMs <= a.responseWindowMs.startMs) {
        return problems.push(`${s.id}: empty response window`), false
      }
    }
    seen.add(s.id)
    return true
  })

  const pool: FeedItem[] = [
    ...validQuestions.map((q): FeedItem => ({ kind: 'question', id: q.id, topic: q.topic, question: q })),
    ...validScenarios.map((s): FeedItem => ({ kind: 'scenario', id: s.id, topic: s.topic, scenario: s })),
  ]

  const unverified =
    validQuestions.filter((q) => !q.verified).length +
    validScenarios.filter((s) => !s.verified).length

  return { questions: validQuestions, scenarios: validScenarios, pool, unverified, problems }
}
