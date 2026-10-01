import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

// Builds one self-contained HTML file (JS, CSS, logo and map worker inlined) that opens from disk.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: [
      { find: /^(.*)\/workerUrl$/, replacement: fileURLToPath(new URL('./src/lib/workerUrl.single.ts', import.meta.url)) },
    ],
  },
  build: { outDir: 'dist-single', assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 10_000 },
});
