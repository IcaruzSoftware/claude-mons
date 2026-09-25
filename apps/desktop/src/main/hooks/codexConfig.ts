import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import { backupFile } from './backup.ts';

/** Result of trying to turn `hooks = true` on in a `config.toml` body. Pure. */
export type FeatureEdit =
  | { kind: 'unchanged' }
  | { kind: 'edited'; text: string }
  | { kind: 'unsupported' };

const TABLE_HEADER = /^\s*\[/;
const FEATURES_HEADER = /^\s*\[features\]\s*(#.*)?$/;
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
    const isTrue = /^\s*hooks\s*=\s*true\b/.test(body[hooksIndex] ?? '');
    if (isTrue) return { kind: 'unchanged' };
    const next = [...body];
    next[hooksIndex] = 'hooks = true';
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
  try {
    current = await fs.readFile(configPath, 'utf8');
  } catch {
    current = '';
  }

  const result = enableHooksFeature(current);
  if (result.kind === 'unchanged') return 'ok';
  if (result.kind === 'unsupported') return 'unsupported';

  await fs.mkdir(dirname(configPath), { recursive: true });
  await backupFile(configPath);
  const tmp = `${configPath}.claude-mons.tmp`;
  await fs.writeFile(tmp, result.text, 'utf8');
  await fs.rename(tmp, configPath);
  return 'ok';
}
