import { resolve } from 'node:path';
import preact from '@preact/preset-vite';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
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
