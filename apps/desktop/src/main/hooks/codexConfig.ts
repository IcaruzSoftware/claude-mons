import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { backupFile } from './backup.ts';

/** Result of trying to turn `hooks = true` on in a `config.toml` body. Pure. */
export type FeatureEdit =
  | { kind: 'unchanged' }
  | { kind: 'edited'; text: string }
  | { kind: 'unsupported' };

const TABLE_HEADER = /^\s*\[/;
const FEATURES_HEADER = /^\s*\[\s*"?features"?\s*\]\s*(#.*)?$/;
const DOTTED_OR_INLINE_FEATURES = /^\s*features\s*[.=]/;
const HOOKS_LINE = /^\s*hooks\s*=\s*(true|false)\b/;

/**
 * Turns `[features]\nhooks = true` on in a Codex `config.toml` body, editing as little as
 * possible and preserving everything else verbatim. Refuses (`unsupported`) forms it cannot
 * edit safely, such as `features.hooks = ...` or an inline table. Pure; no I/O.
 */
export function enableHooksFeature(toml: string): FeatureEdit {
  const eol = toml.includes('\r\n') ? '\r\n' : '\n';
  const lines = toml.split(/\r\n|\n/);
  // split() on a trailing EOL yields a trailing empty string; drop it so join() doesn't double it.
  const hadTrailingEol = lines.length > 0 && lines[lines.length - 1] === '' && toml.length > 0;
  const body = hadTrailingEol ? lines.slice(0, -1) : lines;

  let headerIndex = -1;
  for (let i = 0; i < body.length; i++) {
    const line = body[i] ?? '';
    if (headerIndex === -1 && FEATURES_HEADER.test(line)) {
      headerIndex = i;
      continue;
    }
    // Only guard against the dotted/inline forms before we've found a real [features] header:
    // once it's found, a later `features.x = ...`/`features = {...}` line would be TOML
    // redefining the same table, which TOML itself disallows, so it's not a case we need to
    // handle here.
    if (headerIndex === -1 && DOTTED_OR_INLINE_FEATURES.test(line)) {
      return { kind: 'unsupported' };
    }
  }

  if (headerIndex === -1) {
    // No [features] table: append one.
    const next = toml === '' ? [`[features]`, `hooks = true`] : [...body, '', `[features]`, `hooks = true`];
    return { kind: 'edited', text: next.join(eol) + eol };
  }

  // Scan the table's body until the next header (or end of file).
  let end = body.length;
  for (let i = headerIndex + 1; i < body.length; i++) {
    if (TABLE_HEADER.test(body[i] ?? '')) {
      end = i;
      break;
    }
  }
  let hooksIndex = -1;
  for (let i = headerIndex + 1; i < end; i++) {
    if (HOOKS_LINE.test(body[i] ?? '')) {
      hooksIndex = i;
      break;
    }
  }

  if (hooksIndex !== -1) {
    const line = body[hooksIndex] ?? '';
    const isTrue = /^\s*hooks\s*=\s*true\b/.test(line);
    if (isTrue) return { kind: 'unchanged' };
    const next = [...body];
    // Replace only the value, not the whole line, so a trailing comment (`hooks = false # off`)
    // survives the flip.
    next[hooksIndex] = line.replace(/=\s*false\b/, '= true');
    return { kind: 'edited', text: next.join(eol) + eol };
  }

  // No hooks line in the table: insert right after the header.
  const next = [...body.slice(0, headerIndex + 1), 'hooks = true', ...body.slice(headerIndex + 1)];
  return { kind: 'edited', text: next.join(eol) + eol };
}

/**
 * Ensures Codex's `config.toml` has `[features] hooks = true`, backing up the original first
 * when it makes an edit. Creates the file (and its directory) if missing. Never touches the
 * file when it is already enabled, and never writes to it when the form is unsupported.
 */
export async function ensureCodexHooksFeature(configPath: string): Promise<'ok' | 'unsupported'> {
  let current: string;
  let existed: boolean;
  try {
    current = await fs.readFile(configPath, 'utf8');
    existed = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    current = '';
    existed = false;
  }

  const result = enableHooksFeature(current);
  if (result.kind === 'unchanged') return 'ok';
  if (result.kind === 'unsupported') return 'unsupported';

  await fs.mkdir(dirname(configPath), { recursive: true });
  // Only back up a file that actually exists, and require that backup to succeed: unlike
  // HookInstaller (which always calls backupFile on a file it just read successfully),
  // a failed backup here must abort before the write, never fall through to overwriting the
  // original silently.
  if (existed) await backupFile(configPath, { required: true });
  const tmp = `${configPath}.claude-mons.tmp`;
  await fs.writeFile(tmp, result.text, 'utf8');
  await fs.rename(tmp, configPath);
  return 'ok';
}

/**
 * Read-only counterpart to `ensureCodexHooksFeature`: reports what `[features] hooks` currently
 * evaluates to without writing anything. Used to keep `UiSnapshot.hooks.codex.feature` accurate
 * across a restart where no install/reinstall runs this session -- an unreadable or missing file
 * reports `null` (not `'unsupported'`, which is reserved for a form the app knows it cannot edit),
 * the same as before any attempt has ever been made.
 */
export async function readCodexFeatureStatus(
  configPath: string,
): Promise<'ok' | 'unsupported' | null> {
  let current: string;
  try {
    current = await fs.readFile(configPath, 'utf8');
  } catch {
    return null;
  }
  const result = enableHooksFeature(current);
  if (result.kind === 'unchanged') return 'ok';
  if (result.kind === 'unsupported') return 'unsupported';
  return null;
}
