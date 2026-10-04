import { useEffect, useRef, useState } from 'preact/hooks';
import {
  FOLLOW_THROUGH_MULT,
  NATION_INFO,
  NATION_PASSIVES,
  STANCES,
  STANCE_INFO,
  equippedMainPassive,
  sharedPassivePrereq,
  stanceBuildHint,
  type Move,
  SHARED_PASSIVE_NODES,
  nationNodes,
  pointsAvailable,
  sharedPassivePoints,
  treeSpent,
  type Nation,
  type Stance,
  type TreeNode,
} from '@claude-mons/shared';
import { Glyph, type GlyphName } from '../../ui/Glyph.tsx';
import {
  SKILL_MAP_SIZE,
  SKILL_MAP_ROOT,
  STANCE_SKILL_POSITIONS,
  STANCE_SKILL_AREA,
  PASSIVE_SKILL_AREA,
  SHARED_SKILL_GROUPS,
  skillMapPosition,
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
const DEFENSIVE_PASSIVES = new Set([
  'slow-leak',
  'watershed',
  'undercurrent',
  'flashover',
  'canopy-cover',
  'mulch-layer',
  'load-bearing',
  'reinforced-crust',
  'fog-bank',
  'static-charge',
  'kindled-recovery',
  'flow-state',
]);
const TEMPO_PASSIVES = new Set(['slipstream', 'thermal-lift', 'quick-setup']);
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
function skillRole(node: TreeNode, moves: readonly Move[]): SkillRole {
  if (node.stat) return node.stat === 'atk' ? 'offense' : node.stat === 'spd' ? 'tempo' : 'defense';
  if (node.kind === 'moveUpgrade') {
    const move = moves[node.slot - 1];
    return move?.effect === 'drain' || move?.effect === 'shield_first'
      ? 'defense'
      : move?.type === 'nation'
        ? 'elemental'
        : 'offense';
  }
  if (node.capstone) {
    const kind = node.capstone.kind;
    if (kind === 'flatStat')
      return node.capstone.stat === 'atk'
        ? 'offense'
        : node.capstone.stat === 'spd'
          ? 'tempo'
          : 'defense';
    return ['flatStat', 'phoenix', 'hitFloor', 'damageCap'].includes(kind)
      ? 'defense'
      : ['chargeInstant', 'actFirstAfterDamage', 'defDownAlsoSpd'].includes(kind)
        ? 'tempo'
        : kind === 'critMultiplier'
          ? 'elemental'
          : 'offense';
  }
  return node.passive === 'pressure-head'
    ? 'elemental'
    : DEFENSIVE_PASSIVES.has(node.passive ?? '')
      ? 'defense'
      : TEMPO_PASSIVES.has(node.passive ?? '')
        ? 'tempo'
        : 'offense';
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
  stance: Stance;
  onStance: (stance: Stance) => void;
  equippedMoves: readonly Move[];
  onReset: () => void;
  onClose: () => void;
  saving: boolean;
  error: string | null;
}) {
  const nodes = nationNodes(nation),
    branches = [...new Set(nodes.map((n) => n.branch))];
  const position = (n: TreeNode) => skillMapPosition(branches.indexOf(n.branch), n.tier);
  const spent = treeSpent(nation, ranks),
    remaining = pointsAvailable(level) - spent.nation;
  const mainPassive = equippedMainPassive(ranks);
  const sharedState = (id: string, cost: number) =>
    (ranks[id] ?? 0) > 0
      ? 'Learned'
      : mainPassive
        ? 'Passive slot occupied'
        : !(ranks[sharedPassivePrereq(nation, id).id] ?? 0)
          ? 'Locked'
          : sharedPassivePoints(level) - spent.shared < cost
            ? 'Not enough points'
            : 'Available';
  const sharedRemaining = sharedPassivePoints(level) - spent.shared;
  const viewport = useRef<HTMLDivElement>(null),
    tooltip = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, zoom: 0.75 });
  const [selected, setSelected] = useState('flow');
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const drag = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  useEffect(() => {
    const el = viewport.current!;
    const center = () => {
      const zoom = Math.max(
        0.6,
        Math.min(
          1,
          (el.clientWidth - 100) / SKILL_MAP_SIZE.width,
          (el.clientHeight - 120) / SKILL_MAP_SIZE.height,
        ),
      );
      setView({
        x: (el.clientWidth - SKILL_MAP_SIZE.width * zoom) / 2,
        y: (el.clientHeight - SKILL_MAP_SIZE.height * zoom) / 2,
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
      : node.prereqId && !(ranks[node.prereqId] ?? 0)
        ? 'Locked'
        : remaining < node.cost
          ? 'Not enough points'
          : 'Available';
  const classes = (state: string) =>
    state === 'Learned'
      ? ' learned'
      : state === 'Locked' || state === 'Passive slot occupied'
        ? ' gated'
        : state === 'Not enough points'
          ? ' unaffordable'
          : '';
  const badge = (state: string, cost: number) =>
    state === 'Learned'
      ? '✓ Learned'
      : state === 'Locked'
        ? 'Locked'
        : state === 'Passive slot occupied'
          ? 'Slot full'
          : state === 'Not enough points'
            ? 'Need points'
            : `${cost} pts`;
  const glyph = (node: TreeNode): GlyphName =>
    node.kind === 'capstone'
      ? 'spark'
      : node.kind === 'passive'
        ? 'leaf'
        : node.kind === 'moveUpgrade' || node.stat === 'atk'
          ? 'swords'
          : node.stat === 'spd'
            ? 'wind'
            : node.stat === 'hp'
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
      : `${NATION_INFO[nation].name} · Flow`);
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
            <circle class="map-orbit" cx={SKILL_MAP_ROOT.x} cy={SKILL_MAP_ROOT.y} r={180} />
            <circle class="map-orbit" cx={SKILL_MAP_ROOT.x} cy={SKILL_MAP_ROOT.y} r={375} />
            {nodes.map((node) => {
              const from = node.prereqId
                  ? position(nodes.find((n) => n.id === node.prereqId)!)
                  : SKILL_MAP_ROOT,
                to = position(node);
              return (
                <line
                  key={node.id}
                  class={`map-edge${classes(stateOf(node))}${stateOf(node) === 'Available' ? ' available' : ''}`}
                  data-edge-id={node.id}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                />
              );
            })}
            {STANCES.map((id) => (
              <line
                key={id}
                class={`map-shared-edge${stance === id ? ' learned' : ' available'}`}
                data-edge-id={`stance:${id}`}
                x1={SKILL_MAP_ROOT.x}
                y1={SKILL_MAP_ROOT.y}
                x2={STANCE_SKILL_POSITIONS[id].x}
                y2={STANCE_SKILL_POSITIONS[id].y}
              />
            ))}
            {SHARED_SKILL_GROUPS.map((group) => {
              const gate = sharedPassivePrereq(nation, `shared:${group.ids[0]}`),
                from = position(gate);
              const groupState = group.ids.some((id) => (ranks[`shared:${id}`] ?? 0) > 0)
                ? 'Learned'
                : sharedState(`shared:${group.ids[0]}`, 3);
              return (
                <g key={group.name}>
                  <path
                    class={`map-shared-edge${classes(groupState)}${groupState === 'Available' ? ' available' : ''}`}
                    fill="none"
                    d={`M ${from.x} ${from.y} C ${from.x + 70} ${from.y + 130}, ${group.x - 100} ${group.y - 180}, ${group.x} ${group.y}`}
                  />
                  {group.ids.map((slug) => {
                    const to = sharedSkillPosition(`shared:${slug}`),
                      state = sharedState(`shared:${slug}`, 3);
                    return (
                      <line
                        key={slug}
                        data-edge-id={`shared:${slug}`}
                        class={`map-shared-edge${classes(state)}${state === 'Available' ? ' available' : ''}`}
                        x1={group.x}
                        y1={group.y}
                        x2={to.x}
                        y2={to.y}
                      />
                    );
                  })}
                </g>
              );
            })}
          </svg>
          <div
            class="map-choice-area map-stance-area"
            style={{
              left: STANCE_SKILL_AREA.x,
              top: STANCE_SKILL_AREA.y,
              width: STANCE_SKILL_AREA.width,
              height: STANCE_SKILL_AREA.height,
            }}
          >
            <b>Stance · 1/1 active</b>
            <small>{STANCE_INFO[stance].name} · Choose one for free</small>
          </div>
          <div
            class="map-choice-area map-main-passive-area"
            style={{
              left: PASSIVE_SKILL_AREA.x,
              top: PASSIVE_SKILL_AREA.y,
              width: PASSIVE_SKILL_AREA.width,
              height: PASSIVE_SKILL_AREA.height,
            }}
          >
            <b>Main passive · {mainPassive ? '1/1' : '0/1'} chosen</b>
            <small>
              {mainPassive
                ? `${SHARED_PASSIVE_NODES.find((node) => node.id === mainPassive)!.name} active · Refund it to choose another`
                : 'Only ONE main passive · Complete a core branch to unlock'}
              <br />
              Normal skills and Flow bonuses remain combinable.
            </small>
          </div>
          <button
            data-role="elemental"
            class={`map-node map-core${selected === 'flow' ? ' selected' : ''}`}
            style={{ left: SKILL_MAP_ROOT.x, top: SKILL_MAP_ROOT.y }}
            {...events('flow', SKILL_MAP_ROOT)}
            aria-label={`${NATION_INFO[nation].name} Flow, always active`}
            onClick={() => setSelected('flow')}
          >
            <Glyph name="mon" size={32} />
            <span class="map-node-name">
              {NATION_INFO[nation].name} · Flow<small>Elemental · Always active</small>
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
                  if (stance === id) onStance('bulwark');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Delete' && stance === id) {
                    e.preventDefault();
                    onStance('bulwark');
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
          {branches.map((branch, i) => (
            <span
              class="map-branch-label"
              key={branch}
              style={{ left: [240, 620, 1000, 1380][i], top: 20 }}
            >
              {branch}
            </span>
          ))}
          {nodes.map((node) => {
            const p = position(node),
              state = stateOf(node),
              role = skillRole(node, equippedMoves);
            return (
              <button
                key={node.id}
                {...events(node.id, p)}
                data-node-id={node.id}
                data-role={role}
                data-state={state}
                aria-label={`${node.name} · ${ROLE_LABELS[role]} · ${state}`}
                aria-pressed={state === 'Learned'}
                class={`map-node${node.kind === 'passive' ? ' map-passive' : ''}${node.kind === 'capstone' ? ' map-ultimate' : ''}${classes(state)}${state === 'Available' ? ' available' : ''}${selected === node.id ? ' selected' : ''}`}
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
                  {node.tier === 12 ? 'Ascendance' : node.name}
                  <small>
                    {ROLE_LABELS[role]} ·{' '}
                    {node.kind === 'capstone'
                      ? node.tier === 12
                        ? 'Ascendance'
                        : 'Ultimate'
                      : node.kind === 'passive'
                        ? node.branch === 'Flow'
                          ? 'Combo'
                          : 'Passive'
                        : node.kind === 'moveUpgrade'
                          ? 'Move'
                          : 'Stat'}
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
              <small>Requires {sharedPassivePrereq(nation, `shared:${group.ids[0]}`).name}</small>
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
        <b>{remaining} skill points</b>
        <span>{sharedRemaining} passive points</span>
        <small>{error ?? (saving ? 'Saving…' : 'Automatically saved')}</small>
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
                  ? ROLE_LABELS[skillRole(hoveredNode, equippedMoves)]
                  : ROLE_LABELS[SHARED_ROLES[hoveredPassive!.id.slice(7)]!]}{' '}
                ·{' '}
                {hoveredNode
                  ? stateOf(hoveredNode)
                  : sharedState(hoveredPassive!.id, hoveredPassive!.cost)}
              </p>
              <p>
                {(hoveredNode ?? hoveredPassive)!.cost} {hoveredNode ? 'skill' : 'passive'} points ·
                Buy once
                {hoveredPassive
                  ? ` · Only ONE main passive · Requires ${sharedPassivePrereq(nation, hoveredPassive.id).name}`
                  : ''}
                {hoveredNode?.prereqId
                  ? ` · Requires ${nodes.find((n) => n.id === hoveredNode.prereqId)!.name}`
                  : ''}
              </p>
            </>
          ) : hoveredStance ? (
            <>
              <p>{STANCE_INFO[hoveredStance].description}</p>
              <p>{stanceBuildHint(hoveredStance, equippedMoves)}</p>
              <p>Free · One stance active · Click to equip. Right click restores Bulwark.</p>
            </>
          ) : (
            <>
              <p>
                {NATION_PASSIVES[nation].name}: {NATION_PASSIVES[nation].description}
              </p>
              <p>
                Burn / DEF down into Priority, True hit, Crit up or Charge: +
                {Math.round((FOLLOW_THROUGH_MULT - 1) * 100)}% damage once per battle; stronger
                against higher-level opponents.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
