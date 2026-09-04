import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  HookInstaller,
  buildOurHooks,
  claudeSettingsPath,
  hookCommand,
  mergeOurHooks,
  removeOurHooks,
  statusOf,
  type Settings,
} from '../src/main/hooks/HookInstaller.ts';

const BIN = 'C:\\Users\\me\\AppData\\Roaming\\claude-mons\\bin\\claude-mons-hook.exe';
const HOME = 'C:\\Users\\me\\AppData\\Roaming\\claude-mons';

describe('hook command', () => {
  it('quotes paths with forward slashes', () => {
    expect(hookCommand(BIN, HOME, 'Stop')).toBe(
      '"C:/Users/me/AppData/Roaming/claude-mons/bin/claude-mons-hook.exe" --home "C:/Users/me/AppData/Roaming/claude-mons" --event Stop',
    );
  });

  it('honors CLAUDE_CONFIG_DIR', () => {
    expect(claudeSettingsPath({ CLAUDE_CONFIG_DIR: '/tmp/cc' }, '/home/x')).toBe(
      join('/tmp/cc', 'settings.json'),
    );
    expect(claudeSettingsPath({}, '/home/x')).toBe(join('/home/x', '.claude', 'settings.json'));
  });
});

describe('merge / remove (pure)', () => {
  const ours = buildOurHooks(BIN, HOME);

  it('adds all seven events with matchers on tool events', () => {
    expect(Object.keys(ours).sort()).toEqual(
      [
        'Notification',
        'PostToolUse',
        'PreToolUse',
        'SessionEnd',
        'SessionStart',
        'Stop',
        'UserPromptSubmit',
      ].sort(),
    );
    expect(ours.PreToolUse?.[0]?.matcher).toBe('*');
    expect(ours.Stop?.[0]?.matcher).toBeUndefined();
    expect(ours.Stop?.[0]?.hooks[0]?.timeout).toBe(5);
  });

  it('preserves foreign hooks and is idempotent', () => {
    const foreign: Settings = {
      permissions: { allow: ['Bash(ls)'] },
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo lint' }] }],
        Stop: [{ hooks: [{ type: 'command', command: 'notify-send done' }] }],
      },
    };
    const once = mergeOurHooks(foreign, ours);
    const twice = mergeOurHooks(once, ours);
    expect(twice).toEqual(once);
    expect(once.permissions).toEqual(foreign.permissions);
    expect(once.hooks?.PreToolUse).toHaveLength(2);
    expect(once.hooks?.PreToolUse?.[0]?.hooks[0]?.command).toBe('echo lint');
    expect(once.hooks?.Stop).toHaveLength(2);
    expect(statusOf(once)).toBe('installed');
    expect(statusOf(foreign)).toBe('not-installed');
  });

  it('removes only our hooks and drops empty groups', () => {
    const merged = mergeOurHooks(
      { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'notify-send done' }] }] } },
      ours,
    );
    const removed = removeOurHooks(merged);
    expect(removed.hooks).toEqual({
      Stop: [{ hooks: [{ type: 'command', command: 'notify-send done' }] }],
    });
    const emptied = removeOurHooks(mergeOurHooks({}, ours));
    expect(emptied.hooks).toBeUndefined();
  });

  it('reports partial installs', () => {
    const merged = mergeOurHooks({}, ours);
    delete merged.hooks?.Stop;
    expect(statusOf(merged)).toBe('partial');
  });
});

describe('HookInstaller (filesystem)', () => {
  let dir: string;
  let settingsPath: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'cm-hooks-'));
    settingsPath = join(dir, 'settings.json');
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('creates settings.json when missing, uninstall restores a hook-free file', async () => {
    const inst = new HookInstaller({ settingsPath, binaryPath: BIN, homeDir: HOME });
    expect(await inst.status()).toBe('not-installed');
    expect(await inst.install()).toBe('installed');
    const written = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    expect(written.hooks.PostToolUse[0].hooks[0].command).toContain('claude-mons-hook');
    expect(await inst.uninstall()).toBe('not-installed');
    expect(JSON.parse(await fs.readFile(settingsPath, 'utf8'))).toEqual({});
  });

  it('backs up before writing and keeps at most five backups', async () => {
    await fs.writeFile(settingsPath, JSON.stringify({ theme: 'dark' }));
    const inst = new HookInstaller({ settingsPath, binaryPath: BIN, homeDir: HOME });
    for (let i = 0; i < 7; i++) {
      await inst.install();
      await new Promise((r) => setTimeout(r, 5));
    }
    const backups = (await fs.readdir(dir)).filter((f) => f.includes('claude-mons-backup-'));
    expect(backups.length).toBeLessThanOrEqual(5);
    expect(backups.length).toBeGreaterThan(0);
    const written = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    expect(written.theme).toBe('dark');
    expect(written.hooks.Stop).toHaveLength(1); // idempotent across 7 installs
  });

  it('refuses to touch malformed JSON', async () => {
    await fs.writeFile(settingsPath, '{ not json');
    const inst = new HookInstaller({ settingsPath, binaryPath: BIN, homeDir: HOME });
    expect(await inst.status()).toBe('unreadable');
    await expect(inst.install()).rejects.toThrow(/Cannot parse/);
    expect(await fs.readFile(settingsPath, 'utf8')).toBe('{ not json');
  });
});
