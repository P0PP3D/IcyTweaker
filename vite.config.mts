// Renderer build + vitest. ./reference is untrusted third-party code: keep it out of
// the dependency scan, the file watcher, and the test glob.
import { defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: './', // packaged app loads dist/index.html over file://
  plugins: [tailwindcss()],
  optimizeDeps: { entries: ['index.html'] },
  server: { port: 5180, strictPort: true, watch: { ignored: ['**/reference/**'] } },
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    include: ['electron/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['reference/**', 'node_modules/**'],
  },
});
