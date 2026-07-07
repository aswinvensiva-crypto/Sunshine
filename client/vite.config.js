import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server runs on http://localhost:5173 and forwards any request that
// starts with /api to the backend on http://localhost:5000. That means the
// React code can just call fetch('/api/...') with no CORS headaches.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api':     { target: 'http://localhost:5001', changeOrigin: true },
      '/uploads': { target: 'http://localhost:5001', changeOrigin: true },
    },
    historyApiFallback: true,
  },
});
