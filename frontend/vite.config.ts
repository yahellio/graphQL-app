import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// В dev-режиме /graphql проксируется на gateway — фронт и API на одном origin, CORS не нужен.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/graphql': 'http://localhost:4000' },
  },
});
