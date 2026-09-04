// After code-signing changes the installer bytes, electron-updater's metadata must be refreshed:
// latest.yml carries the installer's sha512 + size, and the .blockmap (differential updates) is
// derived from the file contents. Usage: node scripts/refresh-latest-yml.mjs <release-dir>
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? 'release');
const ymlPath = join(dir, 'latest.yml');
if (!existsSync(ymlPath)) {
  console.error(`refresh-latest-yml: ${ymlPath} not found`);
  process.exit(1);
}

const installers = readdirSync(dir).filter((f) => f.endsWith('.exe'));
let yml = readFileSync(ymlPath, 'utf8');

for (const name of installers) {
  const file = join(dir, name);
  const bytes = readFileSync(file);
  const sha512 = createHash('sha512').update(bytes).digest('base64');
  const size = statSync(file).size;
  // Replace the sha512/size that follow this file's `url:` line, and the top-level `sha512:` when
  // `path:` names this file.
  yml = yml.replace(
    new RegExp(`(url: ${escape(name)}\\n\\s+sha512: )[^\\n]+(\\n\\s+size: )\\d+`),
    `$1${sha512}$2${size}`,
  );
  if (new RegExp(`^path: ${escape(name)}$`, 'm').test(yml)) {
    yml = yml.replace(/^sha512: .+$/m, `sha512: ${sha512}`);
  }
  regenerateBlockmap(file);
  console.info(`refresh-latest-yml: ${name} sha512 updated (${size} bytes)`);
}
writeFileSync(ymlPath, yml);

function regenerateBlockmap(file) {
  try {
    // app-builder-bin is a dependency of electron-builder, installed in the desktop app package
    const require = createRequire(join(resolve(dir, '..'), 'package.json'));
    const { appBuilderPath } = require('app-builder-bin');
    execFileSync(appBuilderPath, ['blockmap', '--input', file, '--output', `${file}.blockmap`], {
      stdio: 'inherit',
    });
  } catch (err) {
    console.warn(`refresh-latest-yml: could not regenerate blockmap for ${file}: ${err.message}`);
  }
}

function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
