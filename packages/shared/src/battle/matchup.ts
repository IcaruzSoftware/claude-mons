/**
 * Phase D of `docs/design/progression.md` (Recent-opponent intel): a pure, deterministic explainer
 * that turns two `MonSnapshot`s into a handful of short, factual lines plus one rule-derived
 * suggestion. No RNG, no server round-trip -- everything it needs (nation, stance, equipped moves,
 * talent tree) already lives on the snapshot, so the Battles tab can re-run it against the
 * player's *current* (unsaved) loadout edits, not just the loadout that was actually used in the
 * stored battle.
 *
 * Old snapshots (pre-Phase-A/B/C) may be missing `loadout` entirely, or missing `loadout.moves` /
 * `loadout.tree`: every read here goes through the same "default, don't throw" fallbacks
 * `snapshotFor`/`resolveLoadoutMoves` (`packages/shared/src/battle/battle.ts`) already use --
 * `DEFAULT_STANCE` for an absent stance, `defaultLoadoutMoveIds` for absent/incomplete moves, and
 * simply no talent-tree facts when `loadout.tree` is absent.
 */
import { NATION_INFO, effectiveness } from '../game/nations.ts';
import {
  DEFAULT_STANCE,
  STANCES,
  STANCE_INFO,
  stanceBeats,
  type Stance,
} from '../game/progression.ts';
import { defaultLoadoutMoveIds, findMove, speciesOf, type Move } from '../game/species.ts';
import { treeSummary } from '../game/tree.ts';
import type { MonSnapshot } from './battle.ts';
import type { EffectId } from './effects.ts';
import type { Nation } from '../types.ts';

/** Short, player-facing description of what a move's effect means for the *opponent* using it. */
const EFFECT_BLURB: Record<EffectId, string> = {
  priority: 'always acts first',
  crit_up: 'high crit chance',
  drain: 'heals on hit',
  shield_first: 'shields their first hit taken',
  def_down: 'weakens your DEF',
  burn: 'burns over time',
  true_hit: 'never misses',
  charge: 'charges into a heavy hit',
};

function stanceName(s: Stance): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Same "repair, don't throw" fallback `resolveLoadoutMoves` uses in `battle.ts`, duplicated here
 * (not imported) because that helper is private to `battle.ts` and this module only ever needs a
 * read-only view of the 3 equipped moves. */
function resolveMoves(mon: MonSnapshot): [Move, Move, Move] {
  const species = speciesOf(mon.speciesId);
  const ids =
    mon.loadout?.moves?.length === 3
      ? mon.loadout.moves
      : defaultLoadoutMoveIds(species, mon.level);
  const resolved = ids.map((id) => findMove(species, id));
  if (resolved.every((m): m is Move => m !== undefined)) return resolved as [Move, Move, Move];
  const fallback = defaultLoadoutMoveIds(species, mon.level).map((id) => findMove(species, id)!);
  return fallback as [Move, Move, Move];
}

/** Roman numeral for a rank total (branches never exceed 10 total ranks -- 3+3+1+1+1+1 -- so this
 * only needs to be correct in that range, but is written generally). Used by the Battles tab's
 * "Tremor III" branch badge; exported alongside `topBranch` since the two are always used together. */
export function toRoman(n: number): string {
  if (n <= 0) return '';
  const table: Array<[number, string]> = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let remaining = n;
  let out = '';
  for (const [value, sym] of table) {
    while (remaining >= value) {
      out += sym;
      remaining -= value;
    }
  }
  return out;
}

/** The nation branch (of the mon's own nation, never "Shared") a tree invests the most ranks in,
 * with the rank total. Ties break alphabetically by branch name for determinism. Null when the mon
 * has no tree at all (pre-Phase-C snapshot, or an intentionally empty tree). */
export function topBranch(
  nation: Nation,
  tree: Record<string, number> | undefined,
): { branch: string; ranks: number } | null {
  if (!tree) return null;
  const summary = treeSummary(nation, tree);
  let best: { branch: string; ranks: number } | null = null;
  for (const [branch, nodes] of Object.entries(summary)) {
    if (branch === 'Shared') continue;
    const total = Object.values(nodes).reduce((a, b) => a + b, 0);
    if (total <= 0) continue;
    if (!best || total > best.ranks || (total === best.ranks && branch < best.branch)) {
      best = { branch, ranks: total };
    }
  }
  return best;
}

function hasShieldFirst(moves: readonly Move[]): Move | null {
  return moves.find((m) => m.effect === 'shield_first') ?? null;
}

function hasStoneSkin(tree: Record<string, number> | undefined): boolean {
  return !!tree && (tree['shared:stone-skin'] ?? 0) > 0;
}

/** The stance that counters `s` (the one stance whose `beats` is `s`) -- the reverse lookup
 * `STANCE_INFO` doesn't offer directly (it only records what a stance *beats*, not what beats it). */
function counterOf(s: Stance): Stance {
  return STANCES.find((c) => STANCE_INFO[c].beats === s)!;
}

export interface MatchupExplanation {
  /** e.g. "Water hits Fire hard." / "Fire hits Water hard -- brace for it." / "Water and Earth trade evenly." */
  nationLine: string;
  /** e.g. "Their Bulwark counters your Fury." / "Your Fury counters their Gale." / "Both use Bulwark -- no stance edge either way." */
  stanceLine: string;
  /** e.g. "Opens with Drip Tap (always acts first)." */
  openerLine: string;
  /** e.g. "Finishes with Backpressure (shields their first hit taken)." */
  finisherLine: string;
  /** e.g. "Invested most in Tremor (5 ranks)." Null when the opponent has no spent tree. */
  topBranchLine: string | null;
  /** One concrete, rule-derived suggestion (see module doc for the priority order). */
  suggestion: string;
  /** Set only when `suggestion` recommends a stance switch; drives the Battles tab's "Counter
   * this" button, which pre-selects this stance in the loadout editor without saving it. */
  suggestedStance: Stance | null;
}

/**
 * Explains a matchup for `me` (the player, using their CURRENT, possibly-unsaved loadout) against
 * `opp` (a recent opponent's stored snapshot). Pure and deterministic: same two snapshots always
 * produce the same explanation, so the Battles tab can re-run this on every render as the player
 * edits their own loadout, without a server round-trip.
 *
 * Suggestion priority (first applicable rule wins -- only one suggestion is ever returned):
 *  1. The opponent's stance counters mine -> switch to the stance that counters theirs.
 *  2. The opponent has a `shield_first` move equipped, or the Stone Skin shared passive -> burn
 *     ignores a one-hit shield (it is end-of-turn damage, not a hit `shield_first`/Stone Skin
 *     reduce).
 *  3. The opponent is in Gale (their SPD grant raises their dodge chance, see
 *     `docs/design/progression.md` Loadout policy's dodge formula) -> a `true_hit` opener ignores
 *     dodge entirely.
 *  4. My nation type is at a disadvantage against theirs -> avoid nation-type trades.
 *  5. My nation type has the advantage -> lean into nation-type moves.
 *  6. No exploitable edge either way -> a neutral fallback line.
 */
export function explainMatchup(me: MonSnapshot, opp: MonSnapshot): MatchupExplanation {
  const meName = NATION_INFO[me.nation].name;
  const oppName = NATION_INFO[opp.nation].name;
  const meAtk = effectiveness(me.nation, opp.nation);
  const oppAtk = effectiveness(opp.nation, me.nation);

  let nationLine: string;
  if (meAtk > 1) nationLine = `${meName} hits ${oppName} hard.`;
  else if (oppAtk > 1) nationLine = `${oppName} hits ${meName} hard -- brace for it.`;
  else nationLine = `${meName} and ${oppName} trade evenly.`;

  const meStance = me.loadout?.stance ?? DEFAULT_STANCE;
  const oppStance = opp.loadout?.stance ?? DEFAULT_STANCE;
  const oppCountersMe = meStance !== oppStance && stanceBeats(oppStance, meStance);

  let stanceLine: string;
  if (meStance === oppStance) {
    stanceLine = `Both use ${stanceName(meStance)} -- no stance edge either way.`;
  } else if (oppCountersMe) {
    stanceLine = `Their ${stanceName(oppStance)} counters your ${stanceName(meStance)}.`;
  } else {
    // The triangle has no ties between distinct stances, so if the opponent doesn't counter me,
    // I counter them (`stanceBeats(meStance, oppStance)` is always true here).
    stanceLine = `Your ${stanceName(meStance)} counters their ${stanceName(oppStance)}.`;
  }

  const oppMoves = resolveMoves(opp);
  const opener = oppMoves[0];
  const finisher = oppMoves[2];
  const blurb = (m: Move) => (m.effect ? EFFECT_BLURB[m.effect] : 'no special effect');
  const openerLine = `Opens with ${opener.name} (${blurb(opener)}).`;
  const finisherLine = `Finishes with ${finisher.name} (${blurb(finisher)}).`;

  const top = topBranch(opp.nation, opp.loadout?.tree);
  const topBranchLine = top
    ? `Invested most in ${top.branch} (${top.ranks} rank${top.ranks === 1 ? '' : 's'}).`
    : null;

  let suggestion: string;
  let suggestedStance: Stance | null = null;
  const shieldMove = hasShieldFirst(oppMoves);
  const stoneSkin = hasStoneSkin(opp.loadout?.tree);

  if (oppCountersMe) {
    suggestedStance = counterOf(oppStance);
    suggestion = `Switch to ${stanceName(suggestedStance)} to counter ${stanceName(oppStance)}.`;
  } else if (shieldMove || stoneSkin) {
    const shieldLabel = stoneSkin ? 'Stone Skin' : shieldMove!.name;
    suggestion = `Burn beats ${shieldLabel}'s single-hit shield.`;
  } else if (oppStance === 'gale') {
    suggestion = `A true-hit opener ignores their ${stanceName(oppStance)} dodge.`;
  } else if (oppAtk > 1) {
    suggestion = `Avoid trading nation-type hits -- ${oppName} hits back hard.`;
  } else if (meAtk > 1) {
    suggestion = `Lean on nation-type moves -- ${meName} hits ${oppName} hard.`;
  } else {
    suggestion = 'No clear edge either way -- play it by the numbers.';
  }

  return {
    nationLine,
    stanceLine,
    openerLine,
    finisherLine,
    topBranchLine,
    suggestion,
    suggestedStance,
  };
}
