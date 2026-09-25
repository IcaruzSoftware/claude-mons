/**
 * Shared presentation logic for `HookStatusValue`, used by both the Settings hook row
 * (`apps/desktop/src/renderer/panel/views/Settings.tsx`) and the onboarding "Connect Claude Code"
 * step (`apps/desktop/src/renderer/panel/views/Onboarding.tsx`) so the two stay in sync.
 */
import type { HookAgent, HookStatusValue } from '../../common/ipc.ts';

/** True for both binary and script-mode "hooks are live" states. */
export function isHookConnected(status: HookStatusValue): boolean {
  return status === 'installed-binary' || status === 'installed-script';
}

/** Short human label for each `HookStatusValue`, for Claude Code (`hookStatusLabel`'s default). */
export const HOOK_STATUS_LABEL: Record<HookStatusValue, string> = {
  'installed-binary': 'Connected',
  'installed-script': 'Connected (script mode)',
  partial: 'Partially connected',
  'not-installed': 'Not connected',
  unreadable: 'settings.json unreadable',
  'no-binary': 'Hook binary missing (run pnpm hook:build)',
};

/**
 * Human label for a `HookStatusValue`, parametrized by agent: `unreadable` names a different file
 * per agent (Claude Code's `~/.claude/settings.json` vs. Codex's `~/.codex/hooks.json`), every
 * other status shares the same wording. Defaults to Claude Code so `HOOK_STATUS_LABEL`'s existing
 * callers keep compiling unchanged.
 */
export function hookStatusLabel(status: HookStatusValue, agent: HookAgent = 'claude'): string {
  if (status === 'unreadable') {
    return agent === 'codex' ? 'hooks.json unreadable' : 'settings.json unreadable';
  }
  return HOOK_STATUS_LABEL[status];
}

/** CSS modifier for the `.status-dot` element (`panel.css`); `''` renders the neutral dot. */
export function hookStatusDotClass(status: HookStatusValue): 'ok' | 'warn' | '' {
  if (isHookConnected(status)) return 'ok';
  if (status === 'partial') return 'warn';
  return '';
}
