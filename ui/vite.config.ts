import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const port = Number(process.env.PORT ?? 5173)
const backendPort = process.env.VITE_BACKEND_PORT ?? process.env.BACKEND_PORT ?? '4317'
const backend = `http://127.0.0.1:${backendPort}`

const allowedHosts = (process.env.DASHBOARD_ALLOWED_HOSTS ?? 'localhost,127.0.0.1')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean)

const proxy = {
  '/api': backend,
  '/plugin-assets': backend,
  '/ws': { target: backend, ws: true },
}

export default defineConfig({
  plugins: [react()],
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
