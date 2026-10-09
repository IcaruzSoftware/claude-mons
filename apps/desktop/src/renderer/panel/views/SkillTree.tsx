import { useEffect, useRef, useState } from 'preact/hooks';
import {
  NATION_INFO,
  NATION_PASSIVES,
  STANCES,
  STANCE_INFO,
  equippedMainPassive,
  stanceBuildHint,
  type Move,
  SHARED_PASSIVE_NODES,
  TREE_BRANCHES,
  nodesByBranch,
  treeBranchLabel,
  treeNodesFor,
  pointsAvailable,
  sharedPassivePoints,
  treeSpent,
  treePrerequisiteMet,
  treeChoiceConflict,
  type Nation,
  type Stance,
  type TreeBranch,
  type TreeCap,
  type TreeNode,
  type TreeStep,
} from '@claude-mons/shared';
import { Glyph, type GlyphName } from '../../ui/Glyph.tsx';
import {
  SKILL_MAP_SIZE,
  SKILL_MAP_ROOT,
  SKILL_MAP_START,
  STANCE_SKILL_POSITIONS,
  STANCE_SKILL_LABEL,
  PASSIVE_SKILL_LABEL,
  SHARED_SKILL_GROUPS,
  skillMapPosition,
  skillBranchLabelPosition,
  sharedSkillPosition,
  zoomSkillMap,
} from './skillMapLayout.ts';

const ROLE_LABELS = {
  offense: 'Offensive',
  defense: 'Defensive',
  tempo: 'Tempo',
  elemental: 'Elemental',
};
type SkillRole = keyof typeof ROLE_LABELS;
const SHARED_ROLES: Record<string, SkillRole> = {
  'stone-skin': 'defense',
  'deep-roots': 'defense',
  bedrock: 'defense',
  wildfire: 'offense',
  aftershock: 'offense',
  tailwind: 'offense',
  'tidal-recovery': 'defense',
  updraft: 'tempo',
  'second-breath': 'defense',
  'ember-heart': 'offense',
};
const STANCE_ROLES: Record<Stance, SkillRole> = {
  fury: 'offense',
  bulwark: 'defense',
  gale: 'tempo',
};
const BRANCH_ROLES: Record<TreeBranch, SkillRole> = {
  bastion: 'defense',
  strike: 'offense',
  ward: 'defense',
  tempo: 'tempo',
  nation: 'elemental',
};
const skillRole = (node: TreeNode): SkillRole => BRANCH_ROLES[node.branch];
const BRANCH_TAGS: Record<Exclude<TreeBranch, 'nation'>, string> = {
  bastion: 'Passive',
  strike: 'Offense',
  ward: 'Defense',
  tempo: 'Order',
};
/** Short names for the nation columns (talent-tree addendum section 5 themes); none repeats a
 * node name. */
const NATION_COLUMN_NAMES: Record<Nation, string> = {
  fire: 'Heat',
  water: 'Riptide',
  earth: 'Steadfast',
  air: 'Windward',
};
const STEP_TEXT: Record<TreeStep | 'aura', string> = {
  turn_start: 'Turn start',
  order: 'Turn order',
  pick: 'Move pick',
  act_pre: 'Before an action',
  dodge: 'Dodge roll',
  crit: 'Crit roll',
  damage: 'Damage',
  clamp: 'Damage taken',
  lethal: 'Knockout',
  hit: 'After a hit',
  status: 'Status applied',
  turn_end: 'Turn end',
  aura: 'Always',
};
const CAP_TEXT: Record<TreeCap, string> = {
  battle: 'Once per battle',
  turn: 'Once per turn',
  pending: 'Arms your next action',
  state: 'While its condition holds',
};
const STATUS_NAMES = { burn: 'Burn', def_down: 'DEF-down' } as const;
type StatusEffect = keyof typeof STATUS_NAMES;
/** Shared nodes that read a Burn or DEF-down the mon applies itself (talent-tree spec 2.3/2.4).
 * Each group needs one unlocked move with one of its effects. */
const STATUS_NEEDS: Record<string, readonly (readonly StatusEffect[])[]> = {
  'tempo:1': [['burn', 'def_down']],
  'tempo:7': [['burn', 'def_down']],
  'tempo:7:right': [['burn', 'def_down']],
  'strike:3': [['burn', 'def_down']],
  'strike:7:left': [['def_down']],
  'strike:10:left': [['def_down']],
  'strike:11': [['burn']],
  'bastion:8': [['def_down']],
};

/** Fire nodes that never need a status: Forge reads its absence; Inferno, Crucible and Pyre Lord
 * also work on a low foe. */
const FIRE_ALWAYS = new Set(['nation.fire:6', 'nation.fire:7', 'nation.fire:10', 'nation.fire:12']);
/** Water nodes with a second condition that needs no soak: Tidal Lock (a foe below 20%) and Deep
 * Current (own HP at or below 15%). */
const WATER_ALWAYS = new Set(['nation.water:6', 'nation.water:10']);
/** Fire nodes that read only a Burn (Kindle or a Burn move), not heat from a DEF-down. */
const FIRE_BURN_ONLY = new Set(['nation.fire:4', 'nation.fire:8', 'nation.fire:10:left']);

/** Why `node` cannot fire with this mon's moves, or null when it can. Shared nodes check the
 * unlocked move pool (with the level the missing move unlocks); fire and water column nodes need a
 * nation-type move in the equipped loadout, since Kindle and Soak proc only on nation-type hits.
 * Fire "heat" is any Burn or a DEF-down from the mon's own move (step D2 tuning). */
export function treeNodeInertNote(
  node: TreeNode,
  movePool: readonly Move[],
  level: number,
  equippedMoves: readonly Move[],
): string | null {
  if (node.id === 'nation.fire:9') {
    // Ignition Chain arms only on a status your move applies.
    if (equippedMoves.some((m) => m.effect === 'burn' || m.effect === 'def_down')) return null;
    return 'Needs a Burn or DEF-down move in your loadout to arm';
  }
  if (
    (node.nation === 'water' && !WATER_ALWAYS.has(node.id)) ||
    (node.nation === 'fire' && !FIRE_ALWAYS.has(node.id))
  ) {
    const fire = node.nation === 'fire';
    const burnCounts = fire && node.id !== 'nation.fire:3';
    const defDownCounts = burnCounts && !FIRE_BURN_ONLY.has(node.id);
    if (
      equippedMoves.some(
        (m) =>
          m.type === 'nation' ||
          (burnCounts && m.effect === 'burn') ||
          (defDownCounts && m.effect === 'def_down'),
      )
    )
      return null;
    const extra = defDownCounts ? ', Burn or DEF-down' : burnCounts ? ' or Burn' : '';
    return `Needs a nation-type${extra} move in your loadout to arm (${NATION_PASSIVES[node.nation].name})`;
  }
  const missing = (STATUS_NEEDS[node.id] ?? []).filter(
    (group) =>
      !movePool.some((m) => m.unlocksAt <= level && group.includes(m.effect as StatusEffect)),
  );
  if (!missing.length) return null;
  return missing
    .map((group) => {
      const levels = movePool
        .filter((m) => group.includes(m.effect as StatusEffect))
        .map((m) => m.unlocksAt);
      const at = levels.length ? Math.min(...levels) : null;
      return `Needs a ${group.map((e) => STATUS_NAMES[e]).join(' or ')} move, ${at ? `unlocks at level ${at}` : "none in this species' move pool"}`;
    })
    .join(' · ');
}

/** Direct manipulation map: click buys, context click refunds, every mutation autosaves. */
export function SkillTree({
  nation,
  ranks,
  level,
  onAdd,
  onRemove,
  onPassive,
  stance,
  onStance,
  equippedMoves,
  movePool,
  notice,
  onReset,
  onClose,
  saving,
  error,
}: {
  nation: Nation;
  ranks: Record<string, number>;
  level: number;
  onAdd: (node: TreeNode) => void;
  onRemove: (node: TreeNode) => void;
  onPassive: (id: string, cost: number, remove?: boolean) => void;
  stance: Stance | null;
  onStance: (stance: Stance | null) => void;
  equippedMoves: readonly Move[];
  /** The species' whole move pool, for the "unlocks at level N" inert marker. */
  movePool: readonly Move[];
  /** One-time line for the HUD, e.g. the legacy tree rebuild notice. */
  notice: string | null;
  onReset: () => void;
  onClose: () => void;
  saving: boolean;
  error: string | null;
}) {
  const nodes = treeNodesFor(nation),
    byBranch = nodesByBranch(nation);
  const position = (n: TreeNode) =>
    skillMapPosition(TREE_BRANCHES.indexOf(n.branch), n.tier, n.choiceOffset);
  const spent = treeSpent(nation, ranks),
    remaining = pointsAvailable(level) - spent.nation;
  const mainPassive = equippedMainPassive(ranks);
  const sharedState = (id: string, cost: number) =>
    (ranks[id] ?? 0) > 0
      ? 'Learned'
      : mainPassive
        ? 'Passive slot occupied'
        : level < 10
          ? 'Level 10'
          : sharedPassivePoints(level) - spent.shared < cost
            ? 'Not enough points'
            : 'Available';
  const sharedRemaining = sharedPassivePoints(level) - spent.shared;
  const viewport = useRef<HTMLDivElement>(null),
    tooltip = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, zoom: 0.75 });
  const [selected, setSelected] = useState('core');
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  useEffect(() => {
    const el = viewport.current!;
    const center = () => {
      const zoom = Math.max(
        0.5,
        Math.min(
          1,
          (el.clientWidth - 100) / SKILL_MAP_SIZE.width,
          (el.clientHeight - 120) / SKILL_MAP_SIZE.height,
        ),
      );
      setView({
        x: el.clientWidth / 2 - SKILL_MAP_START.x * zoom,
        y: el.clientHeight / 2 - SKILL_MAP_START.y * zoom,
        zoom,
      });
    };
    center();
    const observer = new ResizeObserver(center);
    observer.observe(el);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const box = el.getBoundingClientRect();
      setView((v) =>
        zoomSkillMap(v, v.zoom * Math.exp(-e.deltaY * 0.002), {
          x: e.clientX - box.left,
          y: e.clientY - box.top,
        }),
      );
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      observer.disconnect();
      el.removeEventListener('wheel', wheel);
    };
  }, []);
  const showTip = (id: string, x: number, y: number) =>
    setHover({
      id,
      x: Math.max(8, Math.min(x - 12, innerWidth - 308)),
      y: Math.max(8, y - (tooltip.current?.offsetHeight ?? 240) - 18),
    });
  const events = (id: string, p: { x: number; y: number }) => ({
    onPointerEnter: (e: PointerEvent) => showTip(id, e.clientX, e.clientY),
    onPointerMove: (e: PointerEvent) => showTip(id, e.clientX, e.clientY),
    onPointerLeave: () => setHover(null),
    onBlur: () => setHover(null),
    onFocus: (e: FocusEvent) => {
      const button = e.currentTarget as HTMLElement;
      if (!button.matches(':focus-visible')) return;
      const el = viewport.current!;
      setView((v) => ({
        ...v,
        x: el.clientWidth / 2 - p.x * v.zoom,
        y: el.clientHeight / 2 - p.y * v.zoom,
      }));
      const box = el.getBoundingClientRect();
      showTip(id, box.x + box.width / 2, box.y + box.height / 2);
    },
  });
  const stateOf = (node: TreeNode) =>
    (ranks[node.id] ?? 0) > 0
      ? 'Learned'
      : treeChoiceConflict(node, ranks)
        ? 'Alternative chosen'
        : !treePrerequisiteMet(node, ranks)
          ? 'Locked'
          : remaining < node.cost
            ? 'Not enough points'
            : 'Available';
  const classes = (state: string) =>
    state === 'Learned'
      ? ' learned'
      : state === 'Locked' ||
          state === 'Level 10' ||
          state === 'Passive slot occupied' ||
          state === 'Alternative chosen'
        ? ' gated'
        : state === 'Not enough points'
          ? ' unaffordable'
          : '';
  const badge = (state: string, cost: number) =>
    state === 'Learned'
      ? '✓ Learned'
      : state === 'Alternative chosen'
        ? 'Other choice'
        : state === 'Level 10'
          ? 'Lvl 10'
          : state === 'Locked'
            ? 'Locked'
            : state === 'Passive slot occupied'
              ? 'Slot full'
              : state === 'Not enough points'
                ? 'Need points'
                : `${cost} ${cost === 1 ? 'pt' : 'pts'}`;
  const glyph = (node: TreeNode): GlyphName =>
    node.kind === 'capstone'
      ? 'spark'
      : node.kind === 'passive'
        ? 'leaf'
        : ['GUARANTEED_CRIT', 'PIERCE', 'MULTIPLIER', 'UNDODGE'].includes(node.effect)
          ? 'swords'
          : ['ORDER', 'FIZZLE'].includes(node.effect)
            ? 'wind'
            : ['HEAL', 'CLEANSE'].includes(node.effect)
              ? 'drop'
              : 'gear';
  const hoveredNode = nodes.find((node) => node.id === hover?.id);
  const hoveredPassive = SHARED_PASSIVE_NODES.find((node) => node.id === hover?.id);
  const hoveredStance = STANCES.find((id) => `stance:${id}` === hover?.id);
  const title =
    hoveredNode?.name ??
    hoveredPassive?.name ??
    (hoveredStance
      ? `${STANCE_INFO[hoveredStance].name} · ${STANCE_INFO[hoveredStance].passive}`
      : `${NATION_INFO[nation].name} · ${NATION_PASSIVES[nation].name}`);
  const inertNote = (node: TreeNode) => treeNodeInertNote(node, movePool, level, equippedMoves);
  return (
    <div class={`skill-tree ${nation}`}>
      <div
        class="skill-map-viewport"
        ref={viewport}
        tabIndex={0}
        role="region"
        aria-label="Skill map"
        onContextMenu={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (e.button !== 0 || (e.target as Element).closest('button')) return;
          setHover(null);
          drag.current = { x: e.clientX, y: e.clientY, originX: view.x, originY: view.y };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const start = drag.current;
          if (start)
            setView((v) => ({
              ...v,
              x: start.originX + e.clientX - start.x,
              y: start.originY + e.clientY - start.y,
            }));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          const offset = {
            ArrowLeft: [50, 0],
            ArrowRight: [-50, 0],
            ArrowUp: [0, 50],
            ArrowDown: [0, -50],
          }[e.key];
          if (offset) {
            e.preventDefault();
            setView((v) => ({ ...v, x: v.x + offset[0]!, y: v.y + offset[1]! }));
          } else if (['+', '=', '-'].includes(e.key)) {
            e.preventDefault();
            const el = viewport.current!;
            setView((v) =>
              zoomSkillMap(v, v.zoom * (e.key === '-' ? 1 / 1.2 : 1.2), {
                x: el.clientWidth / 2,
                y: el.clientHeight / 2,
              }),
            );
          }
        }}
      >
        <div
          class="skill-map-world"
          style={{
            width: SKILL_MAP_SIZE.width,
            height: SKILL_MAP_SIZE.height,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
          }}
        >
          <svg
            class="map-connections"
            width={SKILL_MAP_SIZE.width}
            height={SKILL_MAP_SIZE.height}
            aria-hidden="true"
          >
            <circle class="map-orbit" cx={SKILL_MAP_ROOT.x} cy={SKILL_MAP_ROOT.y} r={290} />
            <circle class="map-orbit" cx={SKILL_MAP_ROOT.x} cy={SKILL_MAP_ROOT.y} r={1060} />
            {nodes.flatMap((node) =>
              (node.prereqIds ?? [node.prereqId]).map((id) => {
                const from = id ? position(nodes.find((n) => n.id === id)!) : SKILL_MAP_ROOT;
                const to = position(node);
                const state = node.prereqIds && id && !(ranks[id] ?? 0) ? 'Locked' : stateOf(node);
                return (
                  <path
                    key={`${node.id}:${id}`}
                    data-edge-id={node.id}
                    class={`map-edge${classes(state)}${state === 'Available' ? ' available' : ''}`}
                    fill="none"
                    d={`M ${from.x} ${from.y} Q ${(from.x + to.x) / 2 - (to.y - from.y) * 0.12} ${(from.y + to.y) / 2 + (to.x - from.x) * 0.12}, ${to.x} ${to.y}`}
                  />
                );
              }),
            )}
          </svg>
          <div
            class="map-choice-caption map-stance-area"
            style={{ left: STANCE_SKILL_LABEL.x, top: STANCE_SKILL_LABEL.y }}
          >
            <b>Stance · {stance ? STANCE_INFO[stance].name : 'Missing'}</b>
            <small>Choose one</small>
          </div>
          <div
            class="map-choice-caption map-main-passive-area"
            style={{ left: PASSIVE_SKILL_LABEL.x, top: PASSIVE_SKILL_LABEL.y }}
          >
            <b>Main passive · {mainPassive ? '1/1' : '0/1'}</b>
            <small>
              {mainPassive
                ? `${SHARED_PASSIVE_NODES.find((node) => node.id === mainPassive)!.name} active · Other passives blocked`
                : level < 10
                  ? 'Unlocks at level 10 · Choose one'
                  : 'Choose one · Level 10+'}
            </small>
          </div>
          <button
            data-role="elemental"
            class={`map-node map-core${selected === 'core' ? ' selected' : ''}`}
            style={{ left: SKILL_MAP_ROOT.x, top: SKILL_MAP_ROOT.y }}
            {...events('core', SKILL_MAP_ROOT)}
            aria-label={`${NATION_INFO[nation].name} skill tree starting point`}
            onClick={() => setSelected('core')}
          >
            <Glyph name="mon" size={32} />
            <span class="map-node-name">
              {NATION_INFO[nation].name} · {NATION_PASSIVES[nation].name}
              <small>Nation trait</small>
            </span>
          </button>
          {STANCES.map((id) => {
            const p = STANCE_SKILL_POSITIONS[id],
              info = STANCE_INFO[id];
            return (
              <button
                key={id}
                {...events(`stance:${id}`, p)}
                data-stance-id={id}
                data-role={STANCE_ROLES[id]}
                aria-label={`${info.name}: ${info.passive}, ${stance === id ? 'Equipped' : 'Available'}, choose one`}
                aria-pressed={stance === id}
                class={`map-node map-passive${stance === id ? ' learned' : ''}${selected === `stance:${id}` ? ' selected' : ''}`}
                style={{ left: p.x, top: p.y }}
                onClick={() => {
                  setSelected(`stance:${id}`);
                  onStance(id);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (stance === id) onStance(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Delete' && stance === id) {
                    e.preventDefault();
                    onStance(null);
                  }
                }}
              >
                <Glyph
                  name={id === 'fury' ? 'swords' : id === 'bulwark' ? 'gear' : 'wind'}
                  size={24}
                />
                <span class="map-node-rank">{stance === id ? '✓ Equipped' : 'Free'}</span>
                <span class="map-node-name">
                  {info.name}
                  <small>
                    {info.passive} · {ROLE_LABELS[STANCE_ROLES[id]]}
                  </small>
                </span>
              </button>
            );
          })}
          {TREE_BRANCHES.map((branch, i) => (
            <span
              class="map-branch-label"
              key={branch}
              data-branch={branch}
              style={{ left: skillBranchLabelPosition(i).x, top: skillBranchLabelPosition(i).y }}
            >
              {branch === 'nation'
                ? NATION_COLUMN_NAMES[nation]
                : treeBranchLabel(byBranch[branch][0]!)}
              <small>
                {branch === 'nation' ? `${NATION_INFO[nation].name} column` : BRANCH_TAGS[branch]}
              </small>
            </span>
          ))}
          {nodes.map((node) => {
            const p = position(node),
              state = stateOf(node),
              role = skillRole(node),
              inert = inertNote(node);
            return (
              <button
                key={node.id}
                {...events(node.id, p)}
                data-node-id={node.id}
                data-role={role}
                data-state={state}
                data-inert={inert ? 'true' : undefined}
                aria-label={`${node.name} · ${ROLE_LABELS[role]} · ${state}${
                  inert
                    ? ` · Inactive: ${inert
                        .split(' · ')
                        .map((part) => part.split(',')[0])
                        .join(' · ')}`
                    : ''
                }`}
                aria-pressed={state === 'Learned'}
                class={`map-node${node.kind === 'passive' ? ' map-passive' : ''}${node.kind === 'capstone' ? ' map-ultimate' : ''}${classes(state)}${state === 'Available' ? ' available' : ''}${inert ? ' inert' : ''}${selected === node.id ? ' selected' : ''}`}
                style={{ left: p.x, top: p.y }}
                onClick={() => {
                  setSelected(node.id);
                  onAdd(node);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onRemove(node);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Delete') {
                    e.preventDefault();
                    onRemove(node);
                  }
                }}
              >
                <Glyph name={glyph(node)} size={node.kind === 'capstone' ? 28 : 20} />
                <span class="map-node-rank">{badge(state, node.cost)}</span>
                <span class="map-node-name">
                  {node.name}
                  <small>
                    {ROLE_LABELS[role]} ·{' '}
                    {node.kind === 'capstone'
                      ? 'Capstone'
                      : node.kind === 'passive'
                        ? 'Passive'
                        : 'Active'}
                  </small>
                </span>
              </button>
            );
          })}
          {SHARED_SKILL_GROUPS.map((group) => (
            <span
              class="map-cluster-label"
              key={group.name}
              style={{ left: group.x, top: group.y }}
            >
              {group.name}
            </span>
          ))}
          {SHARED_PASSIVE_NODES.map((node) => {
            const p = sharedSkillPosition(node.id),
              role = SHARED_ROLES[node.id.slice(7)]!;
            const state = sharedState(node.id, node.cost);
            return (
              <button
                key={node.id}
                {...events(node.id, p)}
                data-passive-id={node.id}
                data-role={role}
                data-state={state}
                aria-label={`${node.name} · ${ROLE_LABELS[role]} · ${state}`}
                aria-pressed={state === 'Learned'}
                class={`map-node map-passive map-shared-node${classes(state)}${state === 'Available' ? ' available' : ''}${selected === node.id ? ' selected' : ''}`}
                style={{ left: p.x, top: p.y }}
                onClick={() => {
                  setSelected(node.id);
                  onPassive(node.id, node.cost);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onPassive(node.id, node.cost, true);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Delete') {
                    e.preventDefault();
                    onPassive(node.id, node.cost, true);
                  }
                }}
              >
                <Glyph
                  name={role === 'defense' ? 'gear' : role === 'tempo' ? 'wind' : 'flame'}
                  size={24}
                />
                <span class="map-node-rank">{badge(state, node.cost)}</span>
                <span class="map-node-name">
                  {node.name}
                  <small>{ROLE_LABELS[role]} · Passive</small>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div class="map-hud" aria-live="polite">
        <b>
          {remaining} skill {remaining === 1 ? 'point' : 'points'}
        </b>
        <span>
          {sharedRemaining} passive {sharedRemaining === 1 ? 'point' : 'points'}
        </span>
        <small>{error ?? (saving ? 'Saving…' : 'Automatically saved')}</small>
        {notice && <small>{notice}</small>}
      </div>
      <div class="map-menu">
        <button onClick={onReset}>Reset all</button>
        <button onClick={onClose} aria-label="Close Skill Tree">
          ×
        </button>
      </div>
      <p class="map-instructions">
        Left click: learn · Right click: refund · Scroll: zoom · Drag: explore
      </p>
      {hover && (
        <div
          ref={tooltip}
          class="map-tooltip"
          role="tooltip"
          style={{ left: hover.x, top: hover.y }}
        >
          <b>{title}</b>
          {hoveredNode || hoveredPassive ? (
            <>
              <p>{(hoveredNode ?? hoveredPassive)!.description}</p>
              <p>
                {hoveredNode
                  ? ROLE_LABELS[skillRole(hoveredNode)]
                  : ROLE_LABELS[SHARED_ROLES[hoveredPassive!.id.slice(7)]!]}{' '}
                ·{' '}
                {hoveredNode
                  ? stateOf(hoveredNode)
                  : sharedState(hoveredPassive!.id, hoveredPassive!.cost)}
              </p>
              <p>
                {(hoveredNode ?? hoveredPassive)!.cost} {hoveredNode ? 'skill' : 'passive'}{' '}
                {(hoveredNode ?? hoveredPassive)!.cost === 1 ? 'point' : 'points'} · Buy once
                {hoveredPassive ? ' · Level 10 · Only ONE main passive' : ''}
                {hoveredNode?.prereqId
                  ? ` · Requires ${hoveredNode.prereqIds ? 'one of: ' : ''}${(hoveredNode.prereqIds ?? [hoveredNode.prereqId]).map((id) => nodes.find((n) => n.id === id)!.name).join(' / ')}`
                  : ''}
                {hoveredNode?.choiceGroup ? ' · Choose one at this fork' : ''}
              </p>
              {hoveredNode && (
                <p>
                  {STEP_TEXT[hoveredNode.trigger]} · {CAP_TEXT[hoveredNode.cap]}
                </p>
              )}
              {hoveredNode && inertNote(hoveredNode) && (
                <p class="map-inert-note">{inertNote(hoveredNode)}</p>
              )}
            </>
          ) : hoveredStance ? (
            <>
              <p>{STANCE_INFO[hoveredStance].description}</p>
              <p>{stanceBuildHint(hoveredStance, equippedMoves)}</p>
              <p>Free · Choose one stance · Click to equip. Right click clears the selection.</p>
            </>
          ) : (
            <>
              <p>
                {NATION_PASSIVES[nation].name}: {NATION_PASSIVES[nation].description}
              </p>
              <p>
                Five paths start here: Bastion, Strike, Ward, Tempo and your{' '}
                {NATION_INFO[nation].name} column, {NATION_COLUMN_NAMES[nation]}. All share one pool
                of skill points.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
