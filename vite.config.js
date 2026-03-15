import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const frontendPort = process.env.FRONTEND_PORT || 28361
const backendPort = process.env.PORT || 28360

export default defineConfig({
  plugins: [react()],
  server: {
    port: frontendPort,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true
      }
    }
  }
})