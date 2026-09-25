import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

const BACKUPS_TO_KEEP = 5;

/**
 * Copies `path` to `<path>.claude-mons-backup-<timestamp>` next to it, then prunes older
 * backups so at most `BACKUPS_TO_KEEP` remain. By default a failed copy (e.g. `path` doesn't
 * exist) is a silent no-op; pass `{ required: true }` to instead rethrow, for callers that must
 * not proceed to overwrite the original unless the backup actually succeeded.
 */
export async function backupFile(path: string, opts?: { required?: boolean }): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = `${path}.claude-mons-backup-${stamp}`;
  try {
    await fs.copyFile(path, dest);
  } catch (err) {
    if (opts?.required) throw err;
    return;
  }
  // keep only the newest N backups
  const dir = dirname(path);
  const prefix = `${path.slice(dir.length + 1)}.claude-mons-backup-`;
  const entries = (await fs.readdir(dir)).filter((f) => f.startsWith(prefix)).sort();
  for (const old of entries.slice(0, Math.max(0, entries.length - BACKUPS_TO_KEEP))) {
    await fs.rm(join(dir, old), { force: true }).catch(() => {});
  }
}
