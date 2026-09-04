import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { HOOK_EVENTS, type HookEventName } from '@claude-mons/shared';

/** Marker that identifies hook commands we own inside the user's settings. */
export const HOOK_MARKER = 'claude-mons-hook';
const BACKUPS_TO_KEEP = 5;

export type HookStatus = 'installed' | 'partial' | 'not-installed' | 'unreadable';

export interface HookCommand {
  type: string;
  command: string;
  timeout?: number;
}
export interface HookGroup {
  matcher?: string;
  hooks: HookCommand[];
}
export type HooksSection = Partial<Record<string, HookGroup[]>>;
export interface Settings {
  hooks?: HooksSection;
  [key: string]: unknown;
}

/** Location of Claude Code's user settings. Honors CLAUDE_CONFIG_DIR. */
export function claudeSettingsPath(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const dir =
    env.CLAUDE_CONFIG_DIR && env.CLAUDE_CONFIG_DIR.length > 0
      ? env.CLAUDE_CONFIG_DIR
      : join(home, '.claude');
  return join(dir, 'settings.json');
}

/** The command line Claude Code will run for an event. Forward slashes work in every shell. */
export function hookCommand(binaryPath: string, homeDir: string, event: HookEventName): string {
  const q = (p: string) => `"${p.replace(/\\/g, '/')}"`;
  return `${q(binaryPath)} --home ${q(homeDir)} --event ${event}`;
}

/** Builds the hooks we add for all supported events. */
export function buildOurHooks(binaryPath: string, homeDir: string): HooksSection {
  const section: HooksSection = {};
  for (const event of HOOK_EVENTS) {
    const group: HookGroup = {
      hooks: [{ type: 'command', command: hookCommand(binaryPath, homeDir, event), timeout: 5 }],
    };
    if (event === 'PreToolUse' || event === 'PostToolUse') group.matcher = '*';
    section[event] = [group];
  }
  return section;
}

function isOurs(cmd: HookCommand): boolean {
  return typeof cmd.command === 'string' && cmd.command.includes(HOOK_MARKER);
}

/** Removes every hook command we own; drops groups/events that become empty. Pure. */
export function removeOurHooks(settings: Settings): Settings {
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== 'object') return settings;
  const next: HooksSection = {};
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) {
      next[event] = groups;
      continue;
    }
    const kept: HookGroup[] = [];
    for (const g of groups) {
      if (!g || !Array.isArray(g.hooks)) {
        kept.push(g);
        continue;
      }
      const remaining = g.hooks.filter((h) => !isOurs(h));
      if (remaining.length > 0) kept.push({ ...g, hooks: remaining });
    }
    if (kept.length > 0) next[event] = kept;
  }
  const out: Settings = { ...settings };
  if (Object.keys(next).length > 0) out.hooks = next;
  else delete out.hooks;
  return out;
}

/** Removes our old hooks and appends the current ones, preserving everything else. Pure. */
export function mergeOurHooks(settings: Settings, ours: HooksSection): Settings {
  const cleaned = removeOurHooks(settings);
  const hooks: HooksSection = { ...(cleaned.hooks ?? {}) };
  for (const [event, groups] of Object.entries(ours)) {
    if (!groups) continue;
    const existing = Array.isArray(hooks[event]) ? hooks[event]! : [];
    hooks[event] = [...existing, ...groups];
  }
  return { ...cleaned, hooks };
}

/** Reports how many of our events are present. Pure. */
export function statusOf(settings: Settings): HookStatus {
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== 'object') return 'not-installed';
  let present = 0;
  for (const event of HOOK_EVENTS) {
    const groups = hooks[event];
    if (
      Array.isArray(groups) &&
      groups.some((g) => Array.isArray(g?.hooks) && g.hooks.some(isOurs))
    )
      present++;
  }
  if (present === 0) return 'not-installed';
  if (present === HOOK_EVENTS.length) return 'installed';
  return 'partial';
}

export interface HookInstallerOptions {
  settingsPath: string;
  binaryPath: string;
  homeDir: string;
}

/**
 * Edits Claude Code's settings.json to add/remove our hooks. Always backs up first, never
 * touches other people's hooks, aborts (without writing) on invalid JSON.
 */
export class HookInstaller {
  constructor(private readonly opts: HookInstallerOptions) {}

  async status(): Promise<HookStatus> {
    const settings = await this.read();
    if (settings === 'unreadable') return 'unreadable';
    return statusOf(settings ?? {});
  }

  async install(): Promise<HookStatus> {
    const current = await this.read();
    if (current === 'unreadable')
      throw new Error(`Cannot parse ${this.opts.settingsPath}; not modifying it.`);
    const next = mergeOurHooks(
      current ?? {},
      buildOurHooks(this.opts.binaryPath, this.opts.homeDir),
    );
    await this.write(next, current !== null);
    return this.status();
  }

  async uninstall(): Promise<HookStatus> {
    const current = await this.read();
    if (current === 'unreadable')
      throw new Error(`Cannot parse ${this.opts.settingsPath}; not modifying it.`);
    if (current === null) return 'not-installed';
    await this.write(removeOurHooks(current), true);
    return this.status();
  }

  private async read(): Promise<Settings | null | 'unreadable'> {
    let text: string;
    try {
      text = await fs.readFile(this.opts.settingsPath, 'utf8');
    } catch {
      return null;
    }
    if (text.trim() === '') return {};
    try {
      const parsed = JSON.parse(text) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        return 'unreadable';
      return parsed as Settings;
    } catch {
      return 'unreadable';
    }
  }

  private async write(settings: Settings, backup: boolean): Promise<void> {
    const path = this.opts.settingsPath;
    await fs.mkdir(dirname(path), { recursive: true });
    if (backup) await this.backup();
    const tmp = `${path}.claude-mons.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    await fs.rename(tmp, path);
  }

  private async backup(): Promise<void> {
    const path = this.opts.settingsPath;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = `${path}.claude-mons-backup-${stamp}`;
    try {
      await fs.copyFile(path, dest);
    } catch {
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
}
