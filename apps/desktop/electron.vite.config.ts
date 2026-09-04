import { resolve } from 'node:path';
import preact from '@preact/preset-vite';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    // Bundle the workspace packages into main so the build is self-contained (they are TS source).
    plugins: [externalizeDepsPlugin({ exclude: ['@claude-mons/shared', '@claude-mons/sprites'] })],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@claude-mons/shared'] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
        // Sandboxed renderers only accept CommonJS preload scripts.
        output: { format: 'cjs', entryFileNames: '[name].js' },
      },
    },
  },
  renderer: {
    plugins: [preact()],
    build: {
      rollupOptions: {
        input: {
          pet: resolve(__dirname, 'src/renderer/pet/index.html'),
          panel: resolve(__dirname, 'src/renderer/panel/index.html'),
          hovercard: resolve(__dirname, 'src/renderer/hovercard/index.html'),
        },
      },
    },
  },
});
