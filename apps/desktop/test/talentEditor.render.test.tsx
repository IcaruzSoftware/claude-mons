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
    setSkillTreeOpen: vi.fn().mockResolvedValue(undefined),
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

it('consolidates old multi-rank talents on the next automatic skill edit', async () => {
  render(h(BattlesView, { s: snapshotFor('water', { 'water:current:1': 3 }) }), container);
  await flush();
  fire(container.querySelector('.skill-entry')!, 'click');
  await flush();
  fire(container.querySelector('[data-node-id="water:current:2"]')!, 'click');
  await flush();
  expect(setLoadout).toHaveBeenCalledWith({
    stance: 'bulwark',
    tree: { 'water:current:1': 1, 'water:current:2': 1 },
  });
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

describe('automatic skill map', () => {
  async function open(s: UiSnapshot) {
    render(h(BattlesView, { s }), container);
    await flush();
    fire(container.querySelector('.skill-entry')!, 'click');
    await flush();
    return container.querySelector('.skill-overlay')!;
  }
  async function click(scope: Element, selector: string, event = 'click') {
    fire(scope.querySelector(selector)!, event);
    await flush();
  }
  for (const nation of NATIONS) {
    for (const species of speciesForNation(nation)) {
      it(`${species.id}: opens only the map with all abilities and three stance passives`, async () => {
        const s = snapshotFor(nation, {});
        s.pet.speciesId = species.id;
        const overlay = await open(s);
        expect(overlay.querySelectorAll('[data-node-id]')).toHaveLength(48);
        expect(overlay.querySelectorAll('[data-passive-id]')).toHaveLength(10);
        expect(overlay.querySelectorAll('[data-stance-id]')).toHaveLength(3);
        expect(overlay.querySelectorAll('.map-branch-label')).toHaveLength(4);
        expect(overlay.querySelector('.skill-detail, .map-toolbar, .skill-footer')).toBeNull();
        expect(
          [...overlay.querySelectorAll('button')].some((button) => button.textContent === 'Save'),
        ).toBe(false);
        expect(overlay.textContent).not.toContain('Planned');
      });
    }
  }
  it('learns once on left click, autosaves without moves and keeps attack drafts', async () => {
    const overlay = await open(snapshotFor('water', {}));
    const select = container.querySelector<HTMLSelectElement>('.mv-select')!;
    const replacement = [...select.options].find(
      (option) => !option.disabled && option.value !== select.value,
    )!.value;
    select.value = replacement;
    fire(select, 'change');
    await flush();
    await click(overlay, '[data-node-id="water:flow:1"]');
    expect(setLoadout).toHaveBeenLastCalledWith({ tree: { 'water:flow:1': 1 }, stance: 'bulwark' });
    expect(overlay.querySelector('[data-node-id="water:flow:1"]')!.getAttribute('data-state')).toBe(
      'Learned',
    );
    await click(overlay, '[data-node-id="water:flow:1"]');
    expect(setLoadout).toHaveBeenCalledTimes(1);
    expect(select.value).toBe(replacement);
    await click(overlay, '[aria-label="Close Skill Tree"]');
    expect(container.querySelector('.skill-overlay')).toBeNull();
    expect(setLoadout).toHaveBeenCalledTimes(1);
  });
  it('refunds actual prerequisites on right click and resets every skill at any time', async () => {
    const overlay = await open(
      snapshotFor('water', { 'water:flow:1': 1, 'water:flow:2': 1, 'shared:stone-skin': 1 }),
    );
    await click(overlay, '[data-node-id="water:flow:1"]', 'contextmenu');
    expect(overlay.querySelectorAll('[data-node-id].learned')).toHaveLength(0);
    expect(setLoadout.mock.calls.at(-1)![0].tree['water:flow:2']).toBe(0);
    await click(overlay, '[data-passive-id="shared:stone-skin"]', 'contextmenu');
    expect(overlay.querySelectorAll('[data-passive-id].learned')).toHaveLength(0);
    await click(overlay, '[data-stance-id="fury"]');
    const reset = [...overlay.querySelectorAll('button')].find(
      (button) => button.textContent === 'Reset all',
    )!;
    fire(reset, 'click');
    await flush();
    expect(setLoadout).toHaveBeenLastCalledWith({ tree: {}, stance: 'bulwark' });
    expect(reset.disabled).toBe(false);
    fire(reset, 'click');
    await flush();
    expect(setLoadout).toHaveBeenLastCalledWith({ tree: {}, stance: 'bulwark' });
  });
  it('shows hover explanations in the map and distinguishes locked, unaffordable and learned roles', async () => {
    const overlay = await open(snapshotFor('water', { 'water:current:1': 1 }));
    const locked = overlay.querySelector('[data-node-id="water:current:3"]')!;
    locked.dispatchEvent(new MouseEvent('pointerenter', { clientX: 200, clientY: 350 }));
    await flush();
    expect(overlay.querySelector('[role="tooltip"]')!.textContent).toContain('Requires Millrace');
    await click(overlay, '[data-node-id="water:current:3"]');
    expect(setLoadout).not.toHaveBeenCalled();
    expect(locked.getAttribute('data-state')).toBe('Locked');
    expect(
      overlay.querySelector('[data-node-id="water:current:1"]')!.getAttribute('data-role'),
    ).toBe('offense');
    expect(overlay.querySelector('[data-stance-id="bulwark"]')!.getAttribute('data-role')).toBe(
      'defense',
    );
    expect(overlay.querySelector('[data-stance-id="gale"]')!.getAttribute('data-role')).toBe(
      'tempo',
    );
    expect(overlay.querySelector('.map-core')!.getAttribute('data-role')).toBe('elemental');
    await click(overlay, '[data-passive-id="shared:stone-skin"]');
    const unavailable = overlay.querySelector('[data-passive-id="shared:deep-roots"]')!;
    expect(unavailable.getAttribute('data-state')).toBe('Locked');
    await click(overlay, '[data-passive-id="shared:deep-roots"]');
    expect(setLoadout).not.toHaveBeenCalled();
  });
  it('allows one main passive plus a stance, refunding frees the slot and gate refunds cascade', async () => {
    const core = Object.fromEntries(
      nationNodes('water')
        .filter((n) => n.branch === 'Undertow' && n.tier <= 7)
        .map((n) => [n.id, 1]),
    );
    const snapshot = snapshotFor('water', core);
    snapshot.progress.level = 50;
    const overlay = await open(snapshot);
    await click(overlay, '[data-passive-id="shared:stone-skin"]');
    await click(overlay, '[data-stance-id="gale"]');
    expect(overlay.querySelectorAll('[data-passive-id].learned')).toHaveLength(1);
    expect(overlay.querySelector('.map-main-passive-area')!.textContent).toContain('1/1');
    expect(
      overlay.querySelector('[data-passive-id="shared:deep-roots"]')!.getAttribute('data-state'),
    ).toBe('Passive slot occupied');
    const calls = setLoadout.mock.calls.length;
    await click(overlay, '[data-passive-id="shared:deep-roots"]');
    expect(setLoadout).toHaveBeenCalledTimes(calls);
    await click(overlay, '[data-node-id="water:undertow:7"]', 'contextmenu');
    expect(overlay.querySelectorAll('[data-passive-id].learned')).toHaveLength(1);
    await click(overlay, '[data-passive-id="shared:stone-skin"]', 'contextmenu');
    expect(overlay.querySelector('.map-main-passive-area')!.textContent).toContain('0/1');
    await click(overlay, '[data-passive-id="shared:deep-roots"]');
    expect(setLoadout.mock.calls.at(-1)![0].tree['shared:deep-roots']).toBe(1);
    await click(overlay, '[data-node-id="water:undertow:6"]', 'contextmenu');
    expect(setLoadout.mock.calls.at(-1)![0].tree['shared:deep-roots']).toBe(0);
    expect(overlay.querySelectorAll('[data-passive-id].learned')).toHaveLength(0);
    expect(overlay.querySelector('[data-stance-id="gale"]')!.getAttribute('aria-pressed')).toBe(
      'true',
    );
  });
  it('serializes rapid edits and persists the newest allocation without overwriting it', async () => {
    let resolveFirst!: (value: { ok: boolean; error: null }) => void;
    setLoadout.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );
    const overlay = await open(snapshotFor('water', {}));
    await click(overlay, '[data-node-id="water:current:1"]');
    await click(overlay, '[data-node-id="water:current:2"]');
    await click(overlay, '[data-stance-id="gale"]');
    expect(setLoadout).toHaveBeenCalledTimes(1);
    expect(overlay.querySelector('.map-hud')!.textContent).toContain('Saving');
    resolveFirst({ ok: true, error: null });
    await flush();
    expect(setLoadout).toHaveBeenCalledTimes(2);
    expect(setLoadout).toHaveBeenLastCalledWith({
      stance: 'gale',
      tree: { 'water:current:1': 1, 'water:current:2': 1 },
    });
    expect(overlay.querySelectorAll('[data-stance-id].learned')).toHaveLength(1);
    expect(overlay.querySelector('.map-hud')!.textContent).toContain('Automatically saved');
  });
  it('rolls back an unsuccessful autosave visibly and permits retry', async () => {
    const overlay = await open(snapshotFor('water', {}));
    setLoadout.mockRejectedValueOnce(new Error('offline'));
    await click(overlay, '[data-node-id="water:current:1"]');
    expect(overlay.querySelectorAll('[data-node-id].learned')).toHaveLength(0);
    expect(overlay.querySelector('.map-hud')!.textContent).toContain('reverted');
    await click(overlay, '[data-node-id="water:current:1"]');
    expect(overlay.querySelectorAll('[data-node-id].learned')).toHaveLength(1);
    expect(overlay.querySelector('.map-hud')!.textContent).not.toContain('reverted');
  });
});
