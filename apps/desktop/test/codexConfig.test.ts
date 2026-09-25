import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enableHooksFeature,
  ensureCodexHooksFeature,
  readCodexFeatureStatus,
} from '../src/main/hooks/codexConfig.ts';

describe('enableHooksFeature', () => {
  it('creates the table in an empty file', () =>
    expect(enableHooksFeature('')).toEqual({ kind: 'edited', text: '[features]\nhooks = true\n' }));

  it('appends a table when none exists and keeps the rest', () => {
    const r = enableHooksFeature('model = "gpt-5"\n\n[tui]\nx = 1\n');
    expect(r).toEqual({
      kind: 'edited',
      text: 'model = "gpt-5"\n\n[tui]\nx = 1\n\n[features]\nhooks = true\n',
    });
  });

  it('inserts into an existing [features] table', () => {
    const r = enableHooksFeature('[features]\nfoo = true\n\n[tui]\n');
    expect(r).toEqual({
      kind: 'edited',
      text: '[features]\nhooks = true\nfoo = true\n\n[tui]\n',
    });
  });

  it('flips hooks = false, preserving a trailing comment', () =>
    expect(enableHooksFeature('[features]\nhooks = false # off\n')).toEqual({
      kind: 'edited',
      text: '[features]\nhooks = true # off\n',
    }));

  it('leaves hooks = true alone', () =>
    expect(enableHooksFeature('[features]\nhooks = true\n')).toEqual({ kind: 'unchanged' }));

  it('recognizes [features] with extra whitespace inside the brackets', () => {
    const r = enableHooksFeature('[ features ]\nfoo = true\n');
    expect(r).toEqual({ kind: 'edited', text: '[ features ]\nhooks = true\nfoo = true\n' });
  });

  it('recognizes a quoted table header', () => {
    const r = enableHooksFeature('["features"]\nfoo = true\n');
    expect(r).toEqual({ kind: 'edited', text: '["features"]\nhooks = true\nfoo = true\n' });
  });

  it('refuses dotted or inline forms it cannot edit safely', () => {
    expect(enableHooksFeature('features.hooks = false\n').kind).toBe('unsupported');
    expect(enableHooksFeature('features = { hooks = false }\n').kind).toBe('unsupported');
  });

  it('handles CRLF files', () =>
    expect(enableHooksFeature('[features]\r\nhooks = false\r\n')).toEqual({
      kind: 'edited',
      text: '[features]\r\nhooks = true\r\n',
    }));

  it('inserts right after [features] when immediately followed by another table, no blank line', () =>
    expect(enableHooksFeature('[features]\n[tui]\n')).toEqual({
      kind: 'edited',
      text: '[features]\nhooks = true\n[tui]\n',
    }));
});

describe('ensureCodexHooksFeature', () => {
  let dir: string;
  let configPath: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'cm-codex-config-'));
    configPath = join(dir, 'config.toml');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('creates a missing file with the feature enabled and writes no backup', async () => {
    expect(await ensureCodexHooksFeature(configPath)).toBe('ok');
    expect(await fs.readFile(configPath, 'utf8')).toBe('[features]\nhooks = true\n');
    const entries = await fs.readdir(dir);
    expect(entries.filter((f) => f.includes('claude-mons-backup-'))).toHaveLength(0);
  });

  it('creates missing nested directories', async () => {
    const nestedPath = join(dir, 'nested', 'config.toml');
    expect(await ensureCodexHooksFeature(nestedPath)).toBe('ok');
    expect(await fs.readFile(nestedPath, 'utf8')).toBe('[features]\nhooks = true\n');
  });

  it('edits an existing file needing a change and backs up the original', async () => {
    const original = '[features]\nhooks = false\n';
    await fs.writeFile(configPath, original, 'utf8');

    expect(await ensureCodexHooksFeature(configPath)).toBe('ok');

    expect(await fs.readFile(configPath, 'utf8')).toBe('[features]\nhooks = true\n');
    const backups = (await fs.readdir(dir)).filter((f) => f.includes('claude-mons-backup-'));
    expect(backups).toHaveLength(1);
    expect(await fs.readFile(join(dir, backups[0]!), 'utf8')).toBe(original);
  });

  it('leaves an already-enabled file untouched, no backup', async () => {
    const original = '[features]\nhooks = true\n';
    await fs.writeFile(configPath, original, 'utf8');
    const before = await fs.stat(configPath);

    expect(await ensureCodexHooksFeature(configPath)).toBe('ok');

    const after = await fs.stat(configPath);
    expect(await fs.readFile(configPath, 'utf8')).toBe(original);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    const entries = await fs.readdir(dir);
    expect(entries.filter((f) => f.includes('claude-mons-backup-'))).toHaveLength(0);
  });

  it('leaves an unsupported form untouched and reports unsupported', async () => {
    const original = 'features.hooks = false\n';
    await fs.writeFile(configPath, original, 'utf8');
    const before = await fs.stat(configPath);

    expect(await ensureCodexHooksFeature(configPath)).toBe('unsupported');

    const after = await fs.stat(configPath);
    expect(await fs.readFile(configPath, 'utf8')).toBe(original);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    const entries = await fs.readdir(dir);
    expect(entries.filter((f) => f.includes('claude-mons-backup-'))).toHaveLength(0);
  });

  it('rejects a read error other than ENOENT (EISDIR) and writes nothing', async () => {
    // configPath itself is a directory, so reading it as a file fails with EISDIR, not ENOENT.
    await fs.mkdir(configPath);

    await expect(ensureCodexHooksFeature(configPath)).rejects.toThrow();

    const stat = await fs.stat(configPath);
    expect(stat.isDirectory()).toBe(true);
    const entries = await fs.readdir(dir);
    expect(entries.filter((f) => f.includes('claude-mons-backup-'))).toHaveLength(0);
  });

  it('does not write when the backup of an existing file fails', async () => {
    const original = '[features]\nhooks = false\n';
    await fs.writeFile(configPath, original, 'utf8');
    // Fail only backupFile's copyFile; the read of the existing config.toml still succeeds, so
    // this isolates the backup step itself. (A read-only directory via chmod would not work on
    // Windows, where directory permission bits are ignored.)
    const copyFile = vi.spyOn(fs, 'copyFile').mockRejectedValueOnce(new Error('EACCES'));
    try {
      await expect(ensureCodexHooksFeature(configPath)).rejects.toThrow();
    } finally {
      copyFile.mockRestore();
    }

    expect(await fs.readFile(configPath, 'utf8')).toBe(original);
    const entries = await fs.readdir(dir);
    expect(entries.filter((f) => f.includes('claude-mons-backup-'))).toHaveLength(0);
    expect(entries.filter((f) => f.includes('claude-mons.tmp'))).toHaveLength(0);
  });
});

describe('readCodexFeatureStatus', () => {
  let dir: string;
  let configPath: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'cm-codex-config-read-'));
    configPath = join(dir, 'config.toml');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('is null when the file does not exist, and writes nothing', async () => {
    expect(await readCodexFeatureStatus(configPath)).toBeNull();
    await expect(fs.stat(configPath)).rejects.toThrow();
  });

  it('is ok when the flag is already enabled', async () => {
    await fs.writeFile(configPath, '[features]\nhooks = true\n', 'utf8');
    expect(await readCodexFeatureStatus(configPath)).toBe('ok');
  });

  it('is null when the flag is not set yet -- distinct from unsupported', async () => {
    await fs.writeFile(configPath, '[features]\nhooks = false\n', 'utf8');
    expect(await readCodexFeatureStatus(configPath)).toBeNull();
    await fs.writeFile(configPath, 'model = "gpt-5"\n', 'utf8');
    expect(await readCodexFeatureStatus(configPath)).toBeNull();
  });

  it('is unsupported for a form it cannot edit safely', async () => {
    await fs.writeFile(configPath, 'features.hooks = false\n', 'utf8');
    expect(await readCodexFeatureStatus(configPath)).toBe('unsupported');
  });

  it('never writes to the file', async () => {
    const original = '[features]\nhooks = false\n';
    await fs.writeFile(configPath, original, 'utf8');
    const before = await fs.stat(configPath);

    await readCodexFeatureStatus(configPath);

    const after = await fs.stat(configPath);
    expect(await fs.readFile(configPath, 'utf8')).toBe(original);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });
});
