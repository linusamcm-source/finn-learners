/**
 * Post-build step: teach the service worker which files this build produced.
 *
 * Vite emits content-hashed asset names, so `public/sw.js` cannot list them.
 * Without that list the worker precaches the HTML but not the bundle, and a
 * cold offline start renders an empty page — the shell loads and then fetches
 * an app bundle that was never cached.
 *
 * Run automatically by `just build`.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const swPath = join(dist, 'sw.js')

if (!existsSync(swPath)) {
  console.error('dist/sw.js not found — run `vite build` first.')
  process.exit(1)
}

const assets = readdirSync(join(dist, 'assets'))
  .filter((name) => name.endsWith('.js') || name.endsWith('.css'))
  .map((name) => `/assets/${name}`)
  .sort()

// A build id derived from the asset names: it changes exactly when the build
// output changes, which is precisely when the old cache should be dropped.
const buildId = createHash('sha256').update(assets.join('\n')).digest('hex').slice(0, 12)

const source = readFileSync(swPath, 'utf8')
const patched = source
  .replace(/^const BUILD_ID = '.*'$/m, `const BUILD_ID = '${buildId}'`)
  .replace(/^const BUILD_ASSETS = \[\]$/m, `const BUILD_ASSETS = ${JSON.stringify(assets)}`)

if (patched === source) {
  console.error('could not find the BUILD_ID / BUILD_ASSETS placeholders in dist/sw.js')
  process.exit(1)
}

writeFileSync(swPath, patched, 'utf8')
console.log(`[sw] build ${buildId}, precaching ${assets.length} asset(s): ${assets.join(', ')}`)
