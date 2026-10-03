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
  (window as unknown as { monsUi: unknown }).monsUi = {
    setLoadout,
    refreshBattles: vi.fn().mockResolvedValue(undefined),
  };
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  render(null, container);
  container.remove();
  consoleError.mockRestore();
});

it('shows only abilities, a Skill Tree entry and history on Battle', async () => {
  render(h(BattlesView, { s: snapshotFor('water', savedTree('water')) }), container);
  await flush();
  expect([...container.querySelectorAll('h3')].map((e) => e.textContent)).toEqual([
    'Abilities',
    'Battle History',
  ]);
  expect(container.querySelectorAll('.mv-select')).toHaveLength(3);
  expect(container.querySelector('.skill-entry')).toBeTruthy();
  expect(container.querySelector('.talent-card, .tree-wrap, .arena, .triframe')).toBeNull();
  expect(container.textContent).not.toContain('Shared passives');
});

it('updates the open History with the newest battle ahead of login-time entries', async () => {
  const s = snapshotFor('water', {});
  const old = {
    id: 'login-battle',
    at: 1000,
    won: true,
    xp: 10,
    isBot: true,
    isElite: false,
    winStreak: 0,
    turns: 5,
    reason: 'ko' as const,
    me: { speciesId: 'dripple', stage: 'baby' as const, level: 5 },
    opponent: {
      nickname: 'Old',
      speciesId: 'sparkit',
      stage: 'baby' as const,
      level: 5,
      nation: 'fire' as const,
      loadout: {},
    },
  };
  s.battles.history = [old];
  render(h(BattlesView, { s }), container);
  await flush();
  render(
    h(BattlesView, {
      s: {
        ...s,
        battles: { ...s.battles, history: [old, { ...old, id: 'new-battle', at: 2000 }] },
      },
    }),
    container,
  );
  await flush();
  expect(
    [...container.querySelectorAll('[data-battle-id]')].map((e) =>
      e.getAttribute('data-battle-id'),
    ),
  ).toEqual(['new-battle', 'login-battle']);
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

describe('zoomable skill map', () => {
  async function open(s: UiSnapshot) {
    render(h(BattlesView, { s }), container);
    await flush();
    fire(container.querySelector('.skill-entry')!, 'click');
    await flush();
    return container.querySelector('.skill-overlay')!;
  }
  async function clickText(scope: Element, label: string) {
    const button = Array.from(scope.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === label,
    )!;
    expect(button).toBeTruthy();
    fire(button, 'click');
    await flush();
  }
  for (const nation of NATIONS) {
    for (const species of speciesForNation(nation)) {
      it(`${species.id}: renders all four paths, Flow and shared passives`, async () => {
        const s = snapshotFor(nation, {});
        s.pet.speciesId = species.id;
        const overlay = await open(s);
        expect(overlay.querySelectorAll('[data-node-id]')).toHaveLength(24);
        expect(overlay.querySelectorAll('[data-passive-id]')).toHaveLength(10);
        expect(overlay.querySelectorAll('.map-branch-label')).toHaveLength(4);
        expect(overlay.querySelector(`[data-node-id="${nation}:flow:6"]`)).toBeTruthy();
        expect(overlay.textContent).not.toContain('Planned');
      });
    }
  }
  it('buys Flow talents once and saves only the tree while retaining the attack draft', async () => {
    const overlay = await open(snapshotFor('water', {}));
    const select = container.querySelector<HTMLSelectElement>('.mv-select')!;
    const replacement = Array.from(select.options).find(
      (o) => !o.disabled && o.value !== select.value,
    )!.value;
    select.value = replacement;
    fire(select, 'change');
    await flush();
    fire(overlay.querySelector('[data-node-id="water:flow:1"]')!, 'click');
    await flush();
    await clickText(overlay, 'Unlock · 1 pts');
    expect(overlay.querySelector('.skill-actions .primary')!.hasAttribute('disabled')).toBe(true);
    await clickText(overlay, 'Save');
    expect(setLoadout).toHaveBeenLastCalledWith({ tree: { 'water:flow:1': 1 } });
    expect(container.querySelector<HTMLSelectElement>('.mv-select')!.value).toBe(replacement);
  });
  it('cancels additions and cascades removal through actual prerequisites', async () => {
    const overlay = await open(snapshotFor('water', { 'water:flow:1': 1, 'water:flow:2': 1 }));
    fire(overlay.querySelector('[data-node-id="water:flow:1"]')!, 'click');
    await flush();
    await clickText(overlay, 'Remove');
    expect(overlay.querySelectorAll('[data-node-id].learned')).toHaveLength(0);
    await clickText(overlay, 'Cancel');
    expect(setLoadout).not.toHaveBeenCalled();
    fire(container.querySelector('.skill-entry')!, 'click');
    await flush();
    expect(container.querySelectorAll('[data-node-id].learned')).toHaveLength(2);
  });
  it('enforces separate passive points and exposes zoom controls without spending points', async () => {
    const overlay = await open(snapshotFor('water', {}));
    fire(overlay.querySelector('[data-passive-id="shared:stone-skin"]')!, 'click');
    await flush();
    await clickText(overlay, 'Unlock · 3 passive pts');
    fire(overlay.querySelector('[data-passive-id="shared:deep-roots"]')!, 'click');
    await flush();
    expect(overlay.querySelector('.skill-actions .primary')!.hasAttribute('disabled')).toBe(true);
    fire(overlay.querySelector('[aria-label="Zoom in"]')!, 'click');
    await flush();
    expect(overlay.querySelector('output')!.textContent).toBe('90%');
    fire(overlay.querySelector('[aria-label="Zoom out"]')!, 'click');
    await flush();
    expect(overlay.querySelector('output')!.textContent).toBe('75%');
    await clickText(overlay, 'Save');
    expect(setLoadout).toHaveBeenLastCalledWith({ tree: { 'shared:stone-skin': 1 } });
  });
});
