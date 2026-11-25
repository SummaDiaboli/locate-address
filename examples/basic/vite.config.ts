import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL('../../dist/demo', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    fs: { allow: [workspaceRoot] },
  },
});
