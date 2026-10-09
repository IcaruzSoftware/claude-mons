/** Protocol-14 talent tree: four shared branches (bastion, strike, ward, tempo) and one nation
 * column per nation, 17 single-purchase nodes each, all drawing on one 47-point pool. Pure
 * validation, normalization and resolution are shared by the client and server. */
import type { Nation } from '../types.ts';

export type TreeBranch = 'bastion' | 'strike' | 'ward' | 'tempo' | 'nation';
export const TREE_BRANCHES: readonly TreeBranch[] = [
  'bastion',
  'strike',
  'ward',
  'tempo',
  'nation',
];

/** `passive` = a bastion standing rule, `capstone` = tier 6 or 12, `active` = everything else.
 * Only the editor reads it (glyph and frame); battle rules key on the node id. */
export type TreeNodeKind = 'passive' | 'active' | 'capstone';

/** Battle steps a node hooks into (talent-tree spec section 1.1); also the `TreeTrigger.step` set. */
export type TreeStep =
  | 'turn_start'
  | 'order'
  | 'pick'
  | 'act_pre'
  | 'dodge'
  | 'crit'
  | 'damage'
  | 'clamp'
  | 'lethal'
  | 'hit'
  | 'status'
  | 'turn_end';

/** Effect vocabulary (spec section 1.2). */
export type TreeEffect =
  | 'UNDODGE'
  | 'GUARANTEED_CRIT'
  | 'PIERCE'
  | 'VOID'
  | 'REFUSE'
  | 'CAP'
  | 'CLAMP'
  | 'NOCRIT'
  | 'MULTIPLIER'
  | 'FIZZLE'
  | 'HEAL'
  | 'CLEANSE'
  | 'SKIP_TICK'
  | 'EXTEND'
  | 'ORDER';

/** Use limit: `battle` = once per battle, `turn` = once per turn, `pending` = arms a payoff for
 * the next action and may re-arm (at most once per turn), `state` = applies whenever its
 * condition holds. */
export type TreeCap = 'battle' | 'turn' | 'pending' | 'state';

export type TreeTier = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export interface TreeNode {
  /** `${branch}:${tier}` or `nation.${nation}:${tier}`, plus `:alt` (tier 3) or `:left`/`:right`
   * (tiers 7 and 10) for a fork alternative. */
  id: string;
  branch: TreeBranch;
  /** Present only on nation-column nodes. */
  nation?: Nation;
  tier: TreeTier;
  name: string;
  kind: TreeNodeKind;
  maxRank: 1;
  /** Points for this one-time purchase. */
  cost: number;
  /** One player-facing sentence. */
  description: string;
  /** Centre node of the previous tier; null for tier 1. */
  prereqId: string | null;
  /** Tiers 4, 8 and 11: any alternative of the previous fork is sufficient. */
  prereqIds?: readonly string[];
  /** At most one node of a fork group may be purchased. */
  choiceGroup?: string;
  /** -1 for `:left`, +1 for `:right` and `:alt`; absent on the centre route. */
  choiceOffset?: -1 | 1;
  /** Step at which the node fires or arms (the spec's trigger column, first step). */
  trigger: TreeStep | 'aura';
  effect: TreeEffect;
  /** Second effect of a node that sets two booleans (for example UNDODGE and PIERCE). */
  extraEffect?: TreeEffect;
  cap: TreeCap;
  /** Holds the spec's declared once-per-battle `(flag)`. */
  flag: boolean;
  /** Fixed one-line log text; `{placeholders}` are filled in by the battle log. */
  logText: string;
}

const TIER_COSTS = [1, 1, 2, 2, 3, 5, 4, 5, 5, 6, 6, 7] as const;

/** [id suffix, name, effect(s), trigger, cap, description, log text override] */
type Row = [
  string,
  string,
  TreeEffect | readonly [TreeEffect, TreeEffect],
  TreeStep,
  TreeCap,
  string,
  string?,
];

const DEFAULT_LOG: Record<TreeEffect, string> = {
  UNDODGE: 'cannot be dodged',
  GUARANTEED_CRIT: 'guaranteed crit',
  PIERCE: 'pierced {defense}',
  VOID: 'hit voided',
  REFUSE: 'refused {status}',
  CAP: 'hit capped ({amount} cut)',
  CLAMP: 'held at {hp} HP',
  NOCRIT: 'crit cancelled',
  MULTIPLIER: 'crit multiplier {factor}x',
  FIZZLE: "foe's Priority fizzled",
  HEAL: 'healed {amount} HP',
  CLEANSE: 'cleared {statuses}',
  SKIP_TICK: 'burn tick skipped',
  EXTEND: 'DEF-down kept ({turns} turns left)',
  ORDER: 'you act first',
};

/** Once-per-battle flags declared `(flag)` in the spec rows. */
const FLAG_IDS = new Set([
  'bastion:3:alt',
  'bastion:4',
  'bastion:5',
  'bastion:7',
  'bastion:11',
  'tempo:10:right',
  'tempo:12',
  'nation.fire:10',
  'nation.water:3:alt',
  'nation.water:10:left',
  'nation.water:12',
  'nation.earth:3',
  'nation.earth:3:alt',
  'nation.earth:6',
  'nation.earth:7',
  'nation.earth:7:right',
  'nation.earth:10',
  'nation.air:7',
  'nation.air:11',
  'nation.air:12',
]);

function buildColumn(prefix: string, branch: TreeBranch, rows: Row[], nation?: Nation): TreeNode[] {
  return rows.map(([suffix, name, effects, trigger, cap, description, log]) => {
    const [tierText, alt] = suffix.split(':') as [string, string | undefined];
    const tier = Number(tierText) as TreeTier;
    const id = `${prefix}:${suffix}`;
    const centre = (t: number) => `${prefix}:${t}`;
    const forkIds = (t: number) =>
      t === 3
        ? [centre(3), `${centre(3)}:alt`]
        : [centre(t), `${centre(t)}:left`, `${centre(t)}:right`];
    const [effect, extraEffect] = typeof effects === 'string' ? [effects] : effects;
    return {
      id,
      branch,
      ...(nation ? { nation } : {}),
      tier,
      name,
      kind: tier === 6 || tier === 12 ? 'capstone' : branch === 'bastion' ? 'passive' : 'active',
      maxRank: 1,
      cost: TIER_COSTS[tier - 1]!,
      description,
      prereqId: tier === 1 ? null : centre(tier - 1),
      ...(tier === 4 || tier === 8 || tier === 11 ? { prereqIds: forkIds(tier - 1) } : {}),
      ...(tier === 3 || tier === 7 || tier === 10 ? { choiceGroup: centre(tier) } : {}),
      ...(alt ? { choiceOffset: alt === 'left' ? (-1 as const) : (1 as const) } : {}),
      trigger,
      effect,
      ...(extraEffect ? { extraEffect } : {}),
      cap,
      flag: FLAG_IDS.has(id),
      logText: `${name}: ${log ?? (extraEffect ? `${DEFAULT_LOG[effect]} and ${DEFAULT_LOG[extraEffect]}` : DEFAULT_LOG[effect])}`,
    };
  });
}

const UNDODGE_PIERCE = ['UNDODGE', 'PIERCE'] as const;

// --- shared branches (spec sections 3 and 4) ------------------------------------------------

// prettier-ignore
const BASTION: Row[] = [
  ['1', 'Keel', 'NOCRIT', 'crit', 'battle', "Once per battle, while your HP leads the foe's by at least 15 points of max HP, a direct hit against you cannot crit."],
  ['2', 'Ballast', 'UNDODGE', 'dodge', 'state', 'While your HP is at or below 60%, your slot-2 move cannot be dodged.'],
  ['3', 'Quartermaster', 'ORDER', 'pick', 'battle', "If at turn-2 pick time your HP is at least 70% and above the foe's, you play your finisher on turn 2 and the drawn move on the turn the finisher was due (not with Charge, Priority or true-hit moves, and only when both moves share their type and Burn effect).", 'finisher played early ({detail})'],
  ['3:alt', 'Hold the Line', 'CLAMP', 'clamp', 'battle', 'Once per battle, a non-crit hit that would take you from above 50% HP to below 25% leaves you at exactly 25%.'],
  ['4', 'Stonewall', 'SKIP_TICK', 'turn_end', 'battle', 'Once per battle, while your HP is above 75%, the first burn tick on you deals no damage.'],
  ['5', 'Anchor', 'ORDER', 'order', 'battle', "Once per battle, while your HP is below the foe's, when only the foe picked Priority and your SPD is at least 90% of the foe's, you act first."],
  ['6', 'Keystone', 'UNDODGE', 'dodge', 'state', "While your HP is at or below 70% and below the foe's, your direct moves cannot be dodged."],
  ['7', 'Tough Hide', 'REFUSE', 'status', 'battle', "While your HP is at or below 60%, the first status applied to you each battle is refused; the hit's damage still applies."],
  ['7:left', 'Hard Edge', 'PIERCE', 'turn_end', 'battle', "Once per battle, after a turn that ends with your HP at least 80%, your next action pierces the foe's tree defenses."],
  ['7:right', 'Cool Head', 'NOCRIT', 'crit', 'turn', 'While you carry no status, the first direct hit against you each turn cannot crit.'],
  ['8', 'Low Tide', 'VOID', 'damage', 'battle', "Once per battle, while your HP is at or below 25% and a DEF-down you applied is active on the foe, the foe's Priority move deals no damage."],
  ['9', 'Sea Legs', 'UNDODGE', 'turn_end', 'pending', 'After a turn in which you acted second, your next action cannot be dodged.'],
  ['10', 'Iron Chin', 'NOCRIT', 'crit', 'battle', 'Once per battle, while your HP is at or below 25%, a crit against you is cancelled, even a piercing one.'],
  ['10:left', 'Long Haul', 'MULTIPLIER', 'damage', 'state', 'While your HP is above 60%, a crit against you deals normal damage.'],
  ['10:right', 'Overwatch', 'REFUSE', 'status', 'turn', "The foe's opener (slot 1) cannot apply its status to you."],
  ['11', 'Holdfast', ['NOCRIT', 'REFUSE'], 'crit', 'battle', 'Once per battle, while your HP is at least 85%, the first non-piercing hit that would crit you or apply a status to you does neither.', 'blocked {blocked}'],
  ['12', 'Ascendance', 'REFUSE', 'status', 'state', "While your HP is above the foe's HP, every status applied to you is refused."],
];

// prettier-ignore
const STRIKE: Row[] = [
  ['1', "Hunter's Eye", 'GUARANTEED_CRIT', 'hit', 'battle', 'After your crit leaves the foe below 40% HP, your next action is a guaranteed crit.'],
  ['2', 'Opening Volley', 'PIERCE', 'act_pre', 'battle', "Once per battle, on a turn you act first, your direct hit pierces the foe's tree defenses."],
  ['3', 'Burn Ledger', 'UNDODGE', 'status', 'battle', 'Once per battle, when your move lands Burn or DEF-down, your next action cannot be dodged.'],
  ['3:alt', 'Cut Short', 'UNDODGE', 'hit', 'battle', 'Once per battle, after your direct hit leaves the foe below 50% HP, your next action cannot be dodged.'],
  ['4', 'Shortfuse', 'PIERCE', 'hit', 'pending', "After your crit lands, your next action pierces the foe's tree defenses."],
  ['5', 'Execution Window', 'PIERCE', 'act_pre', 'state', "Your direct hits against a foe below 40% HP pierce the foe's tree defenses."],
  ['6', 'Coup Rule', 'MULTIPLIER', 'damage', 'battle', 'Once per battle, a crit that would leave the foe at 35% HP or less deals 2.0x instead of 1.75x.'],
  ['7', 'Pressure Cascade', 'PIERCE', 'act_pre', 'state', "While the foe carries any Burn or your HP trails the foe's by at least 10 points, your direct hits pierce the foe's tree defenses."],
  ['7:left', 'Bleed Line', 'EXTEND', 'turn_end', 'turn', "When your move's DEF-down on the foe would run out at the end of a turn in which your direct hit landed, it stays active through the next turn.", 'DEF-down kept through the next turn'],
  ['7:right', 'Opening Gambit', 'UNDODGE', 'dodge', 'state', 'On turns 1 to 3, your direct moves cannot be dodged.'],
  ['8', 'Heavy Hand', 'MULTIPLIER', 'damage', 'state', 'Your crits against a foe below 60% HP deal 2.0x instead of 1.75x.'],
  ['9', 'Bloodscent', 'GUARANTEED_CRIT', 'hit', 'battle', 'When your hit leaves the foe at or below 25% HP, your next action is a guaranteed crit.'],
  ['10', 'Executioner Prep', 'GUARANTEED_CRIT', 'act_pre', 'turn', 'While the foe is below 25% HP and has a status, your direct move is a guaranteed crit.'],
  ['10:left', 'Breaker', 'PIERCE', 'status', 'battle', "After you apply DEF-down, your next action pierces the foe's tree defenses."],
  ['10:right', 'Retaliation Edge', 'PIERCE', 'hit', 'pending', "After a foe's direct hit lands on you, your next action pierces the foe's tree defenses."],
  ['11', 'Afterburn', 'GUARANTEED_CRIT', 'turn_end', 'battle', "The first tick of your move's Burn in a battle makes your next action a guaranteed crit."],
  ['12', 'Kill Clock', UNDODGE_PIERCE, 'hit', 'battle', "After your hit leaves the foe at 25% HP or less, your next action cannot be dodged and pierces the foe's tree defenses."],
];

// prettier-ignore
const WARD: Row[] = [
  ['1', 'Brace Reflex', 'NOCRIT', 'crit', 'battle', 'While your HP is at or below 30%, the first critical hit against you each battle is cancelled and deals normal damage.'],
  ['2', 'Riposte Step', 'UNDODGE', 'dodge', 'pending', 'After you dodge a direct hit, your next action cannot be dodged.'],
  ['3', 'Layered Shell', 'VOID', 'damage', 'battle', 'The first Priority or Charge move that would crit you deals no damage; its statuses still apply.'],
  ['3:alt', 'Dodge Ledger', 'REFUSE', 'status', 'battle', "After you dodge, the foe's next status applied to you is refused."],
  ['4', 'Bulwark Pulse', 'CLAMP', 'clamp', 'turn', 'A Priority or Charge hit that would take you from above 50% HP to below 50% leaves you at exactly 50%.'],
  ['5', 'Hard Shell', 'REFUSE', 'status', 'battle', 'Once per battle, while your HP is below 35%, the first direct hit against you that would apply a status applies none.'],
  ['6', 'Lastline', 'CLAMP', 'lethal', 'battle', 'Once per battle, a hit that would knock you out from above 30% HP leaves you at 8% of max HP instead.'],
  ['7', 'Layered Plating', 'REFUSE', 'status', 'turn', 'While you carry Burn or DEF-down, the first status the foe would apply or refresh on you each turn is refused.'],
  ['7:left', 'Thermal Break', 'REFUSE', 'status', 'battle', 'The first Burn applied to you each battle is refused.'],
  ['7:right', 'Evasion Plan', 'NOCRIT', 'dodge', 'battle', "Once per battle, after you dodge, the foe's next direct hit on you cannot crit."],
  ['8', 'Second Skin', 'HEAL', 'turn_end', 'battle', 'Once per battle, after a turn in which one direct hit took at least 20% of your max HP, you heal half that hit, at most 5% of max HP.'],
  ['9', 'Debt Refusal', 'REFUSE', 'status', 'battle', 'The first DEF-down the foe applies to you is refused.'],
  ['10', 'Iron Tide', 'VOID', 'damage', 'battle', "Once per battle, while your HP is at or below 40%, the foe's finisher (slot 3) or Charge release deals no damage; its status still applies."],
  ['10:left', 'Slipstream Guard', 'REFUSE', 'status', 'turn', "When you act first on a turn, the foe's first direct hit that turn cannot apply a status."],
  ['10:right', 'Counterfire', 'GUARANTEED_CRIT', 'damage', 'battle', 'Once per battle, the first direct hit against you that a Ward rule voids or refuses arms a guaranteed crit for your next action.'],
  ['11', 'Recovery Cycle', 'HEAL', 'turn_end', 'battle', 'Once per battle, if your HP fell below 35% during a turn, you heal 3% of max HP at the end of that turn.'],
  ['12', 'Bulwark Cap', 'CAP', 'clamp', 'battle', 'Once per battle, a single direct hit against you is capped at 50% of your max HP.'],
];

// prettier-ignore
const TEMPO: Row[] = [
  ['1', 'Opening Setup', 'MULTIPLIER', 'hit', 'battle', 'Once per battle, after your slot-1 move lands Burn or DEF-down, your next different Priority, true-hit, crit-up or charge-release hit on that debuffed foe deals 1.2x (up to 2.4x against a higher-level foe).', 'combo {factor}x'],
  ['2', 'Initiative Read', 'ORDER', 'order', 'turn', "When both sides picked Priority and your live SPD is at least the foe's, you act first."],
  ['3', 'Chain Priority', 'PIERCE', 'act_pre', 'battle', "Once per battle, your Priority move pierces the foe's tree defenses."],
  ['3:alt', 'Read the Board', 'UNDODGE', 'dodge', 'turn', 'On turns you act first, your direct move cannot be dodged.'],
  ['4', 'Rhythm', 'GUARANTEED_CRIT', 'hit', 'battle', 'Once per battle, landing three different moves in a row makes your next action a guaranteed crit.'],
  ['5', 'Tempo Edge', 'PIERCE', 'act_pre', 'battle', "Once per battle, on a turn you act first, your direct action pierces the foe's tree defenses."],
  ['6', 'Flow State', 'CLEANSE', 'hit', 'battle', 'Once per battle, landing three different moves in a row ends your own Burn and DEF-down.'],
  ['7', 'Tempo Lock', 'FIZZLE', 'act_pre', 'battle', "After your move applies Burn (or DEF-down to a foe below 25% HP) on a turn you acted first, the foe's next Priority move fizzles: it still acts first but deals and applies nothing."],
  ['7:left', 'Momentum', 'PIERCE', 'act_pre', 'battle', "Once per battle, your first direct action on a turn you act second pierces the foe's tree defenses."],
  ['7:right', 'Setup Chain', 'GUARANTEED_CRIT', 'status', 'pending', 'Each Burn or DEF-down your move lands arms a guaranteed crit for your next action.'],
  ['8', 'Quick Recovery', 'SKIP_TICK', 'turn_end', 'battle', 'Once per battle, on a turn you acted first and landed a direct hit, your own burn tick that turn is skipped.'],
  ['9', 'Charge Focus', 'UNDODGE', 'dodge', 'state', 'Your charge release cannot be dodged.'],
  ['10', 'Consecutive Priority', 'UNDODGE', 'hit', 'battle', 'After you land a Priority move on two turns in a row, your next action cannot be dodged.'],
  ['10:left', 'Counter Setup', 'PIERCE', 'act_pre', 'pending', "If the foe's Priority move fizzles, misses or is dodged, your next action pierces the foe's tree defenses."],
  ['10:right', 'Order Snap', 'ORDER', 'order', 'battle', "Once per battle, after you act first on two turns in a row, the foe's Priority does not grant first action next turn; live SPD decides and a tie goes to you.", "foe's Priority suppressed (SPD {spd})"],
  ['11', 'Burst Window', 'GUARANTEED_CRIT', 'hit', 'battle', 'Once per battle, after you acted first on the two previous turns, your next action is a guaranteed crit.'],
  ['12', 'Initiative', 'ORDER', 'order', 'battle', 'Once per battle, after you have acted second on two turns, you act first on the next turn, even against Priority.'],
];

// --- nation columns (addendum section 5) ----------------------------------------------------

// prettier-ignore
const FIRE: Row[] = [
  ['1', 'Kindling', 'MULTIPLIER', 'damage', 'state', "While the foe carries any Burn or your move's DEF-down, your crits deal 2.1x instead of 1.75x."],
  ['2', 'Fuel Line', 'UNDODGE', 'turn_end', 'pending', "After a turn that ends with the foe carrying any Burn or your move's DEF-down, your next action cannot be dodged."],
  ['3', 'Kindle Chain', 'GUARANTEED_CRIT', 'status', 'battle', 'Once per battle, when your nation-type hit ignites an unburned foe, your next action is a guaranteed crit.'],
  ['3:alt', 'Burn-Hardened', 'NOCRIT', 'crit', 'turn', "While the foe carries any Burn or your move's DEF-down, the foe's first direct hit each turn cannot crit."],
  ['4', 'Ember Spread', 'PIERCE', 'status', 'battle', "Once per battle, after a Burn you apply lands on the foe, your next action pierces the foe's tree defenses."],
  ['5', 'Heat Tithe', 'GUARANTEED_CRIT', 'hit', 'battle', "Once per battle, after a crit lands on you while the foe carries any Burn or your move's DEF-down, your next action is a guaranteed crit."],
  ['6', 'Inferno', 'PIERCE', 'act_pre', 'turn', "While the foe carries any Burn or your move's DEF-down, or is below 20% HP, your first direct hit each turn pierces the foe's tree defenses."],
  ['7', 'Forge', 'NOCRIT', 'crit', 'turn', "While the foe carries no Burn and no DEF-down from your move, the first crit you take each turn deals normal damage."],
  ['7:left', 'Kiln Skin', 'REFUSE', 'status', 'turn', "While the foe carries any Burn or your move's DEF-down, or while you are below 50% HP, the foe's first direct move each turn that would apply a status to you is refused."],
  ['7:right', 'Sear', 'UNDODGE', 'hit', 'pending', "After your crit lands on a foe carrying any Burn or your move's DEF-down, your next action cannot be dodged."],
  ['8', 'Ash Cloud', 'GUARANTEED_CRIT', 'turn_end', 'battle', "Once per battle, when the foe's Burn ends, your next action is a guaranteed crit."],
  ['9', 'Ignition Chain', 'GUARANTEED_CRIT', 'status', 'battle', 'Once per battle, when your move lands Burn or DEF-down on a foe below 50% HP, your next action is a guaranteed crit.'],
  ['10', 'Crucible', 'GUARANTEED_CRIT', 'act_pre', 'battle', 'Once per battle, while the foe is below 50% HP, your direct hit is a guaranteed crit.'],
  ['10:left', 'Bellows', 'PIERCE', 'turn_end', 'battle', "Once per battle, after the foe ends two turns in a row burned, your next action pierces the foe's tree defenses."],
  ['10:right', 'Afterheat', 'GUARANTEED_CRIT', 'crit', 'battle', "The first crit drawn against you while the foe carries any Burn or your move's DEF-down arms a guaranteed crit for your next action, even if it is cancelled."],
  ['11', 'Hot Streak', UNDODGE_PIERCE, 'hit', 'battle', "Once per battle, after your direct hit lands on a foe carrying any Burn or your move's DEF-down, your next action cannot be dodged and pierces the foe's tree defenses."],
  ['12', 'Pyre Lord', 'MULTIPLIER', 'damage', 'state', "While the foe carries any Burn or your move's DEF-down, or is below 50% HP, your crits deal 2.4x instead of 1.75x."],
];

// prettier-ignore
const WATER: Row[] = [
  ['1', 'Undertow', 'UNDODGE', 'hit', 'battle', 'Once per battle, when your nation-type hit soaks the foe, your next action cannot be dodged.'],
  ['2', 'Drag', 'NOCRIT', 'crit', 'turn', "While the foe is soaked, the foe's first direct hit each turn cannot crit."],
  ['3', 'Undercurrent', 'ORDER', 'order', 'turn', 'While the foe is soaked and picked Priority, its Priority does not grant first action; live SPD decides and a tie goes to you.', "foe's Priority suppressed (SPD {spd})"],
  ['3:alt', 'Slack Tide', 'REFUSE', 'status', 'battle', 'Once per battle, the first status applied to you while the foe is soaked is refused.'],
  ['4', 'Undertow Grip', 'PIERCE', 'hit', 'battle', "Once per battle, after your Soak lands, your next action pierces the foe's tree defenses."],
  ['5', 'Release', 'GUARANTEED_CRIT', 'turn_end', 'battle', "Once per battle, when the foe's soak expires, your next action is a guaranteed crit."],
  ['6', 'Tidal Lock', 'PIERCE', 'act_pre', 'turn', "While the foe is soaked or below 20% HP, the first direct hit you land each turn pierces the foe's tree defenses."],
  ['7', 'Waterlogged', 'REFUSE', 'status', 'turn', 'While the foe is soaked, the first status applied to you each turn is refused.'],
  ['7:left', 'Surge', 'UNDODGE', 'turn_end', 'battle', "The first time the foe's soak expires, your next action cannot be dodged."],
  ['7:right', 'Cold Current', 'UNDODGE', 'turn_end', 'battle', 'Once per battle, after a turn that ends with the foe soaked, your next action cannot be dodged.'],
  ['8', 'Ebb Flow', 'PIERCE', 'turn_end', 'battle', "Once per battle, after a turn that ends with the foe soaked, your next action pierces the foe's tree defenses."],
  ['9', 'Saturate', 'GUARANTEED_CRIT', 'turn_end', 'battle', 'The first time a turn ends with the foe soaked and below 20% HP, your next action is a guaranteed crit.'],
  ['10', 'Deep Current', 'VOID', 'damage', 'battle', "Once per battle, while the foe is soaked or your HP is at or below 15%, the foe's Priority move deals no damage; its statuses still apply."],
  ['10:left', 'Undertow Pull', 'ORDER', 'order', 'battle', 'Once per battle, while the foe is soaked, you act first.'],
  ['10:right', 'Wave Break', 'GUARANTEED_CRIT', 'hit', 'battle', 'Once per battle, when your Soak lands on a foe below 50% HP, your next action is a guaranteed crit.'],
  ['11', 'Brine Skin', 'CLAMP', 'clamp', 'battle', 'Once per battle, while the foe is soaked, a hit that would take you from above 50% HP to below 50% leaves you at exactly 50%.'],
  ['12', 'Maelstrom', 'GUARANTEED_CRIT', 'crit', 'battle', 'Once per battle, while the foe is soaked and below 50% HP, your direct hit is a guaranteed crit.'],
];

// prettier-ignore
const EARTH: Row[] = [
  ['1', 'Stand Firm', 'GUARANTEED_CRIT', 'turn_end', 'battle', "Once per battle, after direct hits land on you on four or more turns in a row while your HP is at or below 50% and trails the foe's by at least 10 points, your next action is a guaranteed crit."],
  ['2', 'Sod', 'UNDODGE', 'turn_end', 'battle', 'Once per battle, after direct hits land on you on two turns in a row, your next action cannot be dodged.'],
  ['3', 'Rootwork', 'CLAMP', 'clamp', 'battle', 'Once per battle, a crit that would take you below 20% HP leaves you at exactly 20%.'],
  ['3:alt', 'Hardpan', 'REFUSE', 'status', 'battle', 'Once per battle, the first status applied to you on a turn after a direct hit landed on you is refused.'],
  ['4', 'Strata', 'PIERCE', 'turn_end', 'pending', "After direct hits land on you on two turns in a row, your next action pierces the foe's tree defenses."],
  ['5', 'Mantle', 'VOID', 'damage', 'battle', 'Once per battle, a Priority crit against you while you have been hit two turns in a row deals no damage; its statuses still apply.'],
  ['6', 'Monolith', 'NOCRIT', 'crit', 'battle', 'Once per battle, the first crit against you while you have been hit three turns in a row and your HP is at or below 35% is cancelled, even by a piercing hit.'],
  ['7', 'Tectonic', 'CLAMP', 'clamp', 'battle', 'Once per battle, a hit that would take you from above 40% HP to below 28% leaves you at exactly 28%.'],
  ['7:left', 'Grounding', 'FIZZLE', 'act_pre', 'battle', "Once per battle, while you have been hit two turns in a row and the foe is at or below 15% HP, the foe's Priority move fizzles."],
  ['7:right', 'Fault Line', 'GUARANTEED_CRIT', 'act_pre', 'battle', "Once per battle, while you have been hit two turns in a row, your HP is below the foe's and the foe is at or below 20% HP, your direct hit is a guaranteed crit."],
  ['8', 'Sediment', 'UNDODGE', 'hit', 'battle', 'After you have taken six direct hits in a battle, your next action cannot be dodged.'],
  ['9', 'Silt', 'REFUSE', 'status', 'battle', "Once per battle, while you took a direct hit last turn, the foe's status-applying move is refused."],
  ['10', 'Hardrock', 'GUARANTEED_CRIT', 'act_pre', 'battle', 'Once per battle, while the foe has been hit four turns in a row and is at or below 20% HP, your direct hit is a guaranteed crit.'],
  ['10:left', 'Quarry', 'GUARANTEED_CRIT', 'act_pre', 'battle', 'Once per battle, while the foe is at or below 30% HP, your direct hit is a guaranteed crit.'],
  ['10:right', 'Mudslide', UNDODGE_PIERCE, 'turn_end', 'battle', "Once per battle, after direct hits land on you on three turns in a row, your next action cannot be dodged and pierces the foe's tree defenses."],
  ['11', 'Terrace', 'CLAMP', 'clamp', 'battle', 'Once per battle, while you took a direct hit last turn, a hit that would take you from above 60% HP to below 40% leaves you at exactly 40%.'],
  ['12', 'Continent', 'MULTIPLIER', 'damage', 'state', 'While you have been hit three turns in a row, your crits deal 1.8x instead of 1.75x.'],
];

// prettier-ignore
const AIR: Row[] = [
  ['1', 'Glide Step', 'PIERCE', 'dodge', 'battle', "Once per battle, after you dodge a direct hit, your next action pierces the foe's tree defenses."],
  ['2', 'Lift', 'UNDODGE', 'dodge', 'state', 'While your speed lead is at least 110% and you acted first this turn, your direct move cannot be dodged.'],
  ['3', 'Headwind', 'NOCRIT', 'crit', 'battle', "Once per battle, while your speed lead is at least 110% and you acted first, the foe's direct hit cannot crit."],
  ['3:alt', 'Crosswind', 'GUARANTEED_CRIT', 'dodge', 'battle', 'Once per battle, the first direct move you dodge makes your next action a guaranteed crit.'],
  ['4', 'Gust Line', 'PIERCE', 'act_pre', 'battle', "Once per battle, while you act first with a speed lead of at least 110%, your direct move pierces the foe's tree defenses."],
  ['5', 'Hover', 'UNDODGE', 'turn_end', 'battle', 'Once per battle, after a turn in which you acted first, your next action cannot be dodged.'],
  ['6', 'Tailwind Crown', 'REFUSE', 'status', 'battle', "Once per battle, while your speed lead is at least 110%, the foe's direct hit applies no status to you."],
  ['7', 'Ridge', 'NOCRIT', 'crit', 'battle', 'Once per battle, the first crit against you while your speed lead is at least 110% and your HP is at or below 50% is cancelled.'],
  ['7:left', 'Dust Devil', 'FIZZLE', 'act_pre', 'turn', "After you dodge a direct hit, the foe's next Priority move fizzles."],
  ['7:right', 'Eddy', 'PIERCE', 'turn_end', 'battle', "Once per battle, after you act first on two turns in a row, your next direct move pierces the foe's tree defenses."],
  ['8', 'Stratosphere', 'MULTIPLIER', 'damage', 'state', 'While your speed lead is at least 112%, your crits deal 1.9x instead of 1.75x.'],
  ['9', 'Thermal Column', 'GUARANTEED_CRIT', 'dodge', 'battle', 'Once per battle, after you dodge a direct hit on a turn you acted first, your next action is a guaranteed crit.'],
  ['10', 'Lee Shore', 'REFUSE', 'status', 'turn', "While your speed lead is at least 105% and you took no direct hit last turn, the foe's first status-applying direct hit each turn is refused."],
  ['10:left', 'Ascent', UNDODGE_PIERCE, 'turn_end', 'battle', "Once per battle, after you act first on two turns in a row, your next action cannot be dodged and pierces the foe's tree defenses."],
  ['10:right', 'Gale Shield', 'PIERCE', 'dodge', 'pending', "After you dodge a direct hit, your next action pierces the foe's tree defenses."],
  ['11', 'Cloud Bank', 'REFUSE', 'status', 'battle', "Once per battle, after you dodge a direct hit, the foe's next status applied to you is refused."],
  ['12', 'Sovereign Wind', 'GUARANTEED_CRIT', 'act_pre', 'battle', 'Once per battle, while your speed lead is at least 110% and the foe is below 30% HP, your direct move is a guaranteed crit.'],
];

const NATION_ROWS: Record<Nation, Row[]> = { water: WATER, fire: FIRE, earth: EARTH, air: AIR };

const SHARED_NODES: readonly TreeNode[] = [
  ...buildColumn('bastion', 'bastion', BASTION),
  ...buildColumn('strike', 'strike', STRIKE),
  ...buildColumn('ward', 'ward', WARD),
  ...buildColumn('tempo', 'tempo', TEMPO),
];
const column = (nation: Nation) =>
  buildColumn(`nation.${nation}`, 'nation', NATION_ROWS[nation], nation);
const NATION_NODES: Record<Nation, readonly TreeNode[]> = {
  water: column('water'),
  fire: column('fire'),
  earth: column('earth'),
  air: column('air'),
};

/** All 136 nodes (68 shared, 68 nation), in roster order: branch, then tier. */
export const TREE_NODES: Record<string, TreeNode> = Object.fromEntries(
  [...SHARED_NODES, ...Object.values(NATION_NODES).flat()].map((n) => [n.id, n]),
);

const CHOICE_GROUPS = new Map<string, TreeNode[]>();
for (const node of Object.values(TREE_NODES)) {
  if (node.choiceGroup) {
    CHOICE_GROUPS.set(node.choiceGroup, [...(CHOICE_GROUPS.get(node.choiceGroup) ?? []), node]);
  }
}

/** The four shared branches (68 nodes). */
export function sharedNodes(): TreeNode[] {
  return [...SHARED_NODES];
}

/** One nation's column (17 nodes). */
export function nationNodes(nation: Nation): TreeNode[] {
  return [...NATION_NODES[nation]];
}

/** Every node a mon of `nation` can see and buy: the shared branches and its own column (85). */
export function treeNodesFor(nation: Nation): TreeNode[] {
  return [...SHARED_NODES, ...NATION_NODES[nation]];
}

export function nodesByBranch(nation: Nation): Record<TreeBranch, TreeNode[]> {
  const out = Object.fromEntries(TREE_BRANCHES.map((b) => [b, [] as TreeNode[]])) as Record<
    TreeBranch,
    TreeNode[]
  >;
  for (const node of treeNodesFor(nation)) out[node.branch].push(node);
  return out;
}

/** Display name of a node's branch; the nation column is named after its nation. */
export function treeBranchLabel(node: TreeNode): string {
  const key = node.nation ?? node.branch;
  return key[0]!.toUpperCase() + key.slice(1);
}

export function treePrerequisiteMet(node: TreeNode, ranks: Record<string, number>): boolean {
  return !node.prereqId || (node.prereqIds ?? [node.prereqId]).some((id) => (ranks[id] ?? 0) > 0);
}

/** Selected alternative, if buying this node would conflict with a learned choice. */
export function treeChoiceConflict(
  node: TreeNode,
  ranks: Record<string, number>,
): TreeNode | undefined {
  return node.choiceGroup
    ? CHOICE_GROUPS.get(node.choiceGroup)?.find(
        (other) => other.id !== node.id && (ranks[other.id] ?? 0) > 0,
      )
    : undefined;
}

/** Legacy main-passive consolidation used by `validateLoadout`: keeps only the equipped main
 * passive and clamps every other positive rank to 1. Roster changes are `normalizeTree`'s job. */
export function singlePurchaseTree(ranks: Record<string, number> = {}): Record<string, number> {
  const main = equippedMainPassive(ranks);
  return Object.fromEntries(
    Object.entries(ranks)
      .filter(([id, rank]) => rank > 0 && (!isSharedPassiveId(id) || id === main))
      .map(([id]) => [id, 1]),
  );
}

// --- shared passives (docs/design/talent-tree.md Shared passives) -------------------------------

export interface SharedPassiveNode {
  /** `shared:${slug}` */
  id: string;
  name: string;
  description: string;
  cost: number;
  /** Always 1 -- a shared passive is either taken or not, no ranks. */
  maxRank: 1;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sharedPassive(name: string, description: string): SharedPassiveNode {
  return { id: `shared:${slugify(name)}`, name, description, cost: 3, maxRank: 1 };
}

export const SHARED_PASSIVE_NODES: readonly SharedPassiveNode[] = [
  sharedPassive('Stone Skin', 'The first hit against you deals 25% less damage.'),
  sharedPassive('Deep Roots', 'Below 25% HP, gain 20% defense for the rest of the battle.'),
  sharedPassive('Bedrock', 'Critical hits against you become normal hits.'),
  sharedPassive('Wildfire', 'Your burns deal 30% more damage and last one extra turn.'),
  sharedPassive('Aftershock', 'Your critical hits also lower the foe’s defense.'),
  sharedPassive('Tailwind', 'Your first equipped move always lands a critical hit.'),
  sharedPassive('Tidal Recovery', 'Critical hits you land heal 10% max HP.'),
  sharedPassive('Updraft', 'Act first on the opening turn.'),
  sharedPassive('Second Breath', 'Once per battle, survive a knockout with 1 HP.'),
  sharedPassive(
    'Ember Heart',
    'The first time you fall below half HP, your next move gains 20% crit chance.',
  ),
];

const SHARED_PASSIVE_BY_ID: Record<string, SharedPassiveNode> = Object.fromEntries(
  SHARED_PASSIVE_NODES.map((n) => [n.id, n]),
);

export function isSharedPassiveId(id: string): boolean {
  return id.startsWith('shared:');
}

/** One main passive slot. Stable roster order makes old multi-passive trees deterministic. */
export function equippedMainPassive(ranks: Record<string, number> = {}): string | null {
  return SHARED_PASSIVE_NODES.find((node) => (ranks[node.id] ?? 0) > 0)?.id ?? null;
}

// --- point budgets --------------------------------------------------------------------------

/**
 * Nation-tree points: 1/level from level 3 to 50, but the first point lands at level 4 (level 3
 * only unlocks the tree) so the level-50 total is 47, matching docs/design/talent-tree.md.
 */
export function pointsAvailable(level: number): number {
  return Math.max(0, Math.min(level, 50) - 3);
}

/** One main-passive purchase, unlocked from level 10. Refunds are always free. */
export const MAX_SHARED_PASSIVE_POINTS = 3;
export function sharedPassivePoints(level: number): number {
  return level >= 10 ? MAX_SHARED_PASSIVE_POINTS : 0;
}

/** A roster node this nation may own (shared branches, or its own column). */
function ownNode(nation: Nation, id: string): TreeNode | undefined {
  const node = TREE_NODES[id];
  return node && (!node.nation || node.nation === nation) ? node : undefined;
}

/** Points already spent in each pool: `nation` is the one tree pool (all five branches), `shared`
 * the main-passive pool. Ignores unknown and other-nation ids rather than throwing, same as
 * `resolveTree` -- used to report `MonState.treePoints`/`sharedPassivePoints` without
 * re-validating a stored tree that was valid when it was written. */
export function treeSpent(
  nation: Nation,
  ranks: Record<string, number> | undefined,
): { nation: number; shared: number } {
  let nationSpent = 0;
  let sharedSpent = 0;
  if (!ranks) return { nation: 0, shared: 0 };
  for (const [id, rank] of Object.entries(ranks)) {
    if (!rank || rank < 1) continue;
    if (isSharedPassiveId(id)) {
      const node = SHARED_PASSIVE_BY_ID[id];
      if (node && id === equippedMainPassive(ranks)) sharedSpent += node.cost;
      continue;
    }
    nationSpent += ownNode(nation, id)?.cost ?? 0;
  }
  return { nation: nationSpent, shared: sharedSpent };
}

// --- validation -------------------------------------------------------------------------------

export type TreeErrorCode =
  | 'TREE_UNKNOWN_NODE'
  | 'WRONG_NATION'
  | 'TREE_RANK'
  | 'TREE_PREREQ'
  | 'TREE_OVER_BUDGET'
  | 'TREE_PASSIVE_LIMIT'
  | 'TREE_CHOICE_LIMIT';
export type ValidateTreeResult = { ok: true } | { ok: false; code: TreeErrorCode; reason: string };

/**
 * Pure validation for `set-loadout`: every node exists (a shared branch, this mon's own nation
 * column, or the shared main-passive pool), every rank is a non-negative integer within the
 * node's `maxRank`, at most one node per fork is bought, every node's prerequisite is met, and
 * the total spent in each pool stays within its budget for `level`.
 */
export function validateTree(
  nation: Nation,
  level: number,
  ranks: Record<string, number>,
  _existingTree: Record<string, number> = {},
): ValidateTreeResult {
  let nationSpent = 0;
  let sharedSpent = 0;
  const mainPassives = SHARED_PASSIVE_NODES.filter((node) => (ranks[node.id] ?? 0) > 0);
  if (mainPassives.length > 1)
    return {
      ok: false,
      code: 'TREE_PASSIVE_LIMIT',
      reason: 'Only one main passive may be learned. Refund the current passive first.',
    };
  for (const [id, rank] of Object.entries(ranks)) {
    if (rank === 0) continue;
    if (!Number.isInteger(rank) || rank < 0) {
      return { ok: false, code: 'TREE_RANK', reason: `${id}: rank must be a non-negative integer` };
    }
    const treeNode = TREE_NODES[id];
    if (treeNode?.nation && treeNode.nation !== nation)
      return {
        ok: false,
        code: 'WRONG_NATION',
        reason: `${id} belongs to the ${treeNode.nation} column, not ${nation}`,
      };
    const node = isSharedPassiveId(id) ? SHARED_PASSIVE_BY_ID[id] : treeNode;
    if (!node)
      return { ok: false, code: 'TREE_UNKNOWN_NODE', reason: `unknown talent node: ${id}` };
    if (rank > node.maxRank) {
      return {
        ok: false,
        code: 'TREE_RANK',
        reason: `${id}: rank ${rank} exceeds max ${node.maxRank}`,
      };
    }
    if (treeNode) {
      if (treeChoiceConflict(treeNode, ranks))
        return {
          ok: false,
          code: 'TREE_CHOICE_LIMIT',
          reason: `${treeNode.name}: choose only one alternative at this fork.`,
        };
      if (!treePrerequisiteMet(treeNode, ranks))
        return {
          ok: false,
          code: 'TREE_PREREQ',
          reason: `${id} requires one of ${(treeNode.prereqIds ?? [treeNode.prereqId]).join(', ')} first`,
        };
    }
    if (isSharedPassiveId(id)) {
      sharedSpent += node.cost;
    } else nationSpent += node.cost;
  }
  const nationBudget = pointsAvailable(level);
  if (nationSpent > nationBudget) {
    return {
      ok: false,
      code: 'TREE_OVER_BUDGET',
      reason: `spent ${nationSpent} talent points, only ${nationBudget} available at level ${level}`,
    };
  }
  const sharedBudget = sharedPassivePoints(level);
  if (sharedSpent > sharedBudget) {
    return {
      ok: false,
      code: 'TREE_OVER_BUDGET',
      reason: `spent ${sharedSpent} shared passive points, only ${sharedBudget} available at level ${level}`,
    };
  }
  return { ok: true };
}

/**
 * Saved-tree normalization (spec 8.6, addendum 9.6), run on every read path: keeps the equipped
 * main passive and every roster node this nation may own (rank clamped to 1), drops everything
 * else (v13 ids such as `water:current:1`, other nations' columns, unknown ids), then refunds
 * nodes whose prerequisite is missing or whose fork already has a kept alternative until the
 * structure is valid. The budget is left to `validateTree`. `legacyReset` is true when anything
 * with a positive rank was dropped or refunded.
 */
export function normalizeTree(
  nation: Nation,
  ranks: Record<string, number> = {},
): { tree: Record<string, number>; legacyReset: boolean } {
  const main = equippedMainPassive(ranks);
  const tree: Record<string, number> = {};
  let legacyReset = false;
  for (const [id, rank] of Object.entries(ranks)) {
    if (!(rank > 0)) continue;
    if (id === main || ownNode(nation, id)) tree[id] = 1;
    else legacyReset = true;
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const node of treeNodesFor(nation)) {
      if (!tree[node.id]) continue;
      if (!treePrerequisiteMet(node, tree) || treeChoiceConflict(node, tree)) {
        delete tree[node.id];
        changed = legacyReset = true;
      }
    }
  }
  return { tree, legacyReset };
}

/**
 * True when going from `prev` to `next` lowers any node's rank -- the design doc's respec
 * definition ("a respec is any change that lowers a node's rank"); respecs are free.
 */
export function isRespec(prev: Record<string, number>, next: Record<string, number>): boolean {
  for (const [id, prevRank] of Object.entries(prev)) {
    if (prevRank > 0 && (next[id] ?? 0) < 1) return true;
  }
  return false;
}

/** `{ branchLabel: { nodeName: 1 } }` grouping for a snapshot/UI summary of a spent tree; the main
 * passive is grouped under "Shared". */
export function treeSummary(
  nation: Nation,
  ranks: Record<string, number>,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [id, rank] of Object.entries(ranks)) {
    if (!rank) continue;
    if (isSharedPassiveId(id)) {
      const passive = SHARED_PASSIVE_BY_ID[id];
      if (passive) (out.Shared ??= {})[passive.name] = 1;
      continue;
    }
    const node = ownNode(nation, id);
    if (node) (out[treeBranchLabel(node)] ??= {})[node.name] = 1;
  }
  return out;
}

// --- resolved tree (battle-ready summary) ------------------------------------------------------

/** Every shared-passive slug wired into `simulateBattle` (docs/design/talent-tree.md Shared
 * passives); matches `SHARED_PASSIVE_NODES`' slugs 1:1. */
export type SharedPassiveSlug =
  | 'stone-skin'
  | 'deep-roots'
  | 'bedrock'
  | 'wildfire'
  | 'aftershock'
  | 'tailwind'
  | 'tidal-recovery'
  | 'updraft'
  | 'second-breath'
  | 'ember-heart';

/** A mon's active tree node ids and equipped main passive, as `simulateBattle` reads them. */
export interface ResolvedTree {
  nodes: ReadonlySet<string>;
  sharedPassives: ReadonlySet<SharedPassiveSlug>;
}

/**
 * Reduces a mon's raw `{ [nodeId]: rank }` tree into the shape `simulateBattle` reads. Pure and
 * cheap enough to call once per side per battle; ignores unknown ids and other nations' column
 * ids rather than throwing, since a stored tree should never invalidate an otherwise-playable
 * battle (mirrors `resolveLoadoutMoves`'s "repair, don't throw" stance for stale move ids).
 */
export function resolveTree(
  nation: Nation,
  ranks: Record<string, number> | undefined,
): ResolvedTree {
  const nodes = new Set<string>();
  const sharedPassives = new Set<SharedPassiveSlug>();
  const main = equippedMainPassive(ranks);
  if (main) sharedPassives.add(main.slice('shared:'.length) as SharedPassiveSlug);
  for (const [id, rank] of Object.entries(ranks ?? {})) {
    if (rank > 0 && ownNode(nation, id)) nodes.add(id);
  }
  return { nodes, sharedPassives };
}

/** Wild Mons buy the shared Strike centre route `strike:1` to `strike:6` tier by tier and never a
 * nation column; their unspent points keep fallback fights forgiving. */
export function defaultBotTree(_nation: Nation, level: number): Record<string, number> {
  const ranks: Record<string, number> = {};
  let remaining = pointsAvailable(level);
  for (let tier = 1; tier <= 6; tier++) {
    const node = TREE_NODES[`strike:${tier}`]!;
    if (node.cost > remaining) break;
    ranks[node.id] = 1;
    remaining -= node.cost;
  }
  return ranks;
}
