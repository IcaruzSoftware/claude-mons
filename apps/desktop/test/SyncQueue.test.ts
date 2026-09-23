import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiCallError, SignedOutError, type SupabaseClient } from '../src/main/net/SupabaseClient.ts';
import { SyncQueue } from '../src/main/net/SyncQueue.ts';
import { defaultState, type LocalState } from '../src/main/persistence/state.ts';

/**
 * The signed-out state machine (docs/architecture/flows/account-linking.md#signed-out): a device
 * with a known account that loses its session must stop syncing and never silently re-create a
 * profile; only a truly fresh device keeps creating one.
 */

function makeState(patch: (s: LocalState) => void): {
  get(): LocalState;
  update(fn: (s: LocalState) => void): LocalState;
} {
  const state = defaultState();
  state.profile.nation = 'water';
  state.ledger.pending = [{ minute: 60000, prompts: 1, stops: 0, tools: {}, sessions: 1 }];
  patch(state);
  return {
    get: () => state,
    update: (fn) => {
      fn(state);
      return state;
    },
  };
}

/** Minimal SupabaseClient stand-in exposing just the surface SyncQueue calls. */
class FakeApi {
  ensureThrows: Error | null = null;
  ingestError: Error | null = null;
  createCalls = 0;
  ingestCalls = 0;

  async ensureSession(): Promise<string> {
    if (this.ensureThrows) throw this.ensureThrows;
    return 'uid-123';
  }

  async invoke<T>(name: string): Promise<T> {
    if (name === 'create-profile') {
      this.createCalls++;
      return { player: { id: 'uid-123', nickname: 'Nova', nation: 'water' }, mon: {}, created: true } as T;
    }
    this.ingestCalls++;
    if (this.ingestError) throw this.ingestError;
    return { mon: { totalXp: 0, speciesId: null, stage: 'egg' }, events: [], notifications: [] } as T;
  }
}

function makeQueue(state: ReturnType<typeof makeState>, api: FakeApi) {
  return new SyncQueue({
    api: api as unknown as SupabaseClient,
    state,
    clientVersion: '0.0.0-test',
    localXp: () => 0,
    now: () => 1_000_000,
  });
}

describe('SyncQueue signed-out state machine', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('a known account with a lost session enters signed-out and creates nothing', async () => {
    const state = makeState((s) => {
      s.profile.userId = 'uid-123';
      s.profile.nickname = 'Nova';
      s.profile.email = 'trainer@example.com';
    });
    const api = new FakeApi();
    api.ensureThrows = new SignedOutError();
    const queue = makeQueue(state, api);
    const signedout = vi.fn();
    queue.on('signedout', signedout);

    await queue.flush();

    expect(queue.isSignedOut()).toBe(true);
    expect(signedout).toHaveBeenCalledWith({ nickname: 'Nova' });
    expect(api.createCalls).toBe(0);
    // identity is preserved, not wiped
    expect(state.get().profile.userId).toBe('uid-123');
    expect(state.get().profile.email).toBe('trainer@example.com');
  });

  it('NO_PROFILE for a known account enters signed-out without clearing identity', async () => {
    const state = makeState((s) => {
      s.profile.userId = 'uid-123';
      s.profile.nickname = 'Nova';
    });
    const api = new FakeApi();
    api.ingestError = new ApiCallError(409, 'NO_PROFILE', 'no profile');
    const queue = makeQueue(state, api);
    const signedout = vi.fn();
    queue.on('signedout', signedout);

    await queue.flush();

    expect(queue.isSignedOut()).toBe(true);
    expect(signedout).toHaveBeenCalledOnce();
    expect(api.createCalls).toBe(0);
    expect(state.get().profile.userId).toBe('uid-123');
    expect(state.get().profile.nickname).toBe('Nova');
  });

  it('a fresh device (no account) still creates a profile and does not sign out', async () => {
    const state = makeState((s) => {
      s.profile.userId = null;
      s.profile.nickname = null;
      s.profile.email = null;
    });
    const api = new FakeApi();
    const queue = makeQueue(state, api);

    await queue.flush();

    expect(queue.isSignedOut()).toBe(false);
    expect(api.createCalls).toBe(1);
    expect(state.get().profile.userId).toBe('uid-123');
  });

  it('stops flushing while signed out and resumes after recovery', async () => {
    const state = makeState((s) => {
      s.profile.userId = 'uid-123';
      s.profile.nickname = 'Nova';
    });
    const api = new FakeApi();
    api.ensureThrows = new SignedOutError();
    const queue = makeQueue(state, api);

    await queue.flush();
    expect(queue.isSignedOut()).toBe(true);

    // a further flush while signed out is a no-op (no create, no ingest)
    await queue.flush();
    expect(api.createCalls).toBe(0);
    expect(api.ingestCalls).toBe(0);

    // after the player recovers, syncing works again
    api.ensureThrows = null;
    queue.resume();
    expect(queue.isSignedOut()).toBe(false);
    await queue.flush();
    expect(api.ingestCalls).toBe(1);
    queue.stop();
  });
});
