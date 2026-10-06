import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// In dev, serve the client viewer for /s/<id> the way Firebase Hosting does.
const clientRoute = {
  name: 'client-route',
  configureServer(server: { middlewares: { use: (fn: (req: { url?: string }, res: unknown, next: () => void) => void) => void } }) {
    server.middlewares.use((req, _res, next) => {
      if (req.url?.startsWith('/s/')) req.url = '/client.html';
      next();
    });
  },
};

export default defineConfig({
  plugins: [react(), clientRoute],
  build: { chunkSizeWarningLimit: 1500 },
  test: { include: ['tests/**/*.test.ts'] },
});
