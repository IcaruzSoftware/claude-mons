/**
 * Phase A of the progression system (docs/design/progression.md): battle stances and the loadout
 * shape that future phases (move pool, talent tree) extend without breaking stored snapshots.
 */
import { findMove, speciesOf, unlockedMoves } from './species.ts';
import { isRespec, validateTree } from './tree.ts';
import type { Nation, Stats } from '../types.ts';

/** Battle stance: a rock-paper-scissors triangle of +-18% stat trade-offs. */
export type Stance = 'fury' | 'bulwark' | 'gale';
export const STANCES: readonly Stance[] = ['fury', 'bulwark', 'gale'] as const;

/**
 * Default stance for a mon with no loadout set yet (existing mons predating this migration, and
 * brand-new mons before their first `set-loadout` call). The design doc's Stances table does not
 * name a default; Bulwark is used per CLAUDE.md's Phase A instructions.
 */
export const DEFAULT_STANCE: Stance = 'bulwark';

export function isStance(value: unknown): value is Stance {
  return typeof value === 'string' && (STANCES as readonly string[]).includes(value);
}

interface StanceInfo {
  /** Multiplicative modifiers applied to the mon's level-scaled stats for the whole battle. */
  modifiers: { atk: number; def: number; spd: number };
  /** The stance this one beats (grants the counter bonus against it). */
  beats: Stance;
}

/**
 * Grant/cost magnitudes, tuned by simulation on 2026-09-13 (see docs/design/progression.md Stances
 * and CLAUDE.md's Phase A tuning task). Decoupled on purpose: the grant (what a stance boosts) and
 * the cost (what it gives up) no longer have to be equal and opposite, which is what let the sweep
 * find a much smaller, working pair instead of the original +-18%.
 */
const STANCE_GRANT = 1.02; // +2% to the stance's boosted stat
const STANCE_COST = 0.94; // -6% to the stance's traded-off stat

/**
 * docs/design/progression.md Stances table. Bulwark's cost stat was moved from SPD to ATK (Gale's
 * stays ATK) during the same tuning pass: with the original SPD cost, Bulwark and Gale were the only
 * two stances that never touched the ATK/DEF axis the damage formula actually uses, while Fury
 * touched both (ATK grant *and* DEF cost) -- so pairings involving Fury swung far harder than
 * Bulwark-vs-Gale, no matter how the magnitudes were scaled. Moving Bulwark's cost onto ATK makes
 * all three pairings touch ATK/DEF symmetrically (Fury costs DEF, Bulwark and Gale both cost ATK),
 * which is what let the sweep hit a tight, evenly-spread band. Flavor still reads cleanly: Bulwark
 * and Gale both give up raw power for their specialty (bulk or speed); Fury gives up survivability
 * for power.
 */
export const STANCE_INFO: Record<Stance, StanceInfo> = {
  fury: { modifiers: { atk: STANCE_GRANT, def: STANCE_COST, spd: 1 }, beats: 'gale' },
  bulwark: { modifiers: { atk: STANCE_COST, def: STANCE_GRANT, spd: 1 }, beats: 'fury' },
  gale: { modifiers: { atk: STANCE_COST, def: 1, spd: STANCE_GRANT }, beats: 'bulwark' },
};

/** True when `a` counters `b` (grants `a` the counter bonus for the whole battle). */
export function stanceBeats(a: Stance, b: Stance): boolean {
  return STANCE_INFO[a].beats === b;
}

/**
 * Counter bonus: +2% damage dealt / -2% damage taken for the whole battle, tuned by simulation on
 * 2026-09-13 (down from +-10%; see docs/design/progression.md Stances). Combined with the smaller
 * STANCE_GRANT/STANCE_COST above, this is what lands every stance-counter pairing in the 55-62% band
 * the design doc targets, instead of the 80-97% (and, for one pairing, sub-50%) the original +-18%
 * stat swing plus +-10% counter bonus produced.
 */
export const STANCE_COUNTER_DEALT_MULT = 1.02;
export const STANCE_COUNTER_TAKEN_MULT = 0.98;

/** Applies a stance's stat modifiers. HP is never affected by stance. */
export function applyStanceModifiers(stats: Stats, stance: Stance): Stats {
  const m = STANCE_INFO[stance].modifiers;
  return {
    hp: stats.hp,
    atk: Math.round(stats.atk * m.atk),
    def: Math.round(stats.def * m.def),
    spd: Math.round(stats.spd * m.spd),
  };
}

/**
 * A mon's prepared loadout. Only `stance` is validated/used in Phase A; `moves` (Phase B) and
 * `tree` (Phase C) are already part of the shape so stored snapshots (`battles.*_snapshot`) and the
 * `mons.loadout` column do not need a breaking shape change when those phases ship.
 */
export interface MonLoadout {
  stance?: Stance;
  moves?: string[];
  tree?: Record<string, number>;
}

/**
 * Stable, machine-readable reasons a submitted loadout was rejected (`set-loadout`'s response
 * carries this as `error.details.code`). The `TREE_*` codes come from
 * `packages/shared/src/game/tree.ts:validateTree`; `RESPEC_COOLDOWN` is Phase C's respec rule
 * (docs/design/talent-tree.md).
 */
export type LoadoutErrorCode =
  | 'INVALID_SHAPE'
  | 'INVALID_STANCE'
  | 'NO_SPECIES'
  | 'MOVES_COUNT'
  | 'MOVES_NOT_DISTINCT'
  | 'MOVE_UNKNOWN'
  | 'MOVE_LOCKED'
  | 'TREE_UNKNOWN_NODE'
  | 'TREE_RANK'
  | 'TREE_PREREQ'
  | 'TREE_OVER_BUDGET'
  | 'RESPEC_COOLDOWN';

export type ValidateLoadoutResult =
  | { ok: true; loadout: MonLoadout; isRespec: boolean }
  | { ok: false; code: LoadoutErrorCode; reason: string; details?: Record<string, unknown> };

/** A respec is free below this level, then limited to once per `RESPEC_COOLDOWN_MS`
 * (docs/design/talent-tree.md Respec). */
export const RESPEC_FREE_BELOW_LEVEL = 10;
export const RESPEC_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Pure validation for the `set-loadout` Edge Function. Accepts `stance`, `moves` (3 distinct move
 * ids, each unlocked at the mon's level per `docs/design/progression.md` Move pool and effects),
 * and (Phase C) `tree` (`{ [nodeId]: rank }`, validated by
 * `packages/shared/src/game/tree.ts:validateTree`) plus an optional `respec` acknowledgement flag.
 * `context.speciesId` is null for an unhatched egg, which cannot have moves (it has no species,
 * hence no move pool) -- `stance` alone is still accepted for an egg, same as Phase A.
 *
 * A respec (docs/design/talent-tree.md: "any change that lowers a node's rank", detected by
 * `isRespec` against `context.existingTree`) is free below `RESPEC_FREE_BELOW_LEVEL`; at or above
 * it, `context.lastRespecAt`/`context.now` gate it to once per `RESPEC_COOLDOWN_MS` -- this is
 * always re-derived from the submitted ranks themselves, so the caller's own `respec` flag (kept
 * in the request shape for the client's own UI confirmation) cannot be used to bypass the cooldown.
 * Both `existingTree`/`lastRespecAt` are optional because a client-side preview call (before the
 * server round-trip) may not have them at hand; the cooldown is only truly enforced once
 * `set-loadout` calls this with the mon's real stored `tree`/`last_respec_at`.
 */
export function validateLoadout(
  input: unknown,
  context: {
    level: number;
    nation: Nation;
    speciesId: string | null;
    existingTree?: Record<string, number>;
    lastRespecAt?: string | null;
    now?: Date;
  },
): ValidateLoadoutResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, code: 'INVALID_SHAPE', reason: 'loadout must be an object' };
  }
  const body = input as Record<string, unknown>;
  const loadout: MonLoadout = {};
  if (body.stance !== undefined) {
    if (!isStance(body.stance))
      return { ok: false, code: 'INVALID_STANCE', reason: 'invalid stance' };
    loadout.stance = body.stance;
  }
  if (body.moves !== undefined) {
    if (context.speciesId === null) {
      return { ok: false, code: 'NO_SPECIES', reason: 'mon has not hatched yet' };
    }
    if (
      !Array.isArray(body.moves) ||
      body.moves.length !== 3 ||
      !body.moves.every((m) => typeof m === 'string')
    ) {
      return { ok: false, code: 'MOVES_COUNT', reason: 'moves must be exactly 3 move ids' };
    }
    const moves = body.moves as string[];
    if (new Set(moves).size !== 3) {
      return { ok: false, code: 'MOVES_NOT_DISTINCT', reason: 'the 3 moves must be distinct' };
    }
    const species = speciesOf(context.speciesId);
    const unlockedIds = new Set(unlockedMoves(species, context.level).map((m) => m.id));
    for (const id of moves) {
      const move = findMove(species, id);
      if (!move) return { ok: false, code: 'MOVE_UNKNOWN', reason: `unknown move id: ${id}` };
      if (!unlockedIds.has(id)) {
        return {
          ok: false,
          code: 'MOVE_LOCKED',
          reason: `${move.name} unlocks at level ${move.unlocksAt}`,
        };
      }
    }
    loadout.moves = moves;
  }
  let isRespecResult = false;
  if (body.tree !== undefined) {
    if (typeof body.tree !== 'object' || body.tree === null || Array.isArray(body.tree)) {
      return {
        ok: false,
        code: 'INVALID_SHAPE',
        reason: 'tree must be an object of nodeId -> rank',
      };
    }
    const ranks: Record<string, number> = {};
    for (const [id, rank] of Object.entries(body.tree as Record<string, unknown>)) {
      if (typeof rank !== 'number' || !Number.isInteger(rank) || rank < 0) {
        return {
          ok: false,
          code: 'TREE_RANK',
          reason: `${id}: rank must be a non-negative integer`,
        };
      }
      ranks[id] = rank;
    }
    const treeResult = validateTree(context.nation, context.level, ranks);
    if (!treeResult.ok) return { ok: false, code: treeResult.code, reason: treeResult.reason };
    const respec = isRespec(context.existingTree ?? {}, ranks);
    if (respec && context.level >= RESPEC_FREE_BELOW_LEVEL) {
      const lastMs = context.lastRespecAt ? Date.parse(context.lastRespecAt) : NaN;
      const nowMs = (context.now ?? new Date()).getTime();
      if (Number.isFinite(lastMs) && nowMs - lastMs < RESPEC_COOLDOWN_MS) {
        const cooldownUntil = new Date(lastMs + RESPEC_COOLDOWN_MS).toISOString();
        return {
          ok: false,
          code: 'RESPEC_COOLDOWN',
          reason: `respec available again at ${cooldownUntil}`,
          details: { cooldownUntil },
        };
      }
    }
    isRespecResult = respec;
    loadout.tree = ranks;
  }
  return { ok: true, loadout, isRespec: isRespecResult };
}
