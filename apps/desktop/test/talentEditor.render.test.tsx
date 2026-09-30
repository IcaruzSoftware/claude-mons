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
      expect(container.querySelectorAll('.readable-tree .talent-branch')).toHaveLength(5);
      expect(container.querySelectorAll('.readable-tree .talent-card')).toHaveLength(34);
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

      expect(
        Array.from(container.querySelectorAll('button')).some(
          (b) => b.textContent?.trim() === 'Edit loadout',
        ),
      ).toBe(false);
      const overlay = container.querySelector('.loadout-card');
      expect(overlay, `${nation}: inline editor`).toBeTruthy();

      const nodeCards = Array.from(
        overlay!.querySelectorAll('.talent-branch:first-of-type .talent-card'),
      );
      expect(nodeCards.length, `${nation}: first branch`).toBe(6);
      for (const card of nodeCards) {
        fire(card, 'click');
        await flush();
      }
      const firstPassive = overlay!.querySelector('.talent-branch:last-child .talent-card');
      if (firstPassive) {
        fire(firstPassive, 'click');
        await flush();
      }

      expect(setLoadout).not.toHaveBeenCalled();
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
      expect(
        Object.values(payload.tree!).some((r) => r > 0),
        `${nation}: non-empty tree`,
      ).toBe(true);
    });
  }
});

it('shows six Flow choices and only buys each talent once', async () => {
  render(h(BattlesView, { s: snapshotFor('water', {}) }), container);
  await flush();
  const choices = Array.from(
    container.querySelectorAll<HTMLButtonElement>('.talent-branch:nth-of-type(4) .talent-card'),
  );
  expect(choices).toHaveLength(6);
  fire(choices[0]!, 'click');
  await flush();
  fire(choices[0]!, 'click');
  await flush();
  fire(choices[1]!, 'click');
  await flush();
  const save = Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent === 'Save',
  )!;
  fire(save, 'click');
  await flush();
  expect(setLoadout).toHaveBeenCalledWith(
    expect.objectContaining({
      tree: expect.objectContaining({ 'water:flow:1': 1, 'water:flow:2': 1 }),
    }),
  );
});

it('consolidates old multi-rank talents without charging a respec', async () => {
  render(h(BattlesView, { s: snapshotFor('water', { 'water:current:1': 3 }) }), container);
  await flush();
  const save = Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent === 'Save',
  )!;
  fire(save, 'click');
  await flush();
  expect(setLoadout).toHaveBeenCalledWith(
    expect.objectContaining({
      tree: { 'water:current:1': 1 },
    }),
  );
});

it('keeps move edits local across snapshots, blocks duplicate picks, and discards explicitly', async () => {
  const snapshot = snapshotFor('water', {});
  render(h(BattlesView, { s: snapshot }), container);
  await flush();
  const selects = Array.from(container.querySelectorAll<HTMLSelectElement>('.mv-select'));
  const first = selects[0]!;
  expect(
    first.querySelector<HTMLOptionElement>(`option[value="${selects[1]!.value}"]`)?.disabled,
  ).toBe(true);
  const before = first.value;
  const replacement = Array.from(first.options).find(
    (option) => !option.disabled && option.value !== before,
  )!.value;
  first.value = replacement;
  fire(first, 'change');
  await flush();
  render(h(BattlesView, { s: { ...snapshot } }), container);
  await flush();
  expect(container.querySelector<HTMLSelectElement>('.mv-select')!.value).toBe(replacement);
  expect(setLoadout).not.toHaveBeenCalled();
  fire(
    Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Discard changes',
    )!,
    'click',
  );
  await flush();
  expect(container.querySelector<HTMLSelectElement>('.mv-select')!.value).toBe(before);
  expect(setLoadout).not.toHaveBeenCalled();
});

it('retains a draft after a failed save and permits retry without reopening an editor', async () => {
  render(h(BattlesView, { s: snapshotFor('water', {}) }), container);
  await flush();
  const first = container.querySelector<HTMLSelectElement>('.mv-select')!;
  const replacement = Array.from(first.options).find(
    (option) => !option.disabled && option.value !== first.value,
  )!.value;
  first.value = replacement;
  fire(first, 'change');
  await flush();
  setLoadout.mockRejectedValueOnce(new Error('offline'));
  fire(
    Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Save')!,
    'click',
  );
  await flush();
  expect(container.querySelector('.loadout-error')?.textContent).toContain('draft is still here');
  expect(container.querySelector<HTMLSelectElement>('.mv-select')!.value).toBe(replacement);
  fire(
    Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Save')!,
    'click',
  );
  await flush();
  expect(setLoadout).toHaveBeenLastCalledWith(
    expect.objectContaining({ moves: expect.arrayContaining([replacement]) }),
  );
  expect(container.querySelector('.loadout-error')).toBeNull();
});
