/**
 * Content validation, shared by the app and by `just verify-content`.
 *
 * Pure: it takes already-parsed arrays and returns what is safe to serve. The
 * browser fetches the JSON and the verification script reads it off disk, but
 * both judge it by exactly these rules — a question that would mislead a
 * learner should never be servable from one path and rejected by the other.
 *
 * Anything that would teach something wrong (a correctIndex past the end of
 * the options, a duplicate id shadowing another item) is dropped rather than
 * served, and the reason is collected for reporting.
 */
import { isTopic, type FeedItem, type Question, type Scenario } from '../../shared/types.ts'

export interface ContentPack {
  questions: Question[]
  scenarios: Scenario[]
  pool: FeedItem[]
  unverified: number
  problems: string[]
}

export function validateContent(
  questions: readonly Question[],
  scenarios: readonly Scenario[],
): ContentPack {
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
