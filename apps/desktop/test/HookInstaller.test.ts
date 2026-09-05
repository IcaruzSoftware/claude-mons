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
  scriptCommand,
  statusOf,
  type HookTarget,
  type Settings,
} from '../src/main/hooks/HookInstaller.ts';

const BIN = 'C:\\Users\\me\\AppData\\Roaming\\claude-mons\\bin\\claude-mons-hook.exe';
const HOME = 'C:\\Users\\me\\AppData\\Roaming\\claude-mons';
const BINARY_TARGET: HookTarget = { mode: 'binary', binaryPath: BIN, homeDir: HOME };
const SCRIPT_ENDPOINT = { port: 51733, token: 'a'.repeat(64) };
const SCRIPT_TARGET: HookTarget = { mode: 'script', endpoint: SCRIPT_ENDPOINT };

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

describe('script command', () => {
  it('uses curl.exe on win32, no quotes, redirections or chaining', () => {
    const cmd = scriptCommand(SCRIPT_ENDPOINT, 'win32');
    expect(cmd).toBe(
      `curl.exe -s -m 2 -X POST http://127.0.0.1:51733/hook ` +
        `-H X-Claude-Mons-Token:${SCRIPT_ENDPOINT.token} -H Content-Type:application/json --data-binary @-`,
    );
    expect(cmd).not.toMatch(/["'|&><]/);
  });

  it('uses plain curl on other platforms', () => {
    const cmd = scriptCommand(SCRIPT_ENDPOINT, 'linux');
    expect(cmd.startsWith('curl -s -m 2 -X POST')).toBe(true);
    expect(cmd).not.toContain('curl.exe');
    expect(cmd).not.toMatch(/["'|&><]/);
  });

  it('is identical for every event (hook_event_name travels in the JSON body)', () => {
    const ours = buildOurHooks(SCRIPT_TARGET);
    const commands = new Set(Object.values(ours).map((groups) => groups?.[0]?.hooks[0]?.command));
    expect(commands.size).toBe(1);
  });
});

describe('merge / remove (pure)', () => {
  const ours = buildOurHooks(BINARY_TARGET);

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
    expect(statusOf(once)).toBe('installed-binary');
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

  it('recognizes script-mode commands and reports installed-script', () => {
    const scriptOurs = buildOurHooks(SCRIPT_TARGET);
    const merged = mergeOurHooks({}, scriptOurs);
    expect(statusOf(merged)).toBe('installed-script');
    // removeOurHooks strips script-mode commands too
    expect(removeOurHooks(merged).hooks).toBeUndefined();
  });

  it('treats a mix of binary and script commands as partial', () => {
    const merged = mergeOurHooks({}, ours); // all binary
    merged.hooks!.Stop = buildOurHooks(SCRIPT_TARGET).Stop; // swap one event to script
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
    const inst = new HookInstaller({ settingsPath, target: BINARY_TARGET });
    expect(await inst.status()).toBe('not-installed');
    expect(await inst.install()).toBe('installed-binary');
    const written = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    expect(written.hooks.PostToolUse[0].hooks[0].command).toContain('claude-mons-hook');
    expect(await inst.uninstall()).toBe('not-installed');
    expect(JSON.parse(await fs.readFile(settingsPath, 'utf8'))).toEqual({});
  });

  it('installs in script mode and uninstall removes it too', async () => {
    const inst = new HookInstaller({ settingsPath, target: SCRIPT_TARGET });
    expect(await inst.install()).toBe('installed-script');
    const written = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    expect(written.hooks.Stop[0].hooks[0].command).toContain('X-Claude-Mons-Token:');
    expect(await inst.uninstall()).toBe('not-installed');
    expect(JSON.parse(await fs.readFile(settingsPath, 'utf8'))).toEqual({});
  });

  it('reinstalling in the other mode replaces the commands and is idempotent', async () => {
    const binInst = new HookInstaller({ settingsPath, target: BINARY_TARGET });
    expect(await binInst.install()).toBe('installed-binary');

    const scriptInst = new HookInstaller({ settingsPath, target: SCRIPT_TARGET });
    expect(await scriptInst.install()).toBe('installed-script');
    let written = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    expect(written.hooks.Stop).toHaveLength(1); // old binary command replaced, not appended
    expect(written.hooks.Stop[0].hooks[0].command).not.toContain('claude-mons-hook');

    // switching again is idempotent (no duplicate script commands)
    expect(await scriptInst.install()).toBe('installed-script');
    written = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    expect(written.hooks.Stop).toHaveLength(1);
  });

  it('backs up before writing and keeps at most five backups', async () => {
    await fs.writeFile(settingsPath, JSON.stringify({ theme: 'dark' }));
    const inst = new HookInstaller({ settingsPath, target: BINARY_TARGET });
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
    const inst = new HookInstaller({ settingsPath, target: BINARY_TARGET });
    expect(await inst.status()).toBe('unreadable');
    await expect(inst.install()).rejects.toThrow(/Cannot parse/);
    expect(await fs.readFile(settingsPath, 'utf8')).toBe('{ not json');
  });
});
