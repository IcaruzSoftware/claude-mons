import { defineProject } from 'vitest/config';

export default defineProject({
  // Renderer (.tsx) component tests are transformed with Preact's automatic JSX runtime; a test
  // opts into a DOM via a per-file `// @vitest-environment happy-dom` pragma.
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  test: {
    name: 'desktop',
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
});
