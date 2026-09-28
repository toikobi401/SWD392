import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Matches FRONTEND_URL in the server's .env — payOS redirects the guest
    // back here after checkout, so the two must agree.
    port: 3001,
    strictPort: true,
    // The dev server proxies /api so the browser sees one origin and no CORS
    // preflight is needed during development.
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } },
  },
});
