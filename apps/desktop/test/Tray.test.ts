import { describe, expect, it } from 'vitest';
import { hookMenuLabel } from '../src/main/tray/Tray.ts';
import type { HookStatus } from '../src/main/hooks/HookInstaller.ts';

describe('hookMenuLabel', () => {
  const cases: Array<[HookStatus, string]> = [
    ['installed-binary', '● {label} connected (click to disconnect)'],
    ['installed-script', '● {label} connected via script mode (click to disconnect)'],
    ['partial', '◐ {label} partially connected (click to repair)'],
    ['not-installed', '○ Connect {label}'],
    ['unreadable', '○ Cannot read {label} settings'],
  ];

  for (const label of ['Claude Code', 'Codex']) {
    for (const [status, template] of cases) {
      it(`${label} / ${status}`, () => {
        expect(hookMenuLabel(label, status)).toBe(template.replace('{label}', label));
      });
    }
  }
});
