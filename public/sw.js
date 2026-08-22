/**
 * Service worker for learner-dash.
 *
 * The app has no backend: content is static JSON and progress lives in the
 * browser's IndexedDB. So everything the app fetches is cacheable, and once
 * this worker has installed, the app runs with no network at all — which is
 * the whole point of it being installable on a phone.
 *
 * A service worker only runs in a secure context: HTTPS, or localhost. Over a
 * plain-HTTP LAN address iOS will not register it, so the app still loads but
 * has no offline support. See the PWA section of the README.
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

/**
 * Without every one of these the app cannot start offline, so installation
 * must fail rather than half-succeed: a worker that activates with an
 * incomplete cache deletes the previous one and leaves the app unable to
 * open at all. That is not hypothetical — it is what happens when someone
 * opens the app just as a new version is published and then loses signal.
 */
const CRITICAL = [
  '/',
  '/index.html',
  '/content/questions.json',
  '/content/scenarios.json',
  ...BUILD_ASSETS,
]

/** Nice to have offline, but not worth failing an install over. */
const OPTIONAL = [
  '/manifest.webmanifest',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      // addAll is atomic: if any of these fail the install fails, the old
      // worker stays in charge, and its cache is left alone.
      await cache.addAll(CRITICAL)
      await Promise.all(OPTIONAL.map((url) => cache.add(url).catch(() => undefined)))
      // Only now is it safe to take over from the previous worker.
      await self.skipWaiting()
    })(),
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

/**
 * Cache lookup, ignoring Vary.
 *
 * This matters more than it looks. Static hosts commonly send `Vary: Origin`
 * on assets. The worker's own precache fetch carries no Origin header, but the
 * page's module-script request does — so a strict match misses a file that is
 * definitely cached, and the app fails to start offline with its bundle
 * sitting right there. There is only one origin here and one variant of each
 * file, so ignoring Vary is correct as well as convenient.
 */
function matchCached(cache, request) {
  return cache.match(request, { ignoreVary: true })
}

/** Network first, falling back to whatever was cached. */
async function networkFirst(request, fallbackUrl) {
  const cache = await caches.open(CACHE)
  try {
    const response = await fetch(request)
    if (response.ok) cache.put(request, response.clone())
    return response
  } catch {
    const cached = await matchCached(cache, request)
    if (cached) return cached
    // '/' and '/index.html' are the same page but distinct cache keys, so a
    // miss on one should still find the other.
    for (const url of ['/index.html', '/']) {
      const fallback = await matchCached(cache, url)
      if (fallback) return fallback
    }
    void fallbackUrl
    throw new Error('offline and nothing cached')
  }
}

/** Serve from cache immediately, refresh in the background for next time. */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE)
  const cached = await matchCached(cache, request)
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
        const cached = await matchCached(cache, request)
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
