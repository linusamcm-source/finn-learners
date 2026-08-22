/**
 * Copy the content files and handbook diagrams into dist/.
 *
 * The spec puts these at content/ and assets/handbook/ in the repo root, and
 * the Python ingestion pipeline and the verification scripts read them from
 * there. Rather than move them under public/ to suit the bundler, the build
 * copies them in, so dist/ is a self-contained static site that can be
 * dropped on any host.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')

if (!existsSync(dist)) {
  console.error('dist/ not found — run `vite build` first.')
  process.exit(1)
}

for (const dir of ['content', 'assets']) {
  const from = join(root, dir)
  if (!existsSync(from)) continue
  mkdirSync(join(dist, dir), { recursive: true })
  cpSync(from, join(dist, dir), { recursive: true })
  console.log(`[static] ${dir}/ -> dist/${dir}/`)
}
