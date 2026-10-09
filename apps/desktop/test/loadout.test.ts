import { describe, expect, it } from 'vitest';
import type { SetLoadoutResponse } from '@claude-mons/shared';
import { createLoadoutSaver, normalizeLocalTree, saveLoadout } from '../src/main/game/loadout.ts';
import { ApiCallError } from '../src/main/net/SupabaseClient.ts';
import { defaultState, type LocalState } from '../src/main/persistence/state.ts';

function access(state: LocalState) {
  return {
    get: () => state,
    update(fn: (s: LocalState) => void) {
      fn(state);
      return state;
    },
  };
}

function hatched(): LocalState {
  const state = defaultState();
  state.profile.nation = 'fire';
  state.pet.speciesId = 'sparkit';
  state.progress.stage = 'baby';
  return state;
}

describe('normalizeLocalTree', () => {
  it('rebuilds a stored v13 tree and raises the legacy-reset flag', () => {
    const state = hatched();
    state.loadout.tree = { 'fire:flow:1': 1, 'strike:1': 2 };
    normalizeLocalTree(state);
    expect(state.loadout.tree).toEqual({ 'strike:1': 1 });
    expect(state.loadout.treeLegacyReset).toBe(true);
  });

  it('leaves a valid tree and an absent flag alone', () => {
    const state = hatched();
    state.loadout.tree = { 'strike:1': 1 };
    normalizeLocalTree(state);
    expect(state.loadout.tree).toEqual({ 'strike:1': 1 });
    expect(state.loadout.treeLegacyReset).toBeUndefined();
  });
});

describe('saveLoadout', () => {
  const response = (loadout: SetLoadoutResponse['loadout'] = {}) =>
    ({ loadout, mon: { lastRespecAt: null, loadout } }) as unknown as SetLoadoutResponse;

  it('rolls back to the previous loadout when the server rejects the save', async () => {
    const state = hatched();
    state.loadout.tree = { 'strike:1': 1 };
    const res = await saveLoadout(
      {
        state: access(state),
        level: () => 5,
        invoke: () =>
          Promise.reject(new ApiCallError(400, 'BAD_REQUEST', 'only 0 available at level 3')),
        onChange: () => {},
      },
      { tree: { 'strike:1': 1, 'strike:2': 1 } },
    );
    expect(res).toEqual({ ok: false, error: 'BAD_REQUEST: only 0 available at level 3' });
    expect(state.loadout.tree).toEqual({ 'strike:1': 1 });
  });

  it('lets the server level catch up before it validates', async () => {
    const calls: string[] = [];
    const state = hatched();
    await saveLoadout(
      {
        state: access(state),
        level: () => 5,
        flush: async () => void calls.push('flush'),
        invoke: async () => (calls.push('invoke'), response({ stance: 'fury' })),
        onChange: () => {},
      },
      { stance: 'fury' },
    );
    expect(calls).toEqual(['flush', 'invoke']);
  });

  it('clears the legacy-reset flag once a tree is saved', async () => {
    const state = hatched();
    state.loadout.treeLegacyReset = true;
    await saveLoadout(
      { state: access(state), level: () => 5, invoke: null, onChange: () => {} },
      { stance: 'gale' },
    );
    expect(state.loadout.treeLegacyReset).toBe(true);
    const res = await saveLoadout(
      {
        state: access(state),
        level: () => 5,
        invoke: async () => response({ stance: 'gale', tree: { 'strike:1': 1 } }),
        onChange: () => {},
      },
      { tree: { 'strike:1': 1 } },
    );
    expect(res.ok).toBe(true);
    expect(state.loadout.tree).toEqual({ 'strike:1': 1 });
    expect(state.loadout.treeLegacyReset).toBeUndefined();
  });

  it('keeps the local change and explains when the server could not be reached', async () => {
    const state = hatched();
    const res = await saveLoadout(
      {
        state: access(state),
        level: () => 5,
        invoke: () => Promise.reject(new TypeError('fetch failed')),
        onChange: () => {},
      },
      { stance: 'fury' },
    );
    expect(state.loadout.stance).toBe('fury');
    expect(res).toEqual({
      ok: true,
      error: null,
      unconfirmed: true,
      warning: 'Saved on this device. The server has not confirmed it yet.',
    });
  });

  it('keeps the change after a server error (5xx), since the server may have stored it', async () => {
    const state = hatched();
    const res = await saveLoadout(
      {
        state: access(state),
        level: () => 5,
        invoke: () => Promise.reject(new ApiCallError(502, 'HTTP_502', 'bad gateway')),
        onChange: () => {},
      },
      { stance: 'gale' },
    );
    expect(state.loadout.stance).toBe('gale');
    expect(res).toMatchObject({ ok: true, unconfirmed: true });
  });

  it("adopts the server's loadout on success", async () => {
    const state = hatched();
    const res = await saveLoadout(
      {
        state: access(state),
        level: () => 5,
        invoke: async () =>
          response({ stance: 'fury', moves: ['a', 'b', 'c'], tree: { 'strike:1': 1 } }),
        onChange: () => {},
      },
      { stance: 'fury' },
    );
    expect(state.loadout).toMatchObject({
      stance: 'fury',
      moves: ['a', 'b', 'c'],
      tree: { 'strike:1': 1 },
    });
    expect(res.loadout).toEqual({
      stance: 'fury',
      moves: ['a', 'b', 'c'],
      tree: { 'strike:1': 1 },
    });
  });

  it('does not roll back over a profile adopted while the save was in flight', async () => {
    const state = hatched();
    const res = await saveLoadout(
      {
        state: access(state),
        level: () => 5,
        invoke: async () => {
          state.loadout = { stance: 'bulwark', tree: { 'ward:1': 1 }, lastRespecAt: null };
          throw new ApiCallError(400, 'BAD_REQUEST', 'rejected');
        },
        onChange: () => {},
      },
      { stance: 'fury' },
    );
    expect(res.ok).toBe(false);
    expect(state.loadout).toEqual({ stance: 'bulwark', tree: { 'ward:1': 1 }, lastRespecAt: null });
  });
});

describe('createLoadoutSaver', () => {
  it('runs saves one after another, so an older rollback never overwrites a newer save', async () => {
    const state = hatched();
    const order: string[] = [];
    let rejectFirst!: (err: unknown) => void;
    const save = createLoadoutSaver({
      state: access(state),
      level: () => 5,
      invoke: (payload) => {
        order.push(`invoke ${payload.stance}`);
        if (payload.stance === 'fury') return new Promise((_, reject) => (rejectFirst = reject));
        return Promise.resolve({
          loadout: { stance: 'gale' },
          mon: { lastRespecAt: null, loadout: { stance: 'gale' } },
        } as unknown as SetLoadoutResponse);
      },
      onChange: () => {},
    });
    const first = save({ stance: 'fury' });
    const second = save({ stance: 'gale' });
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(['invoke fury']);
    rejectFirst(new ApiCallError(400, 'BAD_REQUEST', 'rejected'));
    expect((await first).ok).toBe(false);
    expect((await second).ok).toBe(true);
    expect(order).toEqual(['invoke fury', 'invoke gale']);
    expect(state.loadout.stance).toBe('gale');
  });
});
