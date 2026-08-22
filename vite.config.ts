import { defineConfig } from 'vite'

/**
 * The app is entirely static: content is fetched as JSON and progress lives in
 * the browser's IndexedDB, so there is no server to proxy to. `content/` and
 * `assets/` sit outside `public/` because they are also read by the Python
 * ingestion pipeline and the verification scripts, so they are published as
 * extra static roots rather than copied.
 */
export default defineConfig({
  server: {
    port: 5173,
    fs: { allow: ['..'] },
  },
  preview: { port: 4173 },
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
