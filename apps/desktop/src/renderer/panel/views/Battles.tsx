import { useEffect, useState } from 'preact/hooks';
import {
  DEFAULT_STANCE,
  EFFECT_DESCRIPTIONS,
  NATION_INFO,
  RESPEC_COOLDOWN_MS,
  RESPEC_FREE_BELOW_LEVEL,
  SHARED_PASSIVE_NODES,
  STANCES,
  defaultLoadoutMoveIds,
  displayName,
  explainMatchup,
  findMove,
  isRespec,
  nationNodes,
  pointsAvailable,
  sharedPassivePoints,
  speciesOf,
  toRoman,
  topBranch,
  treeSpent,
  type MatchupExplanation,
  type Move,
  type MonSnapshot,
  type Nation,
  type Stance,
  type TreeNode,
} from '@claude-mons/shared';
import type { BattleSummary, SetLoadoutPayload, UiSnapshot } from '../../../common/ipc.ts';
import { SpriteView } from '../../ui/SpriteView.tsx';
import { TypeChip } from '../../ui/TypeChip.tsx';
import { Glyph } from '../../ui/Glyph.tsx';
import { BRANCH_X, TIER_Y, treeNodePosition } from './battleTreeLayout.ts';

/**
 * Tuned by simulation on 2026-09-13 (docs/design/progression.md Stances); keep this copy in sync
 * with `STANCE_INFO`/`STANCE_COUNTER_DEALT_MULT`/`STANCE_COUNTER_TAKEN_MULT`
 * (`packages/shared/src/game/progression.ts`).
 */
const STANCE_INFO: Record<Stance, { name: string; description: string; beats: string }> = {
  fury: { name: 'Fury', description: 'ATK +2% / DEF -6%.', beats: 'Gale' },
  bulwark: { name: 'Bulwark', description: 'DEF +2% / ATK -6%.', beats: 'Fury' },
  gale: { name: 'Gale', description: 'SPD +2% / ATK -6%.', beats: 'Bulwark' },
};

/** Triangle corner layout: Fury top, Bulwark bottom-left, Gale bottom-right. */
const STANCE_CORNERS: Record<Stance, { x: number; y: number }> = {
  fury: { x: 100, y: 10 },
  bulwark: { x: 20, y: 95 },
  gale: { x: 180, y: 95 },
};

const SLOT_LABELS = ['Opener', 'Default', 'Finisher'] as const;

function moveLabel(m: Move | undefined): string {
  return m ? m.name : '—';
}

/**
 * Stance picker as an SVG triangle (docs/design/ui-panels.md Battles' Stance component): one
 * corner per stance, the active corner filled solid, the other two dim outlines. Read-only when
 * `onPick` is omitted (the main tab's preview); clickable inside the loadout editor.
 */
function StanceTriangle({ active, onPick }: { active: Stance; onPick?: (s: Stance) => void }) {
  return (
    <div class="triangle-wrap">
      <svg class="triframe" viewBox="0 0 200 110" width={200} height={110}>
        <line x1="100" y1="10" x2="20" y2="95" />
        <line x1="100" y1="10" x2="180" y2="95" />
        <line x1="20" y1="95" x2="180" y2="95" />
        {STANCES.map((id) => {
          const { x, y } = STANCE_CORNERS[id];
          const isActive = id === active;
          return (
            <g
              key={id}
              onClick={onPick ? () => onPick(id) : undefined}
              style={onPick ? { cursor: 'pointer' } : undefined}
            >
              <circle
                class={`corner${isActive ? ' active-corner' : ''}`}
                cx={x}
                cy={y}
                r={isActive ? 22 : 20}
              />
              <text
                class={isActive ? 'active-corner-text' : ''}
                x={x}
                y={y + 4}
                text-anchor="middle"
              >
                {STANCE_INFO[id].name.toUpperCase()}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/**
 * Talent tree as an actual SVG tree (docs/design/ui-panels.md Battles' Talent tree component):
 * trunk rising into 3 branch columns of 6 tiered nodes each. Read-only (a static preview of the
 * saved tree) when `onAdd`/`onRemove` are omitted; interactive inside the loadout editor, where a
 * left click adds a rank and a right click removes one, with a detail line below showing the
 * selected node's exact numbers (desktop hover also selects, covering the tap-to-inspect case).
 */
function TalentTree({
  nation,
  ranks,
  level,
  onAdd,
  onRemove,
}: {
  nation: Nation;
  ranks: Record<string, number>;
  level: number;
  onAdd?: (node: TreeNode) => void;
  onRemove?: (node: TreeNode) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const nodes = nationNodes(nation);
  const branches: string[] = [];
  for (const n of nodes) if (!branches.includes(n.branch)) branches.push(n.branch);
  const columns = branches
    .slice(0, 3)
    .map((b) => nodes.filter((n) => n.branch === b).sort((a, c) => a.tier - c.tier));
  const spent = treeSpent(nation, ranks);
  const budget = pointsAvailable(level);
  const interactive = Boolean(onAdd);
  const selectedNode = selected ? nodes.find((n) => n.id === selected) : null;

  return (
    <div class={`tree-wrap`}>
      <div class="leaf-badge">
        <Glyph name="leaf" size={9} />
        {spent.nation}/{budget}
      </div>
      <svg class={`tree-svg ${nation}`} viewBox="0 0 300 230" width="100%" height={230}>
        <line x1="150" y1="228" x2="150" y2="205" />
        {BRANCH_X.map((x) => (
          <line key={x} x1="150" y1="205" x2={x} y2={TIER_Y[0]} />
        ))}
        {BRANCH_X.map((x) => (
          <line key={`c-${x}`} x1={x} y1={TIER_Y[0]} x2={x} y2={TIER_Y[5]} />
        ))}
        {columns.map((col, ci) => (
          <text key={ci} class="branch-label" x={BRANCH_X[ci]} y={205} text-anchor="middle">
            {col[0]!.branch.toUpperCase()}
          </text>
        ))}
        {columns.map((col, ci) =>
          col.map((node) => {
            const rank = ranks[node.id] ?? 0;
            const locked = node.prereqId !== null && (ranks[node.prereqId] ?? 0) < 1;
            const { x, y } = treeNodePosition(ci, node.tier);
            return (
              <g
                key={node.id}
                onMouseEnter={() => setSelected(node.id)}
                onClick={() => {
                  setSelected(node.id);
                  if (interactive && !locked) onAdd?.(node);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (interactive && rank > 0) onRemove?.(node);
                }}
              >
                <circle
                  class={`node${locked ? ' locked' : ''}${rank > 0 ? ' ranked' : ''}`}
                  cx={x}
                  cy={y}
                  r={9}
                />
                {rank > 0 && node.maxRank > 1 && (
                  <text class="rank-label" x={x} y={y + 3} text-anchor="middle">
                    {rank}
                  </text>
                )}
              </g>
            );
          }),
        )}
      </svg>
      {selectedNode && (
        <div class="talent-tooltip">
          <b>
            {selectedNode.name} · {ranks[selectedNode.id] ?? 0}/{selectedNode.maxRank} (
            {selectedNode.cost} pt{selectedNode.cost === 1 ? '' : 's'}/rank)
          </b>
          {selectedNode.description}
          {interactive && (ranks[selectedNode.id] ?? 0) > 0 && (
            <div style={{ marginTop: 4 }}>
              <button onClick={() => onRemove?.(selectedNode)}>Remove a rank</button>
            </div>
          )}
        </div>
      )}
      {!selectedNode && (
        <p class="hint" style={{ margin: '4px 0 0', textAlign: 'center' }}>
          {interactive
            ? 'Click a node to rank it, right-click to remove a rank.'
            : 'Hover or tap a node for details.'}
        </p>
      )}
    </div>
  );
}

/** Cascades a respec down: dropping a node to 0 also zeroes every higher tier in its branch, so
 * `ranks` never drifts into a state the server's prereq check would reject. */
function clearDependents(
  nodes: TreeNode[],
  branch: string,
  tier: number,
  ranks: Record<string, number>,
) {
  for (const n of nodes) {
    if (n.branch === branch && n.tier > tier) ranks[n.id] = 0;
  }
}

/**
 * The loadout editor overlay: 3 move slots (dropdown + reorder), stance triangle, talent tree,
 * save/cancel. `initialStance` lets the Battles tab's "Counter this" button pre-select a stance
 * without saving it -- the player still has to hit Save for it to take effect.
 */
function LoadoutEditor({
  s,
  initialStance,
  onClose,
}: {
  s: UiSnapshot;
  initialStance?: Stance | null;
  onClose: () => void;
}) {
  const species = speciesOf(s.pet.speciesId!);
  const unlockedIds = new Set(s.battles.unlockedMoveIds);
  const level = s.progress.level;
  const storedMoves = s.battles.loadout.moves;
  const storedIsValid =
    storedMoves !== undefined &&
    storedMoves.length === 3 &&
    storedMoves.every((id) => unlockedIds.has(id));
  const initial = storedIsValid
    ? (storedMoves as [string, string, string])
    : defaultLoadoutMoveIds(species, level);
  const replacedLockedLoadout =
    storedMoves !== undefined && storedMoves.length === 3 && !storedIsValid;

  const [moves, setMoves] = useState<[string, string, string]>(initial);
  const [stance, setStance] = useState<Stance>(
    initialStance ?? s.battles.loadout.stance ?? 'bulwark',
  );
  const savedTree = s.battles.loadout.tree ?? {};
  const [tree, setTree] = useState<Record<string, number>>(savedTree);
  const [respecArmed, setRespecArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const treeRespec = isRespec(savedTree, tree);
  const cooldownUntilMs = s.battles.lastRespecAt
    ? Date.parse(s.battles.lastRespecAt) + RESPEC_COOLDOWN_MS
    : 0;
  const onCooldown = level >= RESPEC_FREE_BELOW_LEVEL && treeRespec && cooldownUntilMs > Date.now();
  const needsConfirm =
    treeRespec && level >= RESPEC_FREE_BELOW_LEVEL && !onCooldown && !respecArmed;

  const nodes = nationNodes(species.nation);
  const addRank = (node: TreeNode) => {
    setTree((ranks) => {
      const current = ranks[node.id] ?? 0;
      if (current >= node.maxRank) return ranks;
      if (node.prereqId && (ranks[node.prereqId] ?? 0) < 1) return ranks;
      const spent = treeSpent(species.nation, ranks);
      if (spent.nation + node.cost > pointsAvailable(level)) return ranks;
      return { ...ranks, [node.id]: current + 1 };
    });
  };
  const removeRank = (node: TreeNode) => {
    setTree((ranks) => {
      const current = ranks[node.id] ?? 0;
      if (current <= 0) return ranks;
      const next = { ...ranks, [node.id]: current - 1 };
      if (current - 1 < 1) clearDependents(nodes, node.branch, node.tier, next);
      return next;
    });
  };
  const spent = treeSpent(species.nation, tree);
  const sharedBudget = sharedPassivePoints(level);
  const togglePassive = (id: string, cost: number) => {
    const current = tree[id] ?? 0;
    if (current > 0) {
      setTree({ ...tree, [id]: 0 });
    } else {
      if (spent.shared + cost > sharedBudget) return;
      setTree({ ...tree, [id]: 1 });
    }
  };

  const setSlot = (i: number, id: string) => {
    const next = [...moves] as [string, string, string];
    next[i] = id;
    setMoves(next);
  };
  const reorder = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j > 2) return;
    const next = [...moves] as [string, string, string];
    const tmp = next[i]!;
    next[i] = next[j]!;
    next[j] = tmp;
    setMoves(next);
  };

  const distinct = new Set(moves).size === 3;
  const allUnlocked = moves.every((id) => unlockedIds.has(id));
  const movesValid = distinct && allUnlocked;
  const canPickThreeMoves = unlockedIds.size >= 3;

  const save = async () => {
    if (needsConfirm) {
      setRespecArmed(true);
      return;
    }
    setBusy(true);
    setErr(null);
    const payload: SetLoadoutPayload = { stance };
    if (movesValid) payload.moves = moves;
    if (JSON.stringify(tree) !== JSON.stringify(savedTree)) {
      payload.tree = tree;
      payload.respec = treeRespec;
    }
    const r = await window.monsUi.setLoadout(payload);
    setBusy(false);
    if (r.ok) {
      setSaved(true);
      setTimeout(onClose, 700);
    } else {
      setRespecArmed(false);
      setErr(r.error ?? 'Failed to save loadout');
    }
  };

  const saveDisabledReason =
    canPickThreeMoves && !distinct
      ? 'Pick 3 different moves.'
      : canPickThreeMoves && !allUnlocked
        ? "One of these moves isn't unlocked yet."
        : null;
  const saveDisabled = busy || saved || saveDisabledReason !== null || onCooldown;

  return (
    <div class="loadout-overlay">
      <div class="loadout-card">
        <h3 style={{ marginTop: 0 }}>Edit loadout</h3>
        {replacedLockedLoadout && (
          <p class="flavor">
            Your saved loadout included a move you haven't unlocked yet, so we swapped in your
            currently unlocked moves below.
          </p>
        )}
        <div class="slots">
          {([0, 1, 2] as const).map((i) => {
            const move = species.movePool.find((m) => m.id === moves[i]);
            return (
              <div class="slot-card" key={i}>
                <span class="num">{i + 1}</span>
                <div class="body">
                  <div class="role">{SLOT_LABELS[i]}</div>
                  <select
                    class="mv-select"
                    value={moves[i]}
                    onChange={(e) => setSlot(i, (e.target as HTMLSelectElement).value)}
                  >
                    {species.movePool.map((m) => (
                      <option key={m.id} value={m.id} disabled={!unlockedIds.has(m.id)}>
                        {m.name} · {m.power} pwr
                        {unlockedIds.has(m.id) ? '' : ` (unlocks at level ${m.unlocksAt})`}
                      </option>
                    ))}
                  </select>
                </div>
                {move && (
                  <TypeChip
                    nation={move.type === 'nation' ? species.nation : 'neutral'}
                    label={
                      move.type === 'nation' ? species.nation.slice(0, 3).toUpperCase() : 'NEU'
                    }
                  />
                )}
                <div class="reorder">
                  <button disabled={i === 0} onClick={() => reorder(i, -1)} title="Move up">
                    ▲
                  </button>
                  <button disabled={i === 2} onClick={() => reorder(i, 1)} title="Move down">
                    ▼
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {([0, 1, 2] as const).map((i) => {
          const move = species.movePool.find((m) => m.id === moves[i]);
          return move?.effect ? (
            <p class="hint" key={i} style={{ margin: '4px 0 0' }}>
              {SLOT_LABELS[i]}: {EFFECT_DESCRIPTIONS[move.effect]}
            </p>
          ) : null;
        })}

        <h3 style={{ marginTop: 14 }}>Stance</h3>
        <p class="flavor" style={{ margin: '0 0 4px' }}>
          Countering the opponent's stance grants +2% damage dealt and -2% damage taken.
        </p>
        <StanceTriangle active={stance} onPick={setStance} />
        <p class="stance-caption">
          {STANCE_INFO[stance].name} beats {STANCE_INFO[stance].beats}
        </p>

        {!canPickThreeMoves && (
          <p class="flavor">
            Only {unlockedIds.size} move{unlockedIds.size === 1 ? '' : 's'} unlocked so far -- more
            open up as this mon levels up. Stance and talent changes below still save normally.
          </p>
        )}
        {canPickThreeMoves && !distinct && <p class="flavor">Pick 3 different moves.</p>}
        {canPickThreeMoves && distinct && !allUnlocked && (
          <p class="flavor">One of these moves isn't unlocked yet.</p>
        )}

        <h3 style={{ marginTop: 14 }}>Talents · {NATION_INFO[species.nation].name}</h3>
        <TalentTree
          nation={species.nation}
          ranks={tree}
          level={level}
          onAdd={addRank}
          onRemove={removeRank}
        />
        <h3 style={{ marginTop: 14 }}>Shared passives</h3>
        <p class="flavor" style={{ margin: '0 0 6px' }}>
          Shared: {spent.shared} / {sharedBudget} spent. Available regardless of nation.
        </p>
        <div class="talent-passives">
          {SHARED_PASSIVE_NODES.map((p) => {
            const active = (tree[p.id] ?? 0) > 0;
            const affordable = spent.shared + p.cost <= sharedBudget;
            return (
              <button
                key={p.id}
                class={`talent-passive${active ? ' active' : ''}`}
                disabled={!active && !affordable}
                onClick={() => togglePassive(p.id, p.cost)}
                title={p.description}
              >
                <b>{p.name}</b>
                <div class="hint">{p.description}</div>
              </button>
            );
          })}
        </div>

        <div class="row" style={{ border: 0, justifyContent: 'space-between', marginTop: 8 }}>
          <span class="hint">
            {level < RESPEC_FREE_BELOW_LEVEL
              ? `Free respec below level ${RESPEC_FREE_BELOW_LEVEL}.`
              : onCooldown
                ? `Respec cooldown until ${new Date(cooldownUntilMs).toLocaleString()}.`
                : 'Respec limited to once per 7 days past level 10.'}
          </span>
          <button
            disabled={Object.values(tree).every((r) => !r)}
            onClick={() => {
              setTree({});
              setRespecArmed(false);
            }}
          >
            Reset all
          </button>
        </div>
        {respecArmed && !onCooldown && (
          <p class="flavor">
            This lowers a talent rank, which starts a 7-day respec cooldown. Click Save again to
            confirm.
          </p>
        )}
        {onCooldown && <p class="flavor">Respec is on cooldown; this change can't be saved yet.</p>}

        {err && <p class="loadout-error">Couldn't save: {err}</p>}
        {saveDisabledReason && !err && !saved && (
          <p class="hint" style={{ textAlign: 'right' }}>
            {saveDisabledReason}
          </p>
        )}
        <div class="row" style={{ border: 0, justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button
            onClick={() => {
              if (respecArmed) setRespecArmed(false);
              else onClose();
            }}
            disabled={busy}
          >
            {respecArmed ? 'Back' : 'Cancel'}
          </button>
          <button
            class="primary"
            onClick={() => void save()}
            disabled={saveDisabled}
            title={saveDisabledReason ?? undefined}
          >
            {saved ? 'Saved' : busy ? 'Saving…' : respecArmed ? 'Confirm respec' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** `mm:ss` (or `h:mm:ss` past an hour) countdown for the arena's digital-readout timer. */
function formatCountdown(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Builds a `MonSnapshot`-shaped object good enough for `explainMatchup`, which only ever reads
 * `nation`/`speciesId`/`level`/`loadout` off either side -- the rest are placeholders never
 * inspected.
 */
function matchupSnapshot(input: {
  nickname: string;
  nation: Nation;
  speciesId: string;
  level: number;
  loadout: { stance?: Stance; moves?: string[]; tree?: Record<string, number> };
}): MonSnapshot {
  return {
    monId: '',
    playerId: null,
    nickname: input.nickname,
    nation: input.nation,
    speciesId: input.speciesId,
    stage: 'adult',
    level: input.level,
    stats: { hp: 0, atk: 0, def: 0, spd: 0 },
    loadout: input.loadout,
  };
}

/** One "Recent opponents" strip: who it was, a rules-derived matchup tip, and "Counter this". */
function RecentOpponentStrip({
  b,
  me,
  onCounter,
}: {
  b: BattleSummary;
  me: MonSnapshot | null;
  onCounter: (stance: Stance) => void;
}) {
  const o = b.opponent;
  const species = speciesOf(o.speciesId);
  const moveIds =
    o.loadout.moves && o.loadout.moves.length === 3
      ? o.loadout.moves
      : defaultLoadoutMoveIds(species, o.level);
  const moveNames = moveIds.map((id) => findMove(species, id)?.name ?? id);
  const stance = o.loadout.stance ?? DEFAULT_STANCE;
  const branch = topBranch(o.nation, o.loadout.tree);

  const opp = matchupSnapshot({
    nickname: o.nickname,
    nation: o.nation,
    speciesId: o.speciesId,
    level: o.level,
    loadout: o.loadout,
  });
  const explanation: MatchupExplanation | null = me ? explainMatchup(me, opp) : null;

  return (
    <div class="opponent-strip">
      <div class="top">
        <b>{b.isBot ? 'Wild' : o.nickname}</b>
        <span class={b.won ? 'res-w' : 'res-l'}>
          {b.won ? 'WON' : 'LOST'} +{b.xp} XP
        </span>
      </div>
      <p class="hint" style={{ margin: '3px 0 0' }}>
        {displayName(o.speciesId, o.stage)} Lv {o.level} · {STANCE_INFO[stance].name} stance
        {b.won && b.winStreak > 1 ? ` · streak x${b.winStreak}` : ''} · {ago(b.at)}
      </p>
      <div class="moves">
        {moveNames.map((name, i) => (
          <span class="chip" key={i}>
            {name}
          </span>
        ))}
        {branch && <span class="chip">{`${branch.branch} ${toRoman(branch.ranks)}`}</span>}
        {b.isElite && <span class="chip">Elite</span>}
      </div>
      {explanation && (
        <div class="hintline">
          <span>{explanation.suggestion}</span>
          {explanation.suggestedStance && (
            <button class="cta" onClick={() => onCounter(explanation.suggestedStance!)}>
              Counter this
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function BattlesView({ s }: { s: UiSnapshot }) {
  const [editing, setEditing] = useState(false);
  const [counterStance, setCounterStance] = useState<Stance | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const history = s.battles.history;
  const cd = s.battles.cooldownUntil;
  const cdLeft = cd ? Math.max(0, cd - Date.now()) : 0;
  const hatched = s.pet.speciesId !== null;
  const species = hatched ? speciesOf(s.pet.speciesId!) : null;
  const moves = species
    ? (s.battles.loadout.moves ?? []).map((id) => species.movePool.find((m) => m.id === id))
    : [];
  const stance = s.battles.loadout.stance ?? DEFAULT_STANCE;
  const me = species
    ? matchupSnapshot({
        nickname: s.profile.nickname ?? 'You',
        nation: species.nation,
        speciesId: s.pet.speciesId!,
        level: s.progress.level,
        loadout: s.battles.loadout,
      })
    : null;
  const last = history[0] ?? null;

  if (!hatched) {
    return (
      <div>
        <div class="section">
          <p class="flavor">Hatch your mon to pick its moves and stance.</p>
        </div>
        <div class="section">
          <h3>Recent opponents</h3>
          {history.length === 0 ? (
            <p class="flavor">No battles yet.</p>
          ) : (
            history
              .slice(0, 10)
              .map((b) => <RecentOpponentStrip b={b} me={null} key={b.id} onCounter={() => {}} />)
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div class="section">
        <div class="arena">
          <div class="side">
            <SpriteView
              speciesId={s.pet.speciesId}
              stage={s.pet.stage}
              nation={species!.nation}
              scale={4}
            />
            <b>{displayName(s.pet.speciesId!, s.pet.stage)}</b>
            <span>
              Lv {s.progress.level} · {STANCE_INFO[stance].name}
            </span>
          </div>
          <span class="vs">VS</span>
          <div class="side">
            {last ? (
              <>
                <SpriteView
                  speciesId={last.opponent.speciesId}
                  stage={last.opponent.stage}
                  nation={last.opponent.nation}
                  scale={4}
                />
                <b>
                  {last.isBot
                    ? 'Wild ' + displayName(last.opponent.speciesId, last.opponent.stage)
                    : last.opponent.nickname}
                </b>
                <span>
                  Lv {last.opponent.level} ·{' '}
                  {STANCE_INFO[last.opponent.loadout.stance ?? DEFAULT_STANCE].name}
                </span>
              </>
            ) : (
              <span class="hint">No battles yet</span>
            )}
          </div>
        </div>
        {last && (
          <div class={`result-banner ${last.won ? 'won' : 'lost'}`}>
            {last.won ? 'WON' : 'LOST'} · {last.turns} turn{last.turns === 1 ? '' : 's'} ·{' '}
            {last.reason === 'ko' ? 'knockout' : 'timeout'}
          </div>
        )}
        {!last && (
          <div class="result-banner none">
            Grab your mon and shake it to challenge another nation.
          </div>
        )}
        <div class="timer-row">
          <span class="timer">{cdLeft > 0 ? formatCountdown(cdLeft) : 'READY'}</span>
          <span class="streak-chip">
            <Glyph name="flame" size={12} />
            streak x{s.battles.winStreak}
          </span>
          <span class="hint">{s.battles.remainingToday} today</span>
        </div>
      </div>

      <div class="section">
        <h3>Loadout</h3>
        <div class="slots">
          {moves.map((m, i) => (
            <div class="slot-card" key={i}>
              <span class="num">{i + 1}</span>
              <div class="body">
                <div class="role">{SLOT_LABELS[i]}</div>
                <div class="mv">{moveLabel(m)}</div>
              </div>
              {m && (
                <TypeChip
                  nation={m.type === 'nation' ? species!.nation : 'neutral'}
                  label={m.type === 'nation' ? species!.nation.slice(0, 3).toUpperCase() : 'NEU'}
                />
              )}
            </div>
          ))}
        </div>
        <button style={{ marginTop: 8 }} onClick={() => setEditing(true)}>
          Edit loadout
        </button>
      </div>

      <div class="section">
        <h3>Stance</h3>
        <StanceTriangle active={stance} />
        <p class="stance-caption">
          {STANCE_INFO[stance].name} beats {STANCE_INFO[stance].beats}
        </p>
      </div>

      <div class="section">
        <h3>Talents · {NATION_INFO[species!.nation].name}</h3>
        <TalentTree
          nation={species!.nation}
          ranks={s.battles.loadout.tree ?? {}}
          level={s.progress.level}
        />
      </div>

      <div class="section">
        <h3>Recent opponents</h3>
        {history.length === 0 ? (
          <p class="flavor">No battles yet.</p>
        ) : (
          history.slice(0, 10).map((b) => (
            <RecentOpponentStrip
              b={b}
              me={me}
              key={b.id}
              onCounter={(stance) => {
                setCounterStance(stance);
                setEditing(true);
              }}
            />
          ))
        )}
      </div>

      {editing && (
        <LoadoutEditor
          s={s}
          initialStance={counterStance}
          onClose={() => {
            setCounterStance(null);
            setEditing(false);
          }}
        />
      )}
    </div>
  );
}
