import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { app } from 'electron';

const BIN_NAME = process.platform === 'win32' ? 'claude-mons-hook.exe' : 'claude-mons-hook';

function platformDir(): string {
  const arch = process.arch === 'x64' ? 'x64' : process.arch;
  return `${process.platform}-${arch}`;
}

/** Where the packaged app ships the binary (electron-builder extraResources) or, in dev, the Go build output. */
export function bundledHookBinary(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'bin', BIN_NAME);
  // apps/desktop/out/main -> repo root
  return resolve(__dirname, '../../../../packages/hook-cli/dist', platformDir(), BIN_NAME);
}

/** Stable location the hooks point at; survives app updates and AppImage remounts. */
export function installedHookBinary(home: string): string {
  return join(home, 'bin', BIN_NAME);
}

async function sha256(path: string): Promise<string | null> {
  try {
    return createHash('sha256')
      .update(await fs.readFile(path))
      .digest('hex');
  } catch {
    return null;
  }
}

/**
 * Copies the bundled hook binary into userData/bin if missing or different.
 * Returns the installed path, or null when no binary is available (dev without a Go build).
 */
export async function ensureHookBinary(home: string): Promise<string | null> {
  const src = bundledHookBinary();
  const dest = installedHookBinary(home);
  const srcHash = await sha256(src);
  if (!srcHash) {
    // Nothing bundled; if an older copy exists keep using it.
    return (await sha256(dest)) ? dest : null;
  }
  if ((await sha256(dest)) === srcHash) return dest;
  await fs.mkdir(join(home, 'bin'), { recursive: true });
  const tmp = `${dest}.tmp`;
  await fs.copyFile(src, tmp);
  await fs.chmod(tmp, 0o755).catch(() => {});
  try {
    await fs.rename(tmp, dest);
  } catch {
    // Windows: the old binary may be running right now; retry shortly, otherwise keep the old one.
    await new Promise((r) => setTimeout(r, 500));
    await fs.rename(tmp, dest).catch(async () => fs.rm(tmp, { force: true }));
  }
  return dest;
}
