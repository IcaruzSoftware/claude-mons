import { useEffect, useRef, useState } from 'preact/hooks';
import {
  FOLLOW_THROUGH_MULT,
  NATION_INFO,
  NATION_PASSIVES,
  STANCES,
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
  SHARED_SKILL_GROUPS,
  MIN_SKILL_ZOOM,
  MAX_SKILL_ZOOM,
  skillMapPosition,
  sharedSkillPosition,
  zoomSkillMap,
} from './skillMapLayout.ts';

/** A navigable skill atlas. Selection inspects; only explicit unlock actions spend points. */
export function SkillTree({
  nation,
  ranks,
  level,
  onAdd,
  onRemove,
  onPassive,
  stance,
  onStance,
}: {
  nation: Nation;
  ranks: Record<string, number>;
  level: number;
  onAdd: (node: TreeNode) => void;
  onRemove: (node: TreeNode) => void;
  onPassive: (id: string, cost: number) => void;
  stance: Stance;
  onStance: (stance: Stance) => void;
}) {
  const nodes = nationNodes(nation);
  const branches = [...new Set(nodes.map((n) => n.branch))];
  const [selected, setSelected] = useState<string>(nodes[0]!.id);
  const viewport = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, zoom: 0.75 });
  const drag = useRef<{
    x: number;
    y: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  const node = nodes.find((n) => n.id === selected);
  const passive = SHARED_PASSIVE_NODES.find((p) => p.id === selected);
  const spent = treeSpent(nation, ranks);
  const remaining = pointsAvailable(level) - spent.nation;
  const sharedRemaining = sharedPassivePoints(level) - spent.shared;
  const rank = ranks[selected] ?? 0;
  const prereq = nodes.find((n) => n.id === node?.prereqId);
  const locked = Boolean(prereq && !(ranks[prereq.id] ?? 0));
  const position = (n: TreeNode) => skillMapPosition(branches.indexOf(n.branch), n.tier);
  const description = (node ?? passive)?.description
    .replace(/ \(not yet wired.*$/, '.')
    .replace(/ \(rank 3 may instead.*$/, '.');

  const center = () => {
    const el = viewport.current;
    if (el)
      setView({
        x: el.clientWidth / 2 - SKILL_MAP_ROOT.x * 0.75,
        y: el.clientHeight / 2 - SKILL_MAP_ROOT.y * 0.75,
        zoom: 0.75,
      });
  };
  useEffect(() => {
    center();
    const el = viewport.current!;
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
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  const zoom = (factor: number) => {
    const el = viewport.current!;
    setView((v) =>
      zoomSkillMap(v, v.zoom * factor, { x: el.clientWidth / 2, y: el.clientHeight / 2 }),
    );
  };
  const fit = () => {
    const el = viewport.current!;
    const scale = Math.max(
      MIN_SKILL_ZOOM,
      Math.min(
        (el.clientWidth - 24) / SKILL_MAP_SIZE.width,
        (el.clientHeight - 24) / SKILL_MAP_SIZE.height,
      ),
    );
    setView({
      x: (el.clientWidth - SKILL_MAP_SIZE.width * scale) / 2,
      y: (el.clientHeight - SKILL_MAP_SIZE.height * scale) / 2,
      zoom: scale,
    });
  };
  const pick = (id: string) => {
    if (!drag.current?.moved) setSelected(id);
  };
  const passiveGlyphs: Record<string, GlyphName> = {
    'shared:stone-skin': 'gear',
    'shared:deep-roots': 'leaf',
    'shared:bedrock': 'gear',
    'shared:wildfire': 'flame',
    'shared:aftershock': 'spark',
    'shared:tailwind': 'wind',
    'shared:tidal-recovery': 'drop',
    'shared:updraft': 'wind',
    'shared:second-breath': 'mon',
    'shared:ember-heart': 'flame',
  };
  const glyph = (n: TreeNode): GlyphName =>
    n.kind === 'capstone'
      ? 'spark'
      : n.kind === 'passive'
        ? 'leaf'
        : n.kind === 'moveUpgrade'
          ? 'swords'
          : n.stat === 'atk'
            ? 'swords'
            : n.stat === 'spd'
              ? 'wind'
              : n.stat === 'hp'
                ? 'drop'
                : 'gear';

  return (
    <div class={`skill-tree ${nation}`}>
      <div class="skill-budget" aria-live="polite">
        <b>{remaining} skill points</b>
        <span>{sharedRemaining} passive points</span>
      </div>
      <div class="map-toolbar" aria-label="Skill map controls">
        <button
          aria-label="Zoom out"
          disabled={view.zoom <= MIN_SKILL_ZOOM}
          onClick={() => zoom(1 / 1.2)}
        >
          −
        </button>
        <output aria-label="Zoom level">{Math.round(view.zoom * 100)}%</output>
        <button
          aria-label="Zoom in"
          disabled={view.zoom >= MAX_SKILL_ZOOM}
          onClick={() => zoom(1.2)}
        >
          +
        </button>
        <button onClick={fit}>Fit</button>
        <button onClick={center}>Center</button>
      </div>
      <p class="map-help">Drag to explore · Scroll to zoom · Select a skill to inspect</p>
      <div
        class="skill-map-viewport"
        ref={viewport}
        tabIndex={0}
        role="region"
        aria-label="Skill map"
        onPointerDown={(e) => {
          if (e.button !== 0 || (e.target as Element).closest('button')) return;
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            originX: view.x,
            originY: view.y,
            moved: false,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const start = drag.current;
          if (!start) return;
          const dx = e.clientX - start.x,
            dy = e.clientY - start.y;
          if (Math.abs(dx) + Math.abs(dy) > 4) start.moved = true;
          setView((v) => ({ ...v, x: start.originX + dx, y: start.originY + dy }));
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
          } else if (e.key === '+' || e.key === '=') {
            e.preventDefault();
            zoom(1.2);
          } else if (e.key === '-') {
            e.preventDefault();
            zoom(1 / 1.2);
          } else if (e.key === 'Home') {
            e.preventDefault();
            center();
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
            <circle class="map-orbit" cx={600} cy={470} r={180} />
            <circle class="map-orbit" cx={600} cy={470} r={375} />
            {nodes.map((n) => {
              const from = n.prereqId
                ? position(nodes.find((p) => p.id === n.prereqId)!)
                : SKILL_MAP_ROOT;
              const to = position(n);
              return (
                <line
                  key={n.id}
                  class={`map-edge${(ranks[n.id] ?? 0) > 0 ? ' learned' : ''}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                />
              );
            })}
            {SHARED_SKILL_GROUPS.map((g) => (
              <g key={g.name}>
                <line class="map-shared-edge" x1={600} y1={470} x2={g.x} y2={g.y} />
                {g.ids.map((slug) => {
                  const p = sharedSkillPosition(`shared:${slug}`);
                  return (
                    <line key={slug} class="map-shared-edge" x1={g.x} y1={g.y} x2={p.x} y2={p.y} />
                  );
                })}
              </g>
            ))}
          </svg>
          <button
            class={`map-node map-core${selected === 'flow' ? ' selected' : ''}`}
            style={{ left: 600, top: 470 }}
            onClick={() => pick('flow')}
            aria-label="Flow"
            aria-pressed={selected === 'flow'}
          >
            <Glyph name="mon" size={32} />
            <span class="map-node-name">{NATION_INFO[nation].name} · Flow</span>
          </button>
          {branches.map((b, i) => (
            <span
              class="map-branch-label"
              key={b}
              style={{ left: [260, 590, 965, 1330][i], top: [430, 255, 440, 580][i] }}
            >
              {b}
            </span>
          ))}
          {nodes.map((n) => {
            const p = position(n),
              r = ranks[n.id] ?? 0;
            const gated = Boolean(n.prereqId && !(ranks[n.prereqId] ?? 0));
            return (
              <button
                key={n.id}
                data-node-id={n.id}
                aria-label={n.name}
                aria-pressed={selected === n.id}
                class={`map-node${n.kind === 'passive' ? ' map-passive' : ''}${n.tier === 6 ? ' map-ultimate' : ''}${r > 0 ? ' learned' : ''}${gated ? ' gated' : ''}${selected === n.id ? ' selected' : ''}`}
                style={{ left: p.x, top: p.y }}
                onClick={() => pick(n.id)}
                onFocus={(e) => {
                  if (!e.currentTarget.matches(':focus-visible')) return;
                  const el = viewport.current!;
                  setView((v) => ({
                    ...v,
                    x: el.clientWidth / 2 - p.x * v.zoom,
                    y: el.clientHeight / 2 - p.y * v.zoom,
                  }));
                }}
              >
                <Glyph name={glyph(n)} size={n.kind === 'capstone' ? 28 : 20} />
                <span class="map-node-rank">
                  {n.maxRank > 1 ? `${r}/${n.maxRank}` : r ? '✓' : `${n.cost} pts`}
                </span>
                <span class="map-node-name">
                  {n.name}
                  <small>
                    {n.kind === 'capstone'
                      ? 'Ultimate · Passive'
                      : n.kind === 'passive'
                        ? n.branch === 'Flow'
                          ? 'Combo · Passive'
                          : 'Passive'
                        : n.kind === 'moveUpgrade'
                          ? 'Move upgrade'
                          : 'Stat boost'}
                  </small>
                </span>
              </button>
            );
          })}
          {SHARED_SKILL_GROUPS.map((g) => (
            <span class="map-cluster-label" key={g.name} style={{ left: g.x, top: g.y }}>
              {g.name}
              <small>Shared · No prerequisite</small>
            </span>
          ))}
          {SHARED_PASSIVE_NODES.map((p) => {
            const pos = sharedSkillPosition(p.id),
              active = (ranks[p.id] ?? 0) > 0;
            return (
              <button
                key={p.id}
                data-passive-id={p.id}
                aria-label={p.name}
                aria-pressed={selected === p.id}
                class={`map-node map-passive map-shared-node${active ? ' learned' : ''}${selected === p.id ? ' selected' : ''}`}
                style={{ left: pos.x, top: pos.y }}
                onClick={() => pick(p.id)}
                onFocus={(e) => {
                  if (!e.currentTarget.matches(':focus-visible')) return;
                  const el = viewport.current!;
                  setView((v) => ({
                    ...v,
                    x: el.clientWidth / 2 - pos.x * v.zoom,
                    y: el.clientHeight / 2 - pos.y * v.zoom,
                  }));
                }}
              >
                <Glyph name={passiveGlyphs[p.id]!} size={24} />
                <span class="map-node-rank">{active ? '✓' : `${p.cost} pts`}</span>
                <span class="map-node-name">
                  {p.name}
                  <small>Passive · Once</small>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <div class="map-legend">
        <span>Solid paths: prerequisites</span>
        <span>Dotted paths: shared groups</span>
      </div>
      <div class="skill-detail" aria-live="polite" role="region" aria-label="Skill details">
        {selected === 'flow' ? (
          <>
            <span class="skill-kind">Core mechanic · Always active</span>
            <h4>{NATION_INFO[nation].name} · Flow</h4>
            <p>
              {NATION_PASSIVES[nation].name}: {NATION_PASSIVES[nation].description}
            </p>
            <p>
              Burn / DEF down → Priority, True hit, Crit up or Charge. Automatic combo: +
              {Math.round((FOLLOW_THROUGH_MULT - 1) * 100)}% damage once per battle; stronger
              against higher-level opponents.
            </p>
            <div class="skill-actions" aria-label="Battle stance">
              {STANCES.map((id) => (
                <button key={id} aria-pressed={stance === id} onClick={() => onStance(id)}>
                  {id[0]!.toUpperCase() + id.slice(1)}
                </button>
              ))}
            </div>
            <p class="hint">
              Fury: +ATK, beats Gale · Bulwark: +DEF, beats Fury · Gale: +SPD, beats Bulwark
            </p>
          </>
        ) : (
          <>
            <span class="skill-kind">
              {node
                ? `${node.branch} · Tier ${node.tier}${node.maxRank === 1 ? ' · Once' : ''}`
                : 'Shared passive · Unlock once'}
            </span>
            <h4>{(node ?? passive)!.name}</h4>
            <p>{description}</p>
            <p class="hint">
              {(node ?? passive)!.cost} {node ? 'skill' : 'passive'} points · {rank}/
              {(node ?? passive)!.maxRank}
              {prereq
                ? ` · Requires ${prereq.name}`
                : node
                  ? ' · Root skill'
                  : ' · Points earned at levels 15, 30 and 45'}
            </p>
            <div class="skill-actions">
              <button
                disabled={rank === 0}
                onClick={() => (node ? onRemove(node) : onPassive(passive!.id, passive!.cost))}
              >
                Remove{node && node.maxRank > 1 ? ' rank' : passive ? ' passive' : ''}
              </button>
              <button
                class="primary"
                disabled={
                  locked ||
                  rank >= (node ?? passive)!.maxRank ||
                  (node ? remaining : sharedRemaining) < (node ?? passive)!.cost
                }
                onClick={() => (node ? onAdd(node) : onPassive(passive!.id, passive!.cost))}
              >
                {rank >= (node ?? passive)!.maxRank
                  ? 'Unlocked'
                  : locked
                    ? 'Locked'
                    : (node ? remaining : sharedRemaining) < (node ?? passive)!.cost
                      ? 'Need more points'
                      : `Unlock · ${(node ?? passive)!.cost}${passive ? ' passive' : ''} pts`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
