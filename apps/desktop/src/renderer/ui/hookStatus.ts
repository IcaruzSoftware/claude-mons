/**
 * Shared presentation logic for `HookStatusValue`, used by both the Settings hook row
 * (`apps/desktop/src/renderer/panel/views/Settings.tsx`) and the onboarding "Connect Claude Code"
 * step (`apps/desktop/src/renderer/panel/views/Onboarding.tsx`) so the two stay in sync.
 */
import type { HookStatusValue } from '../../common/ipc.ts';

/** True for both binary and script-mode "hooks are live" states. */
export function isHookConnected(status: HookStatusValue): boolean {
  return status === 'installed-binary' || status === 'installed-script';
}

/** Short human label for each `HookStatusValue`. */
export const HOOK_STATUS_LABEL: Record<HookStatusValue, string> = {
  'installed-binary': 'Connected',
  'installed-script': 'Connected (script mode)',
  partial: 'Partially connected',
  'not-installed': 'Not connected',
  unreadable: 'settings.json unreadable',
  'no-binary': 'Hook binary missing (run pnpm hook:build)',
};

/** CSS modifier for the `.status-dot` element (`panel.css`); `''` renders the neutral dot. */
export function hookStatusDotClass(status: HookStatusValue): 'ok' | 'warn' | '' {
  if (isHookConnected(status)) return 'ok';
  if (status === 'partial') return 'warn';
  return '';
}
