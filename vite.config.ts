import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // GitHub Pages serves the site from /<repo-name>/; the deploy workflow sets VITE_BASE.
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8001',
    },
  },
})
