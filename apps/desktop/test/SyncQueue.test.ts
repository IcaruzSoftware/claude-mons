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

/** Records every ingest request; `reply` decides the outcome per call. */
class RecordingApi {
  requests: Array<{ batch_id: string; buckets: Array<{ minute: number; prompts: number }> }> = [];
  reply: (call: number) => unknown = () => ({
    mon: { totalXp: 0, speciesId: null, stage: 'egg' },
    events: [],
    notifications: [],
  });
  onSend: () => void = () => {};

  async ensureSession(): Promise<string> {
    return 'uid-123';
  }

  async invoke<T>(_name: string, body: unknown): Promise<T> {
    this.requests.push(JSON.parse(JSON.stringify(body)));
    this.onSend();
    const out = this.reply(this.requests.length);
    if (out instanceof Error) throw out;
    return out as T;
  }
}

function signedIn(pending: LocalState['ledger']['pending']) {
  return makeState((s) => {
    s.profile.userId = 'uid-123';
    s.profile.nickname = 'Nova';
    s.ledger.pending = pending;
  });
}

function bucketAt(minute: number, prompts = 1) {
  return { minute, prompts, stops: 0, tools: {}, sessions: 1 };
}

describe('SyncQueue batching and retry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    return () => vi.useRealTimers();
  });

  it('a retry resends the exact frozen batch; a duplicate reply keeps buckets added meanwhile', async () => {
    const state = signedIn([bucketAt(60_000)]);
    const api = new RecordingApi();
    // the server commits call 1 but the reply is lost; call 2 is answered as a duplicate
    api.reply = (call) =>
      call === 1
        ? new Error('network down')
        : {
            duplicate: true,
            mon: { totalXp: 5, speciesId: null, stage: 'egg' },
            events: [],
            notifications: [],
          };
    const queue = makeQueue(state, api as unknown as FakeApi);

    await queue.flush();
    state.get().ledger.pending.push(bucketAt(120_000));
    await queue.flush();

    expect(api.requests[1]!.batch_id).toBe(api.requests[0]!.batch_id);
    expect(api.requests[1]!.buckets).toEqual(api.requests[0]!.buckets);
    expect(state.get().ledger.pending.map((b) => b.minute)).toEqual([120_000]);
  });

  it('after a restart the persisted frozen batch is resent exactly, not a superset', async () => {
    const state = signedIn([bucketAt(60_000)]);
    const api = new RecordingApi();
    api.reply = (call) =>
      call === 1
        ? new Error('network down') // the server committed, the reply was lost
        : {
            duplicate: true,
            mon: { totalXp: 5, speciesId: null, stage: 'egg' },
            events: [],
            notifications: [],
          };
    await makeQueue(state, api as unknown as FakeApi).flush();

    // app restart: a fresh queue over the persisted state; meanwhile more events landed
    const persisted = JSON.parse(JSON.stringify(state.get())) as LocalState;
    const restarted = signedIn([]);
    Object.assign(restarted.get(), persisted);
    restarted.get().ledger.pending[0]!.prompts++;
    restarted.get().ledger.pending.push(bucketAt(120_000));
    await makeQueue(restarted, api as unknown as FakeApi).flush();

    expect(api.requests[1]!.batch_id).toBe(api.requests[0]!.batch_id);
    expect(api.requests[1]!.buckets).toEqual(api.requests[0]!.buckets);
    expect(restarted.get().ledger.pending).toEqual([
      { ...bucketAt(60_000), prompts: 1 },
      bucketAt(120_000),
    ]);
    expect(restarted.get().ledger.sentBuckets ?? null).toBeNull();
  });

  it('a rejected batch (non-429 4xx) is drained so sync does not loop on it', async () => {
    const state = signedIn([bucketAt(60_000), bucketAt(120_000)]);
    const api = new RecordingApi();
    api.reply = () => new ApiCallError(413, 'PAYLOAD_TOO_LARGE', 'too big');
    const queue = makeQueue(state, api as unknown as FakeApi);

    await queue.flush();

    expect(state.get().ledger.pending).toEqual([]);
    expect(state.get().ledger.batchId).toBeNull();
  });

  it.each([401, 403, 404, 408])(
    'a transient %i keeps the frozen batch and retries it unchanged',
    async (status) => {
      const state = signedIn([bucketAt(60_000)]);
      const api = new RecordingApi();
      api.reply = (call) =>
        call === 1
          ? new ApiCallError(status, 'GATEWAY', 'transient')
          : { mon: { totalXp: 5, speciesId: null, stage: 'egg' }, events: [], notifications: [] };
      const queue = makeQueue(state, api as unknown as FakeApi);

      await queue.flush();
      expect(state.get().ledger.pending.map((b) => b.minute)).toEqual([60_000]);
      state.get().ledger.pending.push(bucketAt(120_000));
      await queue.flush();

      expect(api.requests[1]!.batch_id).toBe(api.requests[0]!.batch_id);
      expect(api.requests[1]!.buckets).toEqual(api.requests[0]!.buckets);
      expect(state.get().ledger.pending.map((b) => b.minute)).toEqual([120_000]);
    },
  );

  it('a 400 BAD_REQUEST batch is drained too', async () => {
    const state = signedIn([bucketAt(60_000)]);
    const api = new RecordingApi();
    api.reply = () => new ApiCallError(400, 'BAD_REQUEST', 'bad');
    const queue = makeQueue(state, api as unknown as FakeApi);

    await queue.flush();

    expect(state.get().ledger.pending).toEqual([]);
  });

  it('keeps a batch under the server body limit even when buckets carry many long tool names', async () => {
    const tools: Record<string, number> = {};
    for (let i = 0; i < 10; i++) tools[`mcp__some_long_server_name__some_long_tool_name_${i}`] = 1;
    const state = signedIn(
      Array.from({ length: 180 }, (_, i) => ({ ...bucketAt((i + 1) * 60_000), tools })),
    );
    const api = new RecordingApi();
    const queue = makeQueue(state, api as unknown as FakeApi);

    await queue.flush();

    expect(Buffer.byteLength(JSON.stringify(api.requests[0]))).toBeLessThan(64 * 1024);
    expect(api.requests[0]!.buckets.length).toBeGreaterThan(0);
  });

  it('sends the oldest buckets first', async () => {
    const state = signedIn(Array.from({ length: 200 }, (_, i) => bucketAt((200 - i) * 60_000)));
    const api = new RecordingApi();
    const queue = makeQueue(state, api as unknown as FakeApi);

    await queue.flush();

    const minutes = api.requests[0]!.buckets.map((b) => b.minute);
    expect(minutes.length).toBe(180);
    expect(minutes[0]).toBe(60_000);
    expect(minutes[179]).toBe(180 * 60_000);
  });

  it('keeps events that landed in an already-sent past minute while the batch was in flight', async () => {
    const state = signedIn([bucketAt(60_000)]);
    const api = new RecordingApi();
    // a spooled event for the same (past) minute arrives during the request
    api.onSend = () => state.get().ledger.pending[0]!.prompts++;
    const queue = makeQueue(state, api as unknown as FakeApi);

    await queue.flush();

    expect(state.get().ledger.pending).toEqual([{ ...bucketAt(60_000), prompts: 1 }]);
  });
});
