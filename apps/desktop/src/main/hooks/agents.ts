import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { HookEventName } from '@claude-mons/shared';
import type { HookAgent } from '../../common/ipc.ts';

/** Re-exported for convenience; `HookAgent` itself is defined once in `../../common/ipc.ts`. */
export type { HookAgent };

/**
 * One event a `HookAgentSpec` installs a hook for: `name` is the key the agent's own
 * settings/hooks file uses, `as` is the `HookEventName` we normalize it to (they differ for
 * Codex's `PermissionRequest`, which has no Claude Code equivalent).
 */
export interface AgentEvent {
  name: string;
  as: HookEventName;
  matcher?: string;
  timeout: number;
}

/** Which events an agent supports and where they live in that agent's config. */
export interface HookAgentSpec {
  agent: HookAgent;
  label: string;
  events: readonly AgentEvent[];
}

const tool = { matcher: '*' } as const;

/** Claude Code: today's seven events, all at the standard 5 s timeout. */
export const CLAUDE_AGENT: HookAgentSpec = {
  agent: 'claude',
  label: 'Claude Code',
  events: [
    { name: 'SessionStart', as: 'SessionStart', timeout: 5 },
    { name: 'UserPromptSubmit', as: 'UserPromptSubmit', timeout: 5 },
    { name: 'PreToolUse', as: 'PreToolUse', ...tool, timeout: 5 },
    { name: 'PostToolUse', as: 'PostToolUse', ...tool, timeout: 5 },
    { name: 'Notification', as: 'Notification', timeout: 5 },
    { name: 'Stop', as: 'Stop', timeout: 5 },
    { name: 'SessionEnd', as: 'SessionEnd', timeout: 5 },
  ],
};

/** Codex caps SessionEnd/Interrupt hooks at 3 s. */
export const CODEX_AGENT: HookAgentSpec = {
  agent: 'codex',
  label: 'Codex',
  events: [
    { name: 'SessionStart', as: 'SessionStart', timeout: 5 },
    { name: 'UserPromptSubmit', as: 'UserPromptSubmit', timeout: 5 },
    { name: 'PreToolUse', as: 'PreToolUse', ...tool, timeout: 5 },
    { name: 'PostToolUse', as: 'PostToolUse', ...tool, timeout: 5 },
    { name: 'PermissionRequest', as: 'Notification', ...tool, timeout: 5 },
    { name: 'Stop', as: 'Stop', timeout: 5 },
    { name: 'Interrupt', as: 'Interrupt', timeout: 3 },
    { name: 'SessionEnd', as: 'SessionEnd', timeout: 3 },
  ],
};

/** Codex's config home. Honors `CODEX_HOME`, otherwise `~/.codex`. */
export function codexHome(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env.CODEX_HOME && env.CODEX_HOME.length > 0 ? env.CODEX_HOME : join(home, '.codex');
}

/** Location of Codex's hooks file. */
export function codexHooksPath(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return join(codexHome(env, home), 'hooks.json');
}

/** Location of Codex's TOML config. */
export function codexConfigPath(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return join(codexHome(env, home), 'config.toml');
}

/**
 * Whether Codex is actually installed on this machine, i.e. its config directory already exists.
 * The panel/tray only ever offer to connect Codex when this is true, and `toggleHooks('codex')`
 * refuses otherwise -- nothing in the app may create `~/.codex` just by probing it.
 */
export function codexDetected(env: NodeJS.ProcessEnv = process.env, home = homedir()): boolean {
  return existsSync(codexHome(env, home));
}
