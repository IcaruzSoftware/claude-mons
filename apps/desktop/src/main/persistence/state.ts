import { randomBytes } from 'node:crypto';
import type {
  CreditedMinute,
  MinuteBucket,
  Nation,
  Stage,
  Stance,
  StreakState,
} from '@claude-mons/shared';
import { DEFAULT_STANCE } from '@claude-mons/shared';
import type { BattleSummary } from '../../common/ipc.ts';
import type { AnchorMemory } from '../display.ts';
import type { WaterIntervalMin } from '../reminders/WaterReminder.ts';
import type { Migration } from './JsonStore.ts';

export interface LocalState {
  schemaVersion: number;
  device: { id: string; createdAt: number };
  profile: {
    /** Supabase auth user id once signed in */
    userId: string | null;
    nickname: string | null;
    nation: Nation | null;
    /** Linked email (account linking), or null while the account is still anonymous-only */
    email: string | null;
  };
  pet: {
    speciesId: string | null;
    /** PRNG seed for the behavior engine, stable per install */
    seed: number;
  };
  progress: {
    /** XP credited locally (provisional until the server acknowledges) */
    localXp: number;
    /** last authoritative XP from the server, or null when never synced */
    serverXp: number | null;
    /** highest stage ever shown; stages never regress visually */
    stage: Stage;
    hatchedAt: number | null;
    evolvedAt: Partial<Record<Stage, number>>;
  };
  ledger: {
    /** minutes already credited locally (last 48 h) */
    credited: CreditedMinute[];
    /** minute buckets not yet acknowledged by the server */
    pending: MinuteBucket[];
    lastSyncAt: number | null;
    /** idempotency key of the in-flight batch */
    batchId: string | null;
  };
  streak: StreakState;
  bonusXp: number;
  battleXp: number;
  behavior: { anchor: AnchorMemory | null };
  settings: {
    spriteScale: 2 | 3 | 4;
    autostart: boolean;
    /** Linux: whether the pet window may take focus (some WMs need it for always-on-top) */
    focusable: boolean | null;
    disableGpu: boolean;
    waterReminder: { enabled: boolean; intervalMin: WaterIntervalMin };
  };
  hooks: {
    /** set after a successful install so we can re-verify on start */
    installedAt: number | null;
    /** preferred bind port for HookServer; persists across restarts so script-mode commands stay valid */
    port: number;
    /** 64 hex chars; stable header token for the raw POST /hook endpoint (script mode) */
    token: string;
    /** 'auto' probes the binary and falls back to script mode when it is blocked or missing */
    mode: 'auto' | 'binary' | 'script';
  };
  ui: {
    panel: { x: number; y: number } | null;
  };
  auth: {
    /** supabase-js session (access + refresh token) persisted by the custom storage adapter */
    session: string | null;
  };
  battles: {
    history: BattleSummary[];
    lastBattleAt: number | null;
    /** UTC day key and count, for the local daily cap while offline */
    today: { day: string; count: number };
    /** consecutive-win streak; mirrors the server's `mons.win_streak` when online */
    streak: number;
  };
  /** Prepared loadout (docs/design/progression.md, docs/design/talent-tree.md). */
  loadout: {
    stance: Stance;
    moves?: string[];
    tree?: Record<string, number>;
    /** local mirror of the server's `mons.last_respec_at`, re-synced on every successful
     * `set-loadout` response; used only to show the 7-day respec cooldown before a round-trip. */
    lastRespecAt: string | null;
  };
  water: {
    /** Last time the player clicked "Done" on the water reminder card, or null. */
    lastDoneAt: number | null;
    /** Deferred-until timestamp: set by "Snooze 10 min" and reused to re-arm after an ignored card auto-hides. */
    snoozedUntil: number | null;
    /** Sips recorded on `todayKey` (UTC day key). */
    todayCount: number;
    todayKey: string;
  };
}

/** Default preferred bind port for HookServer's localhost endpoint (falls back to +1..+20 if taken). */
export const DEFAULT_HOOK_PORT = 51733;

export function defaultState(): LocalState {
  return {
    schemaVersion: 1,
    device: { id: randomBytes(8).toString('hex'), createdAt: Date.now() },
    profile: { userId: null, nickname: null, nation: null, email: null },
    pet: { speciesId: null, seed: randomBytes(4).readUInt32LE(0) },
    progress: { localXp: 0, serverXp: null, stage: 'egg', hatchedAt: null, evolvedAt: {} },
    ledger: { credited: [], pending: [], lastSyncAt: null, batchId: null },
    streak: { streakDays: 0, lastActiveDay: null },
    bonusXp: 0,
    battleXp: 0,
    behavior: { anchor: null },
    settings: {
      spriteScale: 3,
      autostart: false,
      focusable: null,
      disableGpu: false,
      waterReminder: { enabled: true, intervalMin: 60 },
    },
    hooks: {
      installedAt: null,
      port: DEFAULT_HOOK_PORT,
      token: randomBytes(32).toString('hex'),
      mode: 'auto',
    },
    ui: { panel: null },
    auth: { session: null },
    battles: { history: [], lastBattleAt: null, today: { day: '', count: 0 }, streak: 0 },
    water: { lastDoneAt: null, snoozedUntil: null, todayCount: 0, todayKey: '' },
    loadout: { stance: DEFAULT_STANCE, lastRespecAt: null },
  };
}

/** v1 -> v2: adds the persistent hook endpoint (port/token/mode) needed for script-mode hooks. */
function addHookEndpoint(state: Record<string, unknown>): Record<string, unknown> {
  const hooks = (state.hooks as Record<string, unknown> | undefined) ?? {};
  return {
    ...state,
    hooks: {
      installedAt: typeof hooks.installedAt === 'number' ? hooks.installedAt : null,
      port: DEFAULT_HOOK_PORT,
      token: randomBytes(32).toString('hex'),
      mode: 'auto',
    },
  };
}

/** v2 -> v3: adds the water reminder (on by default, 60 min) and its daily-sip counter. */
function addWaterReminder(state: Record<string, unknown>): Record<string, unknown> {
  const settings = (state.settings as Record<string, unknown> | undefined) ?? {};
  return {
    ...state,
    settings: { ...settings, waterReminder: { enabled: true, intervalMin: 60 } },
    water: { lastDoneAt: null, snoozedUntil: null, todayCount: 0, todayKey: '' },
  };
}

/** v3 -> v4: adds the linked-email field for account linking (null = still anonymous-only). */
function addProfileEmail(state: Record<string, unknown>): Record<string, unknown> {
  const profile = (state.profile as Record<string, unknown> | undefined) ?? {};
  return { ...state, profile: { ...profile, email: null } };
}

/** v4 -> v5: adds the win-streak counter and the (stance-only, for now) prepared loadout. */
function addProgressionPhaseA(state: Record<string, unknown>): Record<string, unknown> {
  const battles = (state.battles as Record<string, unknown> | undefined) ?? {};
  return {
    ...state,
    battles: { ...battles, streak: 0 },
    loadout: { stance: DEFAULT_STANCE },
  };
}

/** v5 -> v6: adds the talent tree's local respec-cooldown mirror (docs/design/talent-tree.md);
 * `loadout.tree` itself needs no default (stays absent until the player spends a point). */
function addTalentTree(state: Record<string, unknown>): Record<string, unknown> {
  const loadout = (state.loadout as Record<string, unknown> | undefined) ?? {};
  return { ...state, loadout: { ...loadout, lastRespecAt: null } };
}

/** migrations[i] upgrades version i+1 -> i+2. Add new ones at the end; never edit old ones. */
export const MIGRATIONS: readonly Migration[] = [
  addHookEndpoint,
  addWaterReminder,
  addProfileEmail,
  addProgressionPhaseA,
  addTalentTree,
];
