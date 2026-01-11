import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,         // listen on 0.0.0.0 (so other containers can reach it)
    port: 5173,
    strictPort: true,
    allowedHosts: [
      'frontend',
      '93.127.199.118.sslip.io',
      '93.127.199.118',
      'localhost',
    ],
    hmr: {
      clientPort: 8088,
      host: '93.127.199.118.sslip.io',
      protocol: 'ws',
    },
    proxy: {
      '/api': {
        target: process.env.VITE_API_BACKEND || 'http://backend:5000',
        changeOrigin: true,
      },
    },
  },
})
