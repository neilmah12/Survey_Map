import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The client site on Firebase Hosting: the viewer only, as a normal multi-file build. /s/<id> is rewritten to
// client.html by firebase.json, so assets must be absolute (base '/'). It contains no editor code at all;
// scripts/check-client-bundle.mjs fails the build if any slips in.
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: { input: 'client.html' },
  },
});
