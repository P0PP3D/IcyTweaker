// Main process + preload, bundled to CommonJS for Electron.
// The preload imports nothing but `electron` and types, so it builds without shared chunks
// (a sandboxed preload cannot require sibling files).
import { defineConfig } from 'vite';
import { builtinModules } from 'node:module';

export default defineConfig({
  build: {
    outDir: 'dist-electron',
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    target: 'node22',
    lib: {
      entry: { main: 'electron/main.ts', preload: 'electron/preload.ts' },
      formats: ['cjs'],
      fileName: (_format, name) => `${name}.js`,
    },
    rolldownOptions: {
      // electron-updater stays a real dependency (packed by electron-builder), not bundled.
      external: ['electron', 'electron-updater', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
    },
  },
});
