/**
 * Read and validate the content files from disk.
 *
 * The browser fetches these over HTTP; scripts and tests read them off the
 * filesystem. Both then hand them to the same validateContent(), so there is
 * one definition of what is servable rather than two that can drift.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateContent, type ContentPack } from '../../src/content/validate.ts'
import type { Question, Scenario } from '../../shared/types.ts'

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function readJson<T>(path: string): T[] {
  if (!existsSync(path)) return []
  return JSON.parse(readFileSync(path, 'utf8')) as T[]
}

export function readContent(root: string = repoRoot): ContentPack {
  return validateContent(
    readJson<Question>(join(root, 'content', 'questions.json')),
    readJson<Scenario>(join(root, 'content', 'scenarios.json')),
  )
}
