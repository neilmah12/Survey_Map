import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

// The client viewer as one self-contained HTML file with an empty snapshot slot. The editor embeds this
// file's text as its export template. It imports no editing, Excel or storage code.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: [
      { find: /^(.*)\/workerUrl$/, replacement: fileURLToPath(new URL('./src/lib/workerUrl.single.ts', import.meta.url)) },
    ],
  },
  build: {
    outDir: 'dist-client',
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 10_000,
    rollupOptions: { input: 'client.html' },
  },
});
