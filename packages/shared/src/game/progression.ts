/**
 * Phase A of the progression system (docs/design/progression.md): battle stances and the loadout
 * shape that future phases (move pool, talent tree) extend without breaking stored snapshots.
 */
import { findMove, speciesOf, unlockedMoves } from './species.ts';
import { isRespec, validateTree, singlePurchaseTree } from './tree.ts';
import type { Nation } from '../types.ts';
import type { EffectId } from '../battle/effects.ts';

/** Battle stance: at most one equipped, conditional build passive. */
export type Stance = 'fury' | 'bulwark' | 'gale';
export const STANCES: readonly Stance[] = ['fury', 'bulwark', 'gale'] as const;

/** Legacy snapshots and bots without a stance field keep Bulwark; explicit null means none. */
export const DEFAULT_STANCE: Stance = 'bulwark';

export function isStance(value: unknown): value is Stance {
  return typeof value === 'string' && (STANCES as readonly string[]).includes(value);
}

export const FURY_DAMAGE_MULT = 1.08;
export const BULWARK_DAMAGE_MULT = 0.9;
export const BULWARK_HP_THRESHOLD = 0.35;
export const GALE_DAMAGE_MULT = 1.1;

export const STANCE_INFO: Record<Stance, { name: string; passive: string; description: string }> = {
  fury: {
    name: 'Fury',
    passive: 'Exploit',
    description:
      '+8% direct damage on critical hits or charged releases against a foe already affected by Burn or DEF down. The hit that applies the debuff does not qualify.',
  },
  bulwark: {
    name: 'Bulwark',
    passive: 'Brace',
    description:
      'Take 10% less direct damage during a charge telegraph turn or while at 35% HP or less before the hit. Burn bypasses Brace; instant charges have no telegraph window.',
  },
  gale: {
    name: 'Gale',
    passive: 'Tempo',
    description:
      '+10% direct damage when acting first with a different move on the turn immediately after landing Priority. A miss or charge telegraph consumes the window.',
  },
};

/** A hint about the actual draft, not a promise that conditional effects will trigger. */
export function stanceBuildHint(
  stance: Stance,
  moves: readonly { effect: EffectId | null }[],
): string {
  const has = (effect: EffectId) => moves.some((move) => move.effect === effect);
  if (stance === 'fury') {
    const setup = has('burn') || has('def_down');
    const payoff = has('crit_up') || has('charge');
    return setup && payoff
      ? 'Build fit: debuff opener > Crit up or Charge. Keep the debuff alive until the payoff lands.'
      : setup
        ? 'Your attacks can set up Exploit. Crit up or Charge makes the payoff more reliable.'
        : 'No Burn or DEF-down attack equipped. Exploit depends on innate traits, talents or shared passives applying a debuff first.';
  }
  if (stance === 'bulwark') {
    return has('charge')
      ? 'Build fit: Brace protects the telegraph turn. Instant-charge talents remove that window; low-HP protection still works.'
      : 'No charge equipped: Brace only helps at low HP. Drain or survival passives can keep that window useful.';
  }
  return has('priority')
    ? 'Build fit: Priority > a different attack next turn. Acting first is required; repeating Priority does not cash in Tempo.'
    : 'No Priority equipped: Tempo cannot activate with these attacks. Equip Priority before a different follow-up.';
}

/**
 * A mon's prepared loadout. Only `stance` is validated/used in Phase A; `moves` (Phase B) and
 * `tree` (Phase C) are already part of the shape so stored snapshots (`battles.*_snapshot`) and the
 * `mons.loadout` column do not need a breaking shape change when those phases ship.
 */
export interface MonLoadout {
  /** null explicitly clears the selection; undefined preserves the legacy fallback. */
  stance?: Stance | null;
  moves?: string[];
  tree?: Record<string, number>;
}

/**
 * Stable, machine-readable reasons a submitted loadout was rejected (`set-loadout`'s response
 * carries this as `error.details.code`). The `TREE_*` codes come from
 * `packages/shared/src/game/tree.ts:validateTree`.
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
  | 'TREE_PASSIVE_LIMIT'
  | 'TREE_CHOICE_LIMIT';

export type ValidateLoadoutResult =
  | { ok: true; loadout: MonLoadout; isRespec: boolean }
  | { ok: false; code: LoadoutErrorCode; reason: string; details?: Record<string, unknown> };

/**
 * Pure validation for the `set-loadout` Edge Function. Accepts `stance`, `moves` (3 distinct move
 * ids, each unlocked at the mon's level per `docs/design/progression.md` Move pool and effects),
 * and (Phase C) `tree` (`{ [nodeId]: rank }`, validated by
 * `packages/shared/src/game/tree.ts:validateTree`) plus an optional `respec` acknowledgement flag.
 * `context.speciesId` is null for an unhatched egg, which cannot have moves (it has no species,
 * hence no move pool) -- `stance` alone is still accepted for an egg, same as Phase A.
 *
 * Lowering a rank is a free respec. The caller's `respec` flag is ignored; the result derives
 * `isRespec` from the stored and submitted trees.
 */
export function validateLoadout(
  input: unknown,
  context: {
    level: number;
    nation: Nation;
    speciesId: string | null;
    existingTree?: Record<string, number>;
  },
): ValidateLoadoutResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, code: 'INVALID_SHAPE', reason: 'loadout must be an object' };
  }
  const body = input as Record<string, unknown>;
  const loadout: MonLoadout = {};
  if (body.stance !== undefined) {
    if (body.stance !== null && !isStance(body.stance))
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
      // Older clients may resend a rank bought before talents became single-purchase.
      // Preserve that purchase, but never accept an increased or newly duplicated rank.
      const legacyRank = context.existingTree?.[id] ?? 0;
      ranks[id] = rank > 1 && legacyRank >= rank ? 1 : rank;
    }
    // Older clients may resend unchanged multi-passive trees. Consolidate existing purchases,
    // but never accept newly submitted multiple passives.
    const requestedPassives = Object.keys(ranks).filter(
      (id) => id.startsWith('shared:') && ranks[id]! > 0,
    );
    const consolidated =
      requestedPassives.length > 1 &&
      requestedPassives.every((id) => (context.existingTree?.[id] ?? 0) > 0)
        ? singlePurchaseTree(ranks)
        : ranks;
    const treeResult = validateTree(
      context.nation,
      context.level,
      consolidated,
      context.existingTree,
    );
    if (!treeResult.ok) return { ok: false, code: treeResult.code, reason: treeResult.reason };
    isRespecResult = isRespec(context.existingTree ?? {}, consolidated);
    loadout.tree = consolidated;
  }
  return { ok: true, loadout, isRespec: isRespecResult };
}
