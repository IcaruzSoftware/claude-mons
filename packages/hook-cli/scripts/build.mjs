// Cross-compiles the hook binary. Usage:
//   node scripts/build.mjs           -> all targets into dist/<os>-<arch>/
//   node scripts/build.mjs --host    -> only the current platform
//   node scripts/build.mjs --test    -> go test ./...
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));

const TARGETS = [
  { os: 'windows', arch: 'amd64', dir: 'win-x64', bin: 'claude-mons-hook.exe' },
  { os: 'linux', arch: 'amd64', dir: 'linux-x64', bin: 'claude-mons-hook' },
  { os: 'linux', arch: 'arm64', dir: 'linux-arm64', bin: 'claude-mons-hook' },
];

function findGo() {
  const candidates = ['go'];
  if (process.platform === 'win32') {
    candidates.push('C:\\Program Files\\Go\\bin\\go.exe');
    if (process.env.LOCALAPPDATA) {
      candidates.push(join(process.env.LOCALAPPDATA, 'Programs', 'Go', 'bin', 'go.exe'));
    }
  } else {
    candidates.push('/usr/local/go/bin/go', '/usr/bin/go');
  }
  for (const c of candidates) {
    const r = spawnSync(c, ['version'], { encoding: 'utf8' });
    if (r.status === 0) return c;
  }
  return null;
}

const go = findGo();
if (!go) {
  console.error('hook-cli: Go toolchain not found (install Go 1.22+). Skipping.');
  process.exit(args.has('--test') ? 1 : 0);
}

function run(cmd, cmdArgs, env = {}) {
  const r = spawnSync(cmd, cmdArgs, {
    cwd: pkgDir,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (args.has('--test')) {
  run(go, ['test', './...']);
  process.exit(0);
}

const hostOnly = args.has('--host');
const hostOs = process.platform === 'win32' ? 'windows' : process.platform;
const hostArch = process.arch === 'x64' ? 'amd64' : process.arch;

for (const t of TARGETS) {
  if (hostOnly && (t.os !== hostOs || t.arch !== hostArch)) continue;
  const outDir = join(pkgDir, 'dist', t.dir);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  console.info(`hook-cli: building ${t.os}/${t.arch}`);
  run(go, ['build', '-trimpath', '-ldflags', '-s -w', '-o', join(outDir, t.bin), '.'], {
    GOOS: t.os,
    GOARCH: t.arch,
    CGO_ENABLED: '0',
  });
}
console.info('hook-cli: done');
