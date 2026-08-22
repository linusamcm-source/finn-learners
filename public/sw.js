/**
 * Service worker for learner-dash.
 *
 * Scope of what this does and does not do:
 *
 *   - It caches the app shell and the content files, so the app opens and can
 *     serve questions with no network. That is what makes it usable on a phone
 *     in a car park with one bar of signal.
 *   - It never caches /api. Session and answer data must be live: a cached
 *     answer response would silently lose a learner's progress, and a cached
 *     summary would show a parent stale numbers. API requests offline fail,
 *     and the app surfaces that rather than pretending.
 *
 * A service worker only runs in a secure context: HTTPS, or localhost. Over a
 * plain-HTTP LAN address iOS will not register it, so the app still works but
 * without offline caching. See the PWA section of the README.
 *
 * Bump CACHE whenever the shell changes, so old entries are dropped.
 */

/*
 * BUILD_ID and BUILD_ASSETS are rewritten by scripts/inject-sw-assets.ts after
 * `vite build`. The asset filenames are content-hashed, so they cannot be
 * written here by hand — and without them a cold offline start fetches an
 * app bundle that was never cached, and renders nothing. BUILD_ID changes
 * whenever the assets do, which is what evicts the previous cache.
 */
const BUILD_ID = 'dev'
const BUILD_ASSETS = []

const CACHE = `learner-dash-${BUILD_ID}`

/** Cached on install so a cold, offline start still works. */
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/content/questions.json',
  '/content/scenarios.json',
  ...BUILD_ASSETS,
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // addAll rejects the whole batch if any single request fails, and a
      // missing optional file should not block installation.
      await Promise.all(
        SHELL.map((url) => cache.add(url).catch(() => undefined)),
      )
      await self.skipWaiting()
    }),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)))
      await self.clients.claim()
    })(),
  )
})

/** Network first, falling back to whatever was cached. */
async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE)
  try {
    const response = await fetch(request)
    if (response.ok) cache.put(request, response.clone())
    return response
  } catch {
    const cached = await cache.match(request)
    if (cached) return cached
    if (fallbackUrl) {
      const fallback = await cache.match(fallbackUrl)
      if (fallback) return fallback
    }
    throw new Error('offline and nothing cached')
  }
}

/** Serve from cache immediately, refresh in the background for next time. */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(request)
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone())
      return response
    })
    .catch(() => undefined)
  return cached ?? (await network) ?? Promise.reject(new Error('offline'))
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Never cache the API. Stale progress data is worse than an honest failure.
  if (url.pathname.startsWith('/api/')) return

  // Navigations: try the network so a redeploy is picked up, fall back to the
  // cached shell so the app opens offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      networkFirst(request, '/index.html').catch(
        () =>
          new Response('learner-dash is offline and has nothing cached yet.', {
            status: 503,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
          }),
      ),
    )
    return
  }

  // Content and handbook diagrams change rarely and are large-ish.
  if (url.pathname.startsWith('/content/') || url.pathname.startsWith('/assets/handbook/')) {
    event.respondWith(staleWhileRevalidate(request))
    return
  }

  // Vite emits content-hashed filenames, so these are safe to serve from cache
  // forever — a new build produces a new URL.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(request)
        if (cached) return cached
        const response = await fetch(request)
        if (response.ok) cache.put(request, response.clone())
        return response
      }),
    )
    return
  }

  event.respondWith(staleWhileRevalidate(request).catch(() => fetch(request)))
})
