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
import { ApiCallError, type SupabaseClient } from './SupabaseClient.ts';

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
const BACKOFF_MIN_MS = 5_000;
const BACKOFF_MAX_MS = 5 * 60_000;

/**
 * Sends pending minute buckets to `ingest-xp` and creates the profile on first contact.
 * Idempotent per batch (same batch_id on retry), exponential backoff on failure.
 */
export class SyncQueue extends EventEmitter<SyncEvents> {
  private timer: NodeJS.Timeout | null = null;
  private stopTimer: NodeJS.Timeout | null = null;
  private inFlight = false;
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
      this.setStatus({ connected: false, lastError: describe(err) });
      if (err instanceof ApiCallError && err.status < 500) throw err;
      return null;
    }
  }

  /** Send everything pending. Safe to call often; concurrent calls coalesce. */
  async flush(): Promise<void> {
    if (this.inFlight) return;
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
    try {
      await this.deps.api.ensureSession();
      if (!s.profile.userId || !s.profile.nickname) {
        const created = await this.ensureProfile({ nation: s.profile.nation });
        if (!created) return;
      }
      const buckets = takePending(s.ledger.pending, MAX_BUCKETS);
      const batchId = s.ledger.batchId ?? randomUUID();
      this.deps.state.update((st) => (st.ledger.batchId = batchId));
      const localXpAtSend = this.deps.localXp();
      const req: IngestXpRequest = {
        batch_id: batchId,
        device_id: s.device.id,
        client_version: this.deps.clientVersion,
        buckets,
      };
      const res = await this.deps.api.invoke<IngestXpResponse>('ingest-xp', req);
      const now = this.deps.now ? this.deps.now() : Date.now();
      this.deps.state.update((st) => {
        // drop exactly the buckets we sent (by minute); new events may have landed since
        const sent = new Set(buckets.map((b) => b.minute));
        st.ledger.pending = st.ledger.pending.filter(
          (b) => !sent.has(b.minute) || b.minute === minuteOf(now),
        );
        // the current minute may keep collecting: only subtract what was sent
        for (const b of buckets) {
          if (b.minute !== minuteOf(now)) continue;
          const live = st.ledger.pending.find((p) => p.minute === b.minute);
          if (live) subtractBucket(live, b);
        }
        st.ledger.pending = st.ledger.pending.filter((b) => !isEmpty(b));
        st.ledger.batchId = null;
        st.ledger.lastSyncAt = now;
      });
      this.backoffMs = BACKOFF_MIN_MS;
      this.setStatus({ connected: true, lastSyncAt: now, lastError: null, needsNation: false });
      this.emit('synced', {
        mon: res.mon,
        events: res.events,
        notifications: res.notifications,
        localXpAtSend,
      });
    } catch (err) {
      if (err instanceof ApiCallError && err.code === 'NO_PROFILE') {
        this.deps.state.update((st) => {
          st.profile.userId = null;
          st.profile.nickname = null;
        });
      } else if (
        err instanceof ApiCallError &&
        err.status >= 400 &&
        err.status < 500 &&
        err.status !== 429
      ) {
        // the batch itself is bad; drop it rather than retry forever
        console.warn('ingest-xp rejected batch:', err.code, err.message);
        this.deps.state.update((st) => (st.ledger.batchId = null));
      }
      this.setStatus({ connected: false, lastError: describe(err) });
      this.scheduleRetry();
    } finally {
      this.inFlight = false;
    }
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

function takePending(pending: MinuteBucket[], max: number): MinuteBucket[] {
  return [...pending]
    .sort((a, b) => a.minute - b.minute)
    .slice(-max)
    .map((b) => ({ ...b, tools: { ...b.tools } }));
}

function minuteOf(ts: number): number {
  return Math.floor(ts / 60000) * 60000;
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
