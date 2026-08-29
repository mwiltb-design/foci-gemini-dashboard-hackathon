import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const port = Number(process.env.PORT ?? 5173)
const backendPort = process.env.VITE_BACKEND_PORT ?? process.env.BACKEND_PORT ?? '4317'
const backend = `http://127.0.0.1:${backendPort}`

const customHosts = (process.env.DASHBOARD_ALLOWED_HOSTS ?? '')
  .split(',')
  .map((host) => host.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/:.*$/, ''))
  .filter(Boolean)

const allowedHosts = [...new Set(['localhost', '127.0.0.1', ...customHosts, '.ts.net'])]

const proxy = {
  '/api': backend,
  '/plugin-assets': backend,
  '/ws': { target: backend, ws: true },
}

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['@xterm/xterm'],
  },
  esbuild: {
    keepNames: true,
    minifyIdentifiers: false,
  },
  server: {
    port,
    allowedHosts,
    proxy,
  },
  preview: {
    port,
    allowedHosts,
    proxy,
  },
})
