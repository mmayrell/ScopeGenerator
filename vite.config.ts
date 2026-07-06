import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // The preview harness assigns a free port via PORT when 5173 is taken.
    port: Number(process.env.PORT) || 5173,
    // Dev API calls go same-origin through this proxy (VITE_API_BASE=/api in
    // .env.local) — the Function App's CORS whitelist only carries :5173, so
    // a direct call from any other assigned port would be blocked.
    proxy: {
      '/api': { target: 'https://scopegen-api-apvgm.azurewebsites.net', changeOrigin: true },
    },
  },
})
