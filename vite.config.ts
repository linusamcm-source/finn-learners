import { defineConfig } from 'vite'

// The Node API server owns /api, /content and /assets; Vite proxies them in dev
// so the SPA sees the same URL shape in dev and in a built run.
const API = 'http://localhost:8787'

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': API,
      '/content': API,
      '/assets': API,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
