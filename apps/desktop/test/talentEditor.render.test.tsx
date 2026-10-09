// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import {
  NATIONS,
  TREE_NODES,
  speciesForNation,
  speciesOf,
  treeNodesFor,
  type Move,
  type Nation,
} from '@claude-mons/shared';
import type { UiSnapshot } from '../src/common/ipc.ts';
import { BattlesView } from '../src/renderer/panel/views/Battles.tsx';
import { treeNodeInertNote } from '../src/renderer/panel/views/SkillTree.tsx';

// A saved tree for `nation` that fills the centre route of tiers 1-4 of the first branch plus one
// shared passive.
function savedTree(nation: Nation): Record<string, number> {
  const nodes = treeNodesFor(nation);
  const firstBranch = nodes[0]!.branch;
  const col = nodes.filter((n) => n.branch === firstBranch && !n.choiceOffset);
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
  expect([...container.querySelectorAll('button')].at(-1)!.classList.contains('skill-entry')).toBe(
    true,
  );
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
  render(
    h(BattlesView, {
      s: {
        ...s,
        battles: { ...s.battles, history: [{ ...old, xp: 0, practice: true }] },
      },
    }),
    container,
  );
  await flush();
  const top = container.querySelector('[data-battle-id] .top')!.textContent!;
  expect(top).toContain('WON Practice');
  expect(top).not.toContain('XP');
});

it('normalizes old talents on the next automatic skill edit', async () => {
  render(
    h(BattlesView, { s: snapshotFor('water', { 'strike:1': 3, 'water:current:1': 1 }) }),
    container,
  );
  await flush();
  fire(container.querySelector('.skill-entry')!, 'click');
  await flush();
  fire(container.querySelector('[data-node-id="strike:2"]')!, 'click');
  await flush();
  expect(setLoadout).toHaveBeenCalledWith({
    stance: 'bulwark',
    tree: { 'strike:1': 1, 'strike:2': 1 },
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
        expect(overlay.querySelectorAll('[data-node-id]')).toHaveLength(85);
        expect(overlay.querySelectorAll('[data-passive-id]')).toHaveLength(10);
        expect(overlay.querySelectorAll('[data-stance-id]')).toHaveLength(3);
        expect(overlay.querySelectorAll('.map-branch-label')).toHaveLength(5);
        expect(overlay.querySelector('.skill-detail, .map-toolbar, .skill-footer')).toBeNull();
        expect(
          [...overlay.querySelectorAll('button')].some((button) => button.textContent === 'Save'),
        ).toBe(false);
        expect(overlay.textContent).not.toContain('Planned');
      });
    }
  }
  it('shows only the own nation column, five named arms and the nation trait at the core', async () => {
    for (const nation of NATIONS) {
      const overlay = await open(snapshotFor(nation, {}));
      const ids = [...overlay.querySelectorAll('[data-node-id]')].map((e) =>
        e.getAttribute('data-node-id'),
      );
      expect(ids.filter((id) => id!.startsWith('nation.'))).toHaveLength(17);
      expect(
        ids.every((id) => !id!.startsWith('nation.') || id!.startsWith(`nation.${nation}:`)),
      ).toBe(true);
      const labels = [...overlay.querySelectorAll('.map-branch-label')].map((e) => e.textContent);
      expect(labels.slice(0, 4)).toEqual([
        'BastionPassive',
        'StrikeOffense',
        'WardDefense',
        'TempoOrder',
      ]);
      expect(labels[4]).toContain(`${nation[0]!.toUpperCase()}${nation.slice(1)} column`);
      expect(overlay.querySelector('[data-node-id="ward:1"]')!.getAttribute('data-role')).toBe(
        'defense',
      );
      expect(overlay.querySelector('[data-node-id="tempo:1"]')!.getAttribute('data-role')).toBe(
        'tempo',
      );
      expect(
        overlay.querySelector(`[data-node-id="nation.${nation}:1"]`)!.getAttribute('data-role'),
      ).toBe('elemental');
      expect(overlay.querySelector('[data-node-id="bastion:1"]')!.classList).toContain(
        'map-passive',
      );
      const core = overlay.querySelector('.map-core')!;
      expect(core.textContent).not.toContain('Flow');
      core.dispatchEvent(new MouseEvent('pointerenter', { clientX: 200, clientY: 350 }));
      await flush();
      const tip = overlay.querySelector('[role="tooltip"]')!.textContent!;
      expect(tip).not.toMatch(/Flow|Quick Setup/);
      render(null, container);
    }
  });
  it('keeps the tier-3 fork exclusive and explains trigger and cap in the tooltip', async () => {
    const snapshot = snapshotFor('water', { 'strike:1': 1, 'strike:2': 1 });
    const overlay = await open(snapshot);
    await click(overlay, '[data-node-id="strike:3:alt"]');
    expect(setLoadout.mock.calls.at(-1)![0].tree['strike:3:alt']).toBe(1);
    expect(overlay.querySelector('[data-node-id="strike:3"]')!.getAttribute('data-state')).toBe(
      'Alternative chosen',
    );
    const calls = setLoadout.mock.calls.length;
    await click(overlay, '[data-node-id="strike:3"]');
    expect(setLoadout).toHaveBeenCalledTimes(calls);
    await click(overlay, '[data-node-id="strike:4"]');
    expect(setLoadout.mock.calls.at(-1)![0].tree['strike:4']).toBe(1);
    await click(overlay, '[data-node-id="strike:3:alt"]', 'contextmenu');
    expect(setLoadout.mock.calls.at(-1)![0].tree).toMatchObject({
      'strike:3:alt': 0,
      'strike:4': 0,
      'strike:1': 1,
    });
    overlay
      .querySelector('[data-node-id="ward:1"]')!
      .dispatchEvent(new MouseEvent('pointerenter', { clientX: 200, clientY: 350 }));
    await flush();
    const tip = overlay.querySelector('[role="tooltip"]')!.textContent!;
    expect(tip).toContain(TREE_NODES['ward:1']!.description);
    expect(tip).toContain('1 skill point ·');
    expect(tip).toContain('Crit roll · Once per battle');
  });
  it('marks a node inert until the species unlocks the Burn or DEF-down move it needs', async () => {
    const snapshot = snapshotFor('water', {});
    const bubblit = speciesOf('bubblit');
    snapshot.pet.speciesId = 'bubblit';
    snapshot.progress.level = 12;
    snapshot.battles.unlockedMoveIds = bubblit.movePool
      .filter((m) => m.unlocksAt <= 12)
      .map((m) => m.id);
    snapshot.battles.loadout.moves = snapshot.battles.unlockedMoveIds.slice(0, 3);
    const overlay = await open(snapshot);
    const opening = overlay.querySelector('[data-node-id="tempo:1"]')!;
    expect(opening.getAttribute('data-inert')).toBe('true');
    expect(overlay.querySelector('[data-node-id="ward:1"]')!.hasAttribute('data-inert')).toBe(
      false,
    );
    opening.dispatchEvent(new MouseEvent('pointerenter', { clientX: 200, clientY: 350 }));
    await flush();
    expect(overlay.querySelector('.map-inert-note')!.textContent).toBe(
      'Needs a Burn or DEF-down move, unlocks at level 15',
    );
    expect(opening.getAttribute('aria-label')).toContain('Inactive: Needs a Burn or DEF-down move');
    expect(
      overlay.querySelector('[data-node-id="strike:7:left"]')!.getAttribute('aria-label'),
    ).toContain('Inactive: Needs a DEF-down move');
  });
  it('adopts the server-normalized tree after a confirmed save', async () => {
    setLoadout.mockResolvedValueOnce({
      ok: true,
      error: null,
      loadout: { tree: { 'ward:1': 1, 'ward:2': 1 } },
    });
    const overlay = await open(snapshotFor('water', {}));
    await click(overlay, '[data-node-id="ward:1"]');
    expect(overlay.querySelector('[data-node-id="ward:2"]')!.getAttribute('data-state')).toBe(
      'Learned',
    );
  });
  it('names the lowest unlock level when the move pool is not sorted by level', () => {
    const pool = [
      { effect: 'burn', unlocksAt: 20 },
      { effect: 'def_down', unlocksAt: 15 },
      { effect: 'burn', unlocksAt: 12 },
    ] as unknown as Move[];
    expect(treeNodeInertNote(TREE_NODES['tempo:1']!, pool, 4, [])).toBe(
      'Needs a Burn or DEF-down move, unlocks at level 12',
    );
    expect(treeNodeInertNote(TREE_NODES['tempo:1']!, pool, 12, [])).toBeNull();
  });
  it('describes a conditional always-on rule by its condition', async () => {
    const overlay = await open(snapshotFor('water', {}));
    overlay
      .querySelector('[data-node-id="bastion:2"]')!
      .dispatchEvent(new MouseEvent('pointerenter', { clientX: 200, clientY: 350 }));
    await flush();
    expect(overlay.querySelector('[role="tooltip"]')!.textContent).toContain(
      'Dodge roll · While its condition holds',
    );
  });
  it('draws shared and nation nodes from one point pool', async () => {
    const snapshot = snapshotFor('water', {});
    snapshot.progress.level = 4;
    const overlay = await open(snapshot);
    expect(overlay.querySelector('.map-hud b')!.textContent).toBe('1 skill point');
    expect(overlay.querySelector('[data-node-id="strike:1"]')!.getAttribute('data-state')).toBe(
      'Available',
    );
    await click(overlay, '[data-node-id="nation.water:1"]');
    expect(overlay.querySelector('.map-hud b')!.textContent).toBe('0 skill points');
    expect(overlay.querySelector('[data-node-id="strike:1"]')!.getAttribute('data-state')).toBe(
      'Not enough points',
    );
  });
  it('draws both tier-4 prerequisite edges and lights only the owned fork alternative', async () => {
    const overlay = await open(
      snapshotFor('water', { 'strike:1': 1, 'strike:2': 1, 'strike:3:alt': 1 }),
    );
    const edges = [...overlay.querySelectorAll('[data-edge-id="strike:4"]')];
    expect(edges).toHaveLength(2);
    expect(edges.filter((e) => e.classList.contains('available'))).toHaveLength(1);
    expect(edges.filter((e) => e.classList.contains('gated'))).toHaveLength(1);
    await click(overlay, '[data-node-id="strike:4"]');
    expect(overlay.querySelectorAll('[data-edge-id="strike:4"].learned')).toHaveLength(1);
  });
  it('marks fire and water column nodes inert without a nation-type move in the loadout', () => {
    const fire = speciesForNation('fire')[0]!;
    const neutral = fire.movePool.filter((m) => m.type === 'neutral');
    const nationMove = fire.movePool.find((m) => m.type === 'nation')!;
    for (const id of ['nation.water:1', 'nation.fire:3'])
      expect(treeNodeInertNote(TREE_NODES[id]!, fire.movePool, 50, neutral)).toMatch(
        /^Needs a nation-type move in your loadout/,
      );
    expect(treeNodeInertNote(TREE_NODES['nation.fire:1']!, fire.movePool, 50, neutral)).toMatch(
      /nation-type, Burn or DEF-down move/,
    );
    expect(treeNodeInertNote(TREE_NODES['nation.fire:4']!, fire.movePool, 50, neutral)).toMatch(
      /nation-type or Burn move/,
    );
    const defDown = { ...neutral[0]!, effect: 'def_down' as const };
    expect(
      treeNodeInertNote(TREE_NODES['nation.fire:1']!, fire.movePool, 50, [defDown]),
    ).toBeNull();
    expect(
      treeNodeInertNote(TREE_NODES['nation.fire:9']!, fire.movePool, 50, [nationMove]),
    ).toMatch(/Burn or DEF-down move/);
    for (const id of [
      'nation.fire:6',
      'nation.fire:7',
      'nation.fire:10',
      'nation.fire:12',
      'nation.water:6',
      'nation.water:10',
    ])
      expect(treeNodeInertNote(TREE_NODES[id]!, fire.movePool, 50, neutral)).toBeNull();
    expect(
      treeNodeInertNote(TREE_NODES['nation.water:1']!, fire.movePool, 50, [nationMove]),
    ).toBeNull();
    expect(treeNodeInertNote(TREE_NODES['nation.earth:1']!, fire.movePool, 50, neutral)).toBeNull();
  });
  it('keeps the rebuilt-tree notice when the first save fails', async () => {
    setLoadout.mockResolvedValueOnce({ ok: false, error: 'Rejected' });
    const overlay = await open(snapshotFor('water', { 'water:current:1': 1 }));
    await click(overlay, '[data-node-id="ward:1"]');
    const hud = overlay.querySelector('.map-hud')!.textContent!;
    expect(hud).toContain('Your talent tree was rebuilt');
    expect(hud).toContain('Rejected. Unsaved changes were reverted');
  });
  it('keeps an unconfirmed save and shows its warning instead of an error', async () => {
    const warning = 'Saved on this device. The server has not confirmed it yet.';
    setLoadout.mockResolvedValueOnce({ ok: true, unconfirmed: true, warning });
    const overlay = await open(snapshotFor('water', {}));
    await click(overlay, '[data-node-id="ward:1"]');
    const hud = overlay.querySelector('.map-hud')!.textContent!;
    expect(hud).toContain(warning);
    expect(hud).toContain('Change any skill again once you are online to sync it.');
    expect(hud).not.toContain('reverted');
    expect(overlay.querySelectorAll('[data-node-id].learned')).toHaveLength(1);
    // The kept change is the confirmed base: a later rejection reverts only past it.
    setLoadout.mockResolvedValueOnce({ ok: false, error: warning });
    await click(overlay, '[data-node-id="ward:2"]');
    expect(overlay.querySelector('[data-node-id="ward:1"]')!.getAttribute('data-state')).toBe(
      'Learned',
    );
    expect(overlay.querySelector('[data-node-id="ward:2"]')!.getAttribute('data-state')).not.toBe(
      'Learned',
    );
    expect(overlay.querySelector('.map-hud')!.textContent).toContain(
      'confirmed it yet. Unsaved changes were reverted',
    );
    expect(overlay.querySelector('.map-hud')!.textContent).not.toContain('yet..');
  });
  it('shows an unconfirmed move save as a warning', async () => {
    const warning = 'Saved on this device. The server has not confirmed it yet.';
    setLoadout.mockResolvedValueOnce({ ok: true, unconfirmed: true, warning });
    render(h(BattlesView, { s: snapshotFor('water', {}) }), container);
    await flush();
    const first = container.querySelector<HTMLSelectElement>('.mv-select')!;
    first.value = [...first.options].find((o) => !o.disabled && o.value !== first.value)!.value;
    fire(first, 'change');
    await flush();
    fire(
      [...container.querySelectorAll('button')].find((b) => b.textContent === 'Save')!,
      'click',
    );
    await flush();
    expect(container.textContent).toContain(warning);
    expect(container.textContent).toContain('Press Save again once you are online.');
    expect(container.querySelector('.loadout-error')).toBeNull();
  });
  it('shows the rebuilt-tree notice once, until the first skill edit', async () => {
    const legacy = snapshotFor('water', { 'water:current:1': 1 });
    render(h(BattlesView, { s: legacy }), container);
    await flush();
    const notice =
      'Your talent tree was rebuilt for the new branches. Some saved skills no longer exist and were removed; their points are back in your pool.';
    expect(container.textContent).toContain(notice);
    fire(container.querySelector('.skill-entry')!, 'click');
    await flush();
    expect(container.querySelector('.map-hud')!.textContent).toContain(notice);
    await click(container, '[data-node-id="ward:1"]');
    expect(container.textContent).not.toContain(notice);
    render(null, container);
    const flagged = snapshotFor('water', {});
    flagged.battles.treeLegacyReset = true;
    render(h(BattlesView, { s: flagged }), container);
    await flush();
    expect(container.textContent).toContain(notice);
    render(null, container);
    render(h(BattlesView, { s: snapshotFor('water', savedTree('water')) }), container);
    await flush();
    expect(container.textContent).not.toContain(notice);
  });
  it('learns once on left click, autosaves without moves and keeps attack drafts', async () => {
    const overlay = await open(snapshotFor('water', {}));
    const select = container.querySelector<HTMLSelectElement>('.mv-select')!;
    const replacement = [...select.options].find(
      (option) => !option.disabled && option.value !== select.value,
    )!.value;
    select.value = replacement;
    fire(select, 'change');
    await flush();
    await click(overlay, '[data-node-id="tempo:1"]');
    expect(setLoadout).toHaveBeenLastCalledWith({ tree: { 'tempo:1': 1 }, stance: 'bulwark' });
    expect(overlay.querySelector('[data-node-id="tempo:1"]')!.getAttribute('data-state')).toBe(
      'Learned',
    );
    await click(overlay, '[data-node-id="tempo:1"]');
    expect(setLoadout).toHaveBeenCalledTimes(1);
    expect(select.value).toBe(replacement);
    await click(overlay, '[aria-label="Close Skill Tree"]');
    expect(container.querySelector('.skill-overlay')).toBeNull();
    expect(setLoadout).toHaveBeenCalledTimes(1);
  });
  it('refunds actual prerequisites on right click and resets every skill at any time', async () => {
    const overlay = await open(
      snapshotFor('water', { 'tempo:1': 1, 'tempo:2': 1, 'shared:stone-skin': 1 }),
    );
    await click(overlay, '[data-node-id="tempo:1"]', 'contextmenu');
    expect(overlay.querySelectorAll('[data-node-id].learned')).toHaveLength(0);
    expect(setLoadout.mock.calls.at(-1)![0].tree['tempo:2']).toBe(0);
    await click(overlay, '[data-passive-id="shared:stone-skin"]', 'contextmenu');
    expect(overlay.querySelectorAll('[data-passive-id].learned')).toHaveLength(0);
    await click(overlay, '[data-stance-id="fury"]');
    const reset = [...overlay.querySelectorAll('button')].find(
      (button) => button.textContent === 'Reset all',
    )!;
    fire(reset, 'click');
    await flush();
    expect(setLoadout).toHaveBeenLastCalledWith({ tree: {}, stance: null });
    expect(reset.disabled).toBe(false);
    fire(reset, 'click');
    await flush();
    expect(setLoadout).toHaveBeenLastCalledWith({ tree: {}, stance: null });
  });
  it('shows hover explanations in the map and distinguishes locked, unaffordable and learned roles', async () => {
    const overlay = await open(snapshotFor('water', { 'strike:1': 1 }));
    const locked = overlay.querySelector('[data-node-id="strike:3"]')!;
    locked.dispatchEvent(new MouseEvent('pointerenter', { clientX: 200, clientY: 350 }));
    await flush();
    expect(overlay.querySelector('[role="tooltip"]')!.textContent).toContain(
      'Requires Opening Volley',
    );
    await click(overlay, '[data-node-id="strike:3"]');
    expect(setLoadout).not.toHaveBeenCalled();
    expect(locked.getAttribute('data-state')).toBe('Locked');
    expect(overlay.querySelector('[data-node-id="strike:1"]')!.getAttribute('data-role')).toBe(
      'offense',
    );
    expect(overlay.querySelector('[data-stance-id="bulwark"]')!.getAttribute('data-role')).toBe(
      'defense',
    );
    expect(overlay.querySelector('[data-stance-id="gale"]')!.getAttribute('data-role')).toBe(
      'tempo',
    );
    expect(overlay.querySelector('.map-core')!.getAttribute('data-role')).toBe('elemental');
    const unavailable = overlay.querySelector('[data-passive-id="shared:deep-roots"]')!;
    expect(unavailable.getAttribute('data-state')).toBe('Available');
    await click(overlay, '[data-passive-id="shared:deep-roots"]');
    expect(setLoadout.mock.calls.at(-1)![0].tree['shared:deep-roots']).toBe(1);
  });
  it('allows one independent main passive plus a stance and refunds free its slot', async () => {
    const core = Object.fromEntries(
      treeNodesFor('water')
        .filter((n) => n.branch === 'ward' && n.tier <= 7 && !n.choiceOffset)
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
    await click(overlay, '[data-node-id="ward:7"]', 'contextmenu');
    expect(overlay.querySelectorAll('[data-passive-id].learned')).toHaveLength(1);
    await click(overlay, '[data-passive-id="shared:stone-skin"]', 'contextmenu');
    expect(overlay.querySelector('.map-main-passive-area')!.textContent).toContain('0/1');
    await click(overlay, '[data-passive-id="shared:deep-roots"]');
    expect(setLoadout.mock.calls.at(-1)![0].tree['shared:deep-roots']).toBe(1);
    await click(overlay, '[data-node-id="ward:6"]', 'contextmenu');
    expect(setLoadout.mock.calls.at(-1)![0].tree['shared:deep-roots']).toBe(1);
    expect(overlay.querySelectorAll('[data-passive-id].learned')).toHaveLength(1);
    expect(overlay.querySelector('[data-stance-id="gale"]')!.getAttribute('aria-pressed')).toBe(
      'true',
    );
  });
  it('offers three real alternatives, follows the chosen edge and refunds to switch', async () => {
    const core = Object.fromEntries(
      treeNodesFor('water')
        .filter((n) => n.branch === 'strike' && n.tier <= 6 && !n.choiceOffset)
        .map((n) => [n.id, 1]),
    );
    const snapshot = snapshotFor('water', core);
    snapshot.progress.level = 50;
    const overlay = await open(snapshot);
    for (const suffix of ['', ':left', ':right'])
      expect(
        overlay.querySelector(`[data-node-id="strike:7${suffix}"]`)!.getAttribute('data-state'),
      ).toBe('Available');
    await click(overlay, '[data-node-id="strike:7:left"]');
    expect(overlay.querySelector('[data-node-id="strike:7"]')!.getAttribute('data-state')).toBe(
      'Alternative chosen',
    );
    const calls = setLoadout.mock.calls.length;
    await click(overlay, '[data-node-id="strike:7:right"]');
    expect(setLoadout).toHaveBeenCalledTimes(calls);
    await click(overlay, '[data-node-id="strike:8"]');
    expect(overlay.querySelectorAll('[data-edge-id="strike:8"].learned')).toHaveLength(1);
    expect(overlay.querySelectorAll('[data-edge-id="strike:8"].gated')).toHaveLength(2);
    await click(overlay, '[data-node-id="strike:7:left"]', 'contextmenu');
    expect(setLoadout.mock.calls.at(-1)![0].tree['strike:8']).toBe(0);
    await click(overlay, '[data-node-id="strike:7:right"]');
    expect(setLoadout.mock.calls.at(-1)![0].tree['strike:7:right']).toBe(1);
    expect(overlay.querySelector('[data-node-id="strike:8"]')!.getAttribute('data-state')).toBe(
      'Available',
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
    await click(overlay, '[data-node-id="strike:1"]');
    await click(overlay, '[data-node-id="strike:2"]');
    await click(overlay, '[data-stance-id="gale"]');
    expect(setLoadout).toHaveBeenCalledTimes(1);
    expect(overlay.querySelector('.map-hud')!.textContent).toContain('Saving');
    resolveFirst({ ok: true, error: null });
    await flush();
    expect(setLoadout).toHaveBeenCalledTimes(2);
    expect(setLoadout).toHaveBeenLastCalledWith({
      stance: 'gale',
      tree: { 'strike:1': 1, 'strike:2': 1 },
    });
    expect(overlay.querySelectorAll('[data-stance-id].learned')).toHaveLength(1);
    expect(overlay.querySelector('.map-hud')!.textContent).toContain('Automatically saved');
  });
  it('rolls back an unsuccessful autosave visibly and permits retry', async () => {
    const overlay = await open(snapshotFor('water', {}));
    setLoadout.mockRejectedValueOnce(new Error('offline'));
    await click(overlay, '[data-node-id="strike:1"]');
    expect(overlay.querySelectorAll('[data-node-id].learned')).toHaveLength(0);
    expect(overlay.querySelector('.map-hud')!.textContent).toContain('reverted');
    await click(overlay, '[data-node-id="strike:1"]');
    expect(overlay.querySelectorAll('[data-node-id].learned')).toHaveLength(1);
    expect(overlay.querySelector('.map-hud')!.textContent).not.toContain('reverted');
  });
});
