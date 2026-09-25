// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { NATIONS, nationNodes, speciesForNation, type Nation } from '@claude-mons/shared';
import type { UiSnapshot } from '../src/common/ipc.ts';
import { BattlesView } from '../src/renderer/panel/views/Battles.tsx';

// A saved tree for `nation` that fills tiers 1-4 of the first branch (so the read-only preview and
// the editor both render stat, passive and flavour nodes) plus one shared passive.
function savedTree(nation: Nation): Record<string, number> {
  const nodes = nationNodes(nation);
  const firstBranch = nodes[0]!.branch;
  const col = nodes.filter((n) => n.branch === firstBranch).sort((a, b) => a.tier - b.tier);
  const tree: Record<string, number> = { 'shared:stone-skin': 1 };
  for (const node of col) {
    if (node.tier <= 4) tree[node.id] = node.maxRank;
  }
  return tree;
}

function snapshotFor(nation: Nation, tree: Record<string, number>): UiSnapshot {
  const species = speciesForNation(nation)[0]!;
  const s = {
    version: '0.0.0-test',
    isDev: false,
    devOnboardingStep: null,
    profile: { nickname: 'Tester', nation, userId: 'u1' },
    account: { email: null, anonymous: true, signedOut: false },
    pet: { speciesId: species.id, stage: 'adult', state: 'idle' },
    progress: {
      level: 18,
      xpIntoLevel: 0,
      xpToNext: 100,
      totalXp: 0,
      serverXp: null,
      streakDays: 0,
    },
    hooks: { status: 'installed-binary', mode: 'auto', effectiveMode: 'binary', probe: 'ok' },
    settings: { spriteScale: 4, autostart: false },
    water: { enabled: false, intervalMin: 60, todayCount: 0, nextDueAt: null },
    online: { connected: true, lastSyncAt: null, lastError: null, configured: true },
    update: { kind: 'idle' },
    notifications: [],
    battles: {
      history: [],
      cooldownUntil: null,
      remainingToday: 3,
      winStreak: 0,
      loadout: { stance: 'bulwark', moves: species.movePool.slice(0, 3).map((m) => m.id), tree },
      unlockedMoveIds: species.movePool.map((m) => m.id),
      treePoints: { spent: 0, available: 15 },
      sharedPassivePoints: { spent: 0, available: 1 },
      lastRespecAt: null,
    },
  };
  return s as unknown as UiSnapshot;
}

function fire(el: Element, type: string) {
  el.dispatchEvent(new window.MouseEvent(type, { bubbles: true, cancelable: true }));
}
const flush = () => new Promise((r) => setTimeout(r, 0));

let container: HTMLDivElement;
let setLoadout: ReturnType<typeof vi.fn>;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  setLoadout = vi.fn().mockResolvedValue({ ok: true, error: null });
  (window as unknown as { monsUi: unknown }).monsUi = { setLoadout };
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  render(null, container);
  container.remove();
  consoleError.mockRestore();
});

describe('talent UI renders for every nation (read-only preview with a populated tree)', () => {
  for (const nation of NATIONS) {
    it(`${nation}: main tab renders a saved tier 1-4 + passive tree without error`, async () => {
      render(h(BattlesView, { s: snapshotFor(nation, savedTree(nation)) }), container);
      await flush();
      // Hover every preview node so its tooltip/description renders too (covers tier 3/4 flavour).
      for (const g of Array.from(container.querySelectorAll('.tree-svg g'))) {
        fire(g, 'mouseenter');
        await flush();
      }
      expect(container.querySelector('.tree-svg'), `${nation}: preview tree`).toBeTruthy();
      expect(consoleError, `${nation}: console.error`).not.toHaveBeenCalled();
    });
  }
});

describe('talent editor adds ranks and saves for every nation', () => {
  for (const nation of NATIONS) {
    it(`${nation}: editing from an empty tree throws nothing and sends the tree to save`, async () => {
      // Start from an empty tree so adding ranks is never a respec (which would arm confirmation).
      render(h(BattlesView, { s: snapshotFor(nation, {}) }), container);
      await flush();

      const editBtn = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Edit loadout',
      );
      expect(editBtn, `${nation}: Edit loadout button`).toBeTruthy();
      fire(editBtn!, 'click');
      await flush();
      const overlay = container.querySelector('.loadout-overlay');
      expect(overlay, `${nation}: editor overlay`).toBeTruthy();

      // Hover + click every node; DOM order is tier 1..6 per branch, so prereqs are met as we go.
      const nodeGroups = Array.from(overlay!.querySelectorAll('.tree-svg g'));
      expect(nodeGroups.length, `${nation}: node count`).toBe(18);
      for (const g of nodeGroups) {
        fire(g, 'mouseenter');
        await flush();
        fire(g, 'click');
        await flush();
      }
      // Turn on a shared passive (starts off, so this only adds -- never a respec).
      const firstPassive = overlay!.querySelector('.talent-passives button');
      if (firstPassive) {
        fire(firstPassive, 'click');
        await flush();
      }

      const saveBtn = Array.from(overlay!.querySelectorAll('button')).find(
        (b) => b.textContent?.trim() === 'Save',
      );
      expect(saveBtn, `${nation}: Save button`).toBeTruthy();
      fire(saveBtn!, 'click');
      await flush();

      expect(consoleError, `${nation}: console.error`).not.toHaveBeenCalled();
      expect(setLoadout, `${nation}: setLoadout called`).toHaveBeenCalled();
      const payload = setLoadout.mock.calls.at(-1)![0] as { tree?: Record<string, number> };
      expect(payload.tree, `${nation}: tree in payload`).toBeTruthy();
      expect(Object.values(payload.tree!).some((r) => r > 0), `${nation}: non-empty tree`).toBe(
        true,
      );
    });
  }
});
