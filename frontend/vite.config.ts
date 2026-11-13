import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Проксируем /graphql на gateway, чтобы фронт и API были на одном адресе и не нужен был CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/graphql': 'http://localhost:4000' },
  },
});
