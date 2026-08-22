/**
 * Progressive web app registration.
 *
 * Service workers only run in a secure context — HTTPS, or localhost. Over a
 * plain-HTTP LAN address (http://192.168.x.x:8787) the browser refuses to
 * register one, so the app runs fine but without offline caching. That is
 * checked explicitly here rather than letting registration fail silently.
 */

export function isStandalone(): boolean {
  // iOS predates display-mode and exposes navigator.standalone instead.
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return iosStandalone || window.matchMedia('(display-mode: standalone)').matches
}

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return

  // Development runs unhashed modules through Vite's dev server, so a worker
  // caching them would fight hot reload. Offline support is a property of a
  // built app; test it with `just build && just serve`.
  if (!import.meta.env.PROD) return

  if (!window.isSecureContext) {
    console.info(
      '[pwa] not a secure context, so no offline caching. Serve over HTTPS or localhost to enable it.',
    )
    return
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err: unknown) => {
      console.warn('[pwa] service worker registration failed:', err)
    })
  })
}
