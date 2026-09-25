import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { codexDetected, codexHome, codexHomeOverridden } from '../src/main/hooks/agents.ts';

describe('codexDetected', () => {
  let home: string;

  beforeEach(async () => {
    home = await fs.mkdtemp(join(tmpdir(), 'cm-agents-'));
  });

  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  it('is false when ~/.codex does not exist', () => {
    expect(codexDetected({}, home)).toBe(false);
  });

  it('is true once the config directory exists', async () => {
    await fs.mkdir(codexHome({}, home), { recursive: true });
    expect(codexDetected({}, home)).toBe(true);
  });

  it('honors CODEX_HOME over the default location', async () => {
    const codexHomeDir = join(home, 'custom-codex');
    await fs.mkdir(codexHomeDir, { recursive: true });
    expect(codexDetected({ CODEX_HOME: codexHomeDir }, home)).toBe(true);
    expect(codexDetected({}, home)).toBe(false);
  });
});

describe('codexHomeOverridden', () => {
  it('is false when CODEX_HOME is unset or empty', () => {
    expect(codexHomeOverridden({})).toBe(false);
    expect(codexHomeOverridden({ CODEX_HOME: '' })).toBe(false);
  });

  it('is true once CODEX_HOME is set to a non-empty path', () => {
    expect(codexHomeOverridden({ CODEX_HOME: '/tmp/cx' })).toBe(true);
  });
});
