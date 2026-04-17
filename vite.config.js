import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const frontendPort = process.env.FRONTEND_PORT || 28361
const backendPort = process.env.PORT || 28360

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: frontendPort,
    host: '0.0.0.0',
    allowedHosts: ['ai.pixel-space.co'],
    proxy: {
      '/api': {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
        ws: true,
        // Disable buffering so Server-Sent Events (progress stream) reach the client immediately.
        selfHandleResponse: false,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            if ((proxyRes.headers['content-type'] || '').includes('text/event-stream')) {
              proxyRes.headers['cache-control'] = 'no-cache, no-transform'
              proxyRes.headers['x-accel-buffering'] = 'no'
            }
          })
        }
      }
    }
  }
})