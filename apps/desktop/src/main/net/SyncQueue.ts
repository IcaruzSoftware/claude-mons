import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  BattleNotification,
  CreateProfileRequest,
  CreateProfileResponse,
  IngestEvent,
  IngestXpRequest,
  IngestXpResponse,
  MinuteBucket,
  MonState,
  Nation,
} from '@claude-mons/shared';
import type { LocalState } from '../persistence/state.ts';
import { ApiCallError, SignedOutError, type SupabaseClient } from './SupabaseClient.ts';

export interface SyncEvents {
  /** the server acknowledged a batch */
  synced: [
    {
      mon: MonState;
      events: IngestEvent[];
      notifications: BattleNotification[];
      localXpAtSend: number;
    },
  ];
  profile: [{ nickname: string; nation: Nation; userId: string }];
  status: [SyncStatus];
  /** A known account lost its session: sync has stopped; the UI must offer sign-in / start-fresh. */
  signedout: [{ nickname: string | null }];
}

export interface SyncStatus {
  connected: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
  needsNation: boolean;
}

export interface SyncQueueDeps {
  api: SupabaseClient;
  state: { get(): LocalState; update(fn: (s: LocalState) => void): LocalState };
  clientVersion: string;
  /** current local XP (server + provisional), captured when a batch is sent */
  localXp: () => number;
  now?: () => number;
}

const INTERVAL_MS = 60_000;
const AFTER_STOP_MS = 5_000;
const MAX_BUCKETS = 180;
/** ingest-xp rejects bodies above 64 KiB; leave room for the request envelope */
const MAX_BATCH_BYTES = 60_000;
const BACKOFF_MIN_MS = 5_000;
const BACKOFF_MAX_MS = 5 * 60_000;

/**
 * Sends pending minute buckets to `ingest-xp` and creates the profile on first contact.
 * Idempotent per batch (a retry resends the identical frozen batch under the same batch_id),
 * exponential backoff on failure.
 */
export class SyncQueue extends EventEmitter<SyncEvents> {
  private timer: NodeJS.Timeout | null = null;
  private stopTimer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private signedOut = false;
  private backoffMs = BACKOFF_MIN_MS;
  private status: SyncStatus = {
    connected: false,
    lastSyncAt: null,
    lastError: null,
    needsNation: false,
  };

  constructor(private readonly deps: SyncQueueDeps) {
    super();
    this.status.lastSyncAt = deps.state.get().ledger.lastSyncAt;
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  /** True while this device is in the signed-out state (known account, no valid session). */
  isSignedOut(): boolean {
    return this.signedOut;
  }

  /**
   * Leave the signed-out state and resume syncing. Called after the player signs back in
   * (`App.adoptProfile`) or explicitly starts fresh (`App.startFresh`).
   */
  resume(): void {
    if (!this.signedOut) return;
    this.signedOut = false;
    this.start();
  }

  /**
   * Stop syncing without clearing local identity: a known account lost its session. The local XP
   * ledger keeps buffering; the player recovers by signing in again or starting fresh.
   */
  private enterSignedOut(): void {
    if (this.signedOut) return;
    this.signedOut = true;
    this.stop();
    this.setStatus({ connected: false });
    this.emit('signedout', { nickname: this.deps.state.get().profile.nickname });
  }

  start(): void {
    this.timer = setInterval(() => void this.flush(), INTERVAL_MS);
    setTimeout(() => void this.flush(), 2_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.timer = null;
    this.stopTimer = null;
  }

  /** A turn finished: sync soon so the server sees it. */
  scheduleSoon(): void {
    if (this.stopTimer) return;
    this.stopTimer = setTimeout(() => {
      this.stopTimer = null;
      void this.flush();
    }, AFTER_STOP_MS);
  }

  /** Create (or update) the server profile. Returns null when the server rejected the request. */
  async ensureProfile(req: CreateProfileRequest): Promise<CreateProfileResponse | null> {
    if (this.signedOut) return null;
    try {
      const userId = await this.deps.api.ensureSession();
      const res = await this.deps.api.invoke<CreateProfileResponse>('create-profile', req);
      this.deps.state.update((s) => {
        s.profile.userId = userId;
        s.profile.nickname = res.player.nickname;
        if (!s.profile.nation) s.profile.nation = res.player.nation;
      });
      this.emit('profile', { nickname: res.player.nickname, nation: res.player.nation, userId });
      this.setStatus({ connected: true, lastError: null, needsNation: false });
      return res;
    } catch (err) {
      if (err instanceof SignedOutError) {
        this.enterSignedOut();
        return null;
      }
      this.setStatus({ connected: false, lastError: describe(err) });
      if (err instanceof ApiCallError && err.status < 500) throw err;
      return null;
    }
  }

  /** Send everything pending. Safe to call often; concurrent calls coalesce. */
  async flush(): Promise<void> {
    if (this.inFlight || this.signedOut) return;
    const s = this.deps.state.get();
    if (!s.profile.nation) {
      this.setStatus({ needsNation: true });
      return;
    }
    if (s.ledger.pending.length === 0 && s.profile.userId && s.ledger.lastSyncAt) {
      // nothing new; still ping occasionally so notifications arrive (every ~5 min)
      if (Date.now() - s.ledger.lastSyncAt < 5 * 60_000) return;
    }
    this.inFlight = true;
    let sending: MinuteBucket[] | null = null;
    try {
      await this.deps.api.ensureSession();
      if (!s.profile.userId || !s.profile.nickname) {
        const created = await this.ensureProfile({ nation: s.profile.nation });
        if (!created) return;
      }
      // Resend the frozen batch (persisted, so this holds across restarts) so a duplicate reply
      // never acknowledges buckets the server did not see. A batchId without frozen buckets comes
      // from a state file written before `sentBuckets` existed: it is resent with rebuilt buckets.
      const batchId = s.ledger.batchId ?? randomUUID();
      const buckets =
        (s.ledger.batchId && s.ledger.sentBuckets) || takePending(s.ledger.pending, MAX_BUCKETS);
      this.deps.state.update((st) => {
        st.ledger.batchId = batchId;
        st.ledger.sentBuckets = buckets;
      });
      const localXpAtSend = this.deps.localXp();
      const req: IngestXpRequest = {
        batch_id: batchId,
        device_id: s.device.id,
        client_version: this.deps.clientVersion,
        buckets,
      };
      sending = buckets;
      const res = await this.deps.api.invoke<IngestXpResponse>('ingest-xp', req);
      const now = this.deps.now ? this.deps.now() : Date.now();
      this.drain(buckets);
      this.deps.state.update((st) => (st.ledger.lastSyncAt = now));
      this.backoffMs = BACKOFF_MIN_MS;
      this.setStatus({ connected: true, lastSyncAt: now, lastError: null, needsNation: false });
      this.emit('synced', {
        mon: res.mon,
        events: res.events,
        notifications: res.notifications,
        localXpAtSend,
      });
    } catch (err) {
      if (err instanceof SignedOutError) {
        this.enterSignedOut();
        return;
      }
      if (err instanceof ApiCallError && err.code === 'NO_PROFILE') {
        const p = this.deps.state.get().profile;
        if (p.userId || p.email) {
          // The server has no player for this session's uid although we hold a known account:
          // the session drifted to a different/new uid. Do NOT clear identity and re-create — that
          // is exactly the incident. Enter the signed-out state and let the player sign back in.
          this.enterSignedOut();
          return;
        }
        // No known account: safe to clear so the next flush re-creates a fresh profile.
        this.deps.state.update((st) => {
          st.profile.userId = null;
          st.profile.nickname = null;
        });
      } else if (err instanceof ApiCallError && (err.status === 400 || err.status === 413)) {
        // the batch itself is bad; drop it rather than retry forever. Other 4xx (401 after sleep,
        // gateway 403/404/408 during deploys) are transient: back off and resend the same batch.
        console.warn('ingest-xp rejected batch:', err.code, err.message);
        if (sending) this.drain(sending);
      }
      this.setStatus({ connected: false, lastError: describe(err) });
      this.scheduleRetry();
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * Remove exactly the sent counts from `pending` and close the batch. Events that landed in a sent
   * minute while the request was in flight stay pending.
   */
  private drain(sent: MinuteBucket[]): void {
    this.deps.state.update((st) => {
      for (const b of sent) {
        const live = st.ledger.pending.find((p) => p.minute === b.minute);
        if (live) subtractBucket(live, b);
      }
      st.ledger.pending = st.ledger.pending.filter((b) => !isEmpty(b));
      st.ledger.batchId = null;
      st.ledger.sentBuckets = null;
    });
  }

  private scheduleRetry(): void {
    setTimeout(() => void this.flush(), this.backoffMs);
    this.backoffMs = Math.min(BACKOFF_MAX_MS, this.backoffMs * 2);
  }

  private setStatus(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    this.emit('status', this.status);
  }
}

/** Oldest first, so the server's rolling-hour cap sees minutes in order; halved until it fits. */
function takePending(pending: MinuteBucket[], max: number): MinuteBucket[] {
  let out = [...pending]
    .sort((a, b) => a.minute - b.minute)
    .slice(0, max)
    .map((b) => ({ ...b, tools: { ...b.tools } }));
  while (out.length > 1 && Buffer.byteLength(JSON.stringify(out)) > MAX_BATCH_BYTES) {
    out = out.slice(0, Math.ceil(out.length / 2));
  }
  return out;
}

function subtractBucket(live: MinuteBucket, sent: MinuteBucket): void {
  live.prompts = Math.max(0, live.prompts - sent.prompts);
  live.stops = Math.max(0, live.stops - sent.stops);
  for (const [tool, n] of Object.entries(sent.tools)) {
    const left = (live.tools[tool] ?? 0) - n;
    if (left > 0) live.tools[tool] = left;
    else delete live.tools[tool];
  }
}

function isEmpty(b: MinuteBucket): boolean {
  return b.prompts === 0 && b.stops === 0 && Object.keys(b.tools).length === 0;
}

function describe(err: unknown): string {
  if (err instanceof ApiCallError) return `${err.code}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}
