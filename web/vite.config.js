import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// The Node server (src/server) serves /api and /cal. In dev, Vite proxies to it.
// Set CT_API to point elsewhere, e.g. CT_API=http://localhost:8787 npm run dev
const api = process.env.CT_API || 'http://localhost:3000';

export default defineConfig({
  plugins: [preact()],
  server: {
    host: true,
    proxy: { '/api': api, '/cal': api, '/healthz': api },
  },
  build: {
    target: 'es2020',
    cssCodeSplit: false,
    assetsInlineLimit: 0,
  },
});
