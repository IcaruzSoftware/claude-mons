// Copies packages/shared/src into supabase/functions/_shared/game so the Supabase CLI
// (which only bundles files under supabase/functions) can deploy Edge Functions that
// import the shared game logic. The target directory is gitignored; run before deploy/check.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'packages/shared/src');
const dest = resolve(root, 'supabase/functions/_shared/game');

if (!existsSync(src)) {
  console.error(`sync-shared: source not found: ${src}`);
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
mkdirSync(dirname(dest), { recursive: true });
cpSync(src, dest, { recursive: true });
console.info(`sync-shared: copied ${src} -> ${dest}`);
