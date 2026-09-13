import { useState } from 'preact/hooks';
import {
  EFFECT_DESCRIPTIONS,
  NATION_INFO,
  RESPEC_COOLDOWN_MS,
  RESPEC_FREE_BELOW_LEVEL,
  SHARED_PASSIVE_NODES,
  STANCES,
  displayName,
  isRespec,
  nationNodes,
  pointsAvailable,
  sharedPassivePoints,
  speciesOf,
  treeSpent,
  type Move,
  type Nation,
  type Stance,
  type TreeNode,
} from '@claude-mons/shared';
import type { SetLoadoutPayload, UiSnapshot } from '../../../common/ipc.ts';

/**
 * Tuned by simulation on 2026-09-13 (docs/design/progression.md Stances); keep this copy in sync
 * with `STANCE_INFO`/`STANCE_COUNTER_DEALT_MULT`/`STANCE_COUNTER_TAKEN_MULT`
 * (`packages/shared/src/game/progression.ts`).
 */
const STANCE_INFO: Record<Stance, { name: string; description: string }> = {
  fury: { name: 'Fury', description: 'ATK +2% / DEF -6%. Beats Gale, loses to Bulwark.' },
  bulwark: { name: 'Bulwark', description: 'DEF +2% / ATK -6%. Beats Fury, loses to Gale.' },
  gale: { name: 'Gale', description: 'SPD +2% / ATK -6%. Beats Bulwark, loses to Fury.' },
};

const SLOT_LABELS = ['Opener', 'Default', 'Finisher'] as const;

function moveLabel(m: Move | undefined): string {
  return m ? m.name : '—';
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
 * Talents: a 3-column grid (one per nation branch) x 6 tiers, plus the 10 nation-agnostic shared
 * passives below it (docs/design/talent-tree.md). Purely presentational over `ranks`/`onChange` so
 * the respec-confirm flow (comparing against the *saved* tree, not this in-progress edit) stays in
 * `LoadoutEditor`.
 */
function TalentsSection({
  nation,
  level,
  ranks,
  onChange,
}: {
  nation: Nation;
  level: number;
  ranks: Record<string, number>;
  onChange: (next: Record<string, number>) => void;
}) {
  const nodes = nationNodes(nation);
  const branches: string[] = [];
  for (const n of nodes) if (!branches.includes(n.branch)) branches.push(n.branch);
  const columns = branches.map((b) =>
    nodes.filter((n) => n.branch === b).sort((a, c) => a.tier - c.tier),
  );

  const spent = treeSpent(nation, ranks);
  const nationBudget = pointsAvailable(level);
  const sharedBudget = sharedPassivePoints(level);

  const addRank = (node: TreeNode) => {
    const current = ranks[node.id] ?? 0;
    if (current >= node.maxRank) return;
    if (node.prereqId && (ranks[node.prereqId] ?? 0) < 1) return;
    if (spent.nation + node.cost > nationBudget) return;
    onChange({ ...ranks, [node.id]: current + 1 });
  };
  const removeRank = (node: TreeNode) => {
    const current = ranks[node.id] ?? 0;
    if (current <= 0) return;
    const next = { ...ranks, [node.id]: current - 1 };
    if (current - 1 < 1) clearDependents(nodes, node.branch, node.tier, next);
    onChange(next);
  };
  const togglePassive = (id: string, cost: number) => {
    const current = ranks[id] ?? 0;
    if (current > 0) {
      onChange({ ...ranks, [id]: 0 });
    } else {
      if (spent.shared + cost > sharedBudget) return;
      onChange({ ...ranks, [id]: 1 });
    }
  };

  return (
    <>
      <h3>Talents</h3>
      <p class="flavor" style={{ margin: '0 0 6px' }}>
        Nation: {spent.nation} / {nationBudget} spent. Click a node to add a rank, the − button to
        remove one (a rank going down counts as a respec).
      </p>
      <div class="talent-grid">
        {columns.map((column, ci) => (
          <div class="talent-column" key={ci}>
            <div class="talent-branch-name">{column[0]!.branch}</div>
            {column.map((node) => {
              const rank = ranks[node.id] ?? 0;
              const locked = node.prereqId !== null && (ranks[node.prereqId] ?? 0) < 1;
              const maxed = rank >= node.maxRank;
              const affordable = spent.nation + node.cost <= nationBudget;
              return (
                <div
                  class={`talent-node${locked ? ' locked' : ''}${rank > 0 ? ' active' : ''}`}
                  key={node.id}
                >
                  <button
                    class="talent-node-main"
                    disabled={locked || maxed || !affordable}
                    onClick={() => addRank(node)}
                    title={node.description}
                  >
                    <b>{node.name}</b>
                    <span class="talent-rank">
                      {rank}/{node.maxRank}
                    </span>
                  </button>
                  {rank > 0 && (
                    <button
                      class="talent-node-minus"
                      onClick={() => removeRank(node)}
                      title="Remove a rank"
                    >
                      −
                    </button>
                  )}
                  <div class="hint">
                    {node.description} ({node.cost} pt{node.cost === 1 ? '' : 's'}/rank)
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <h3 style={{ marginTop: 14 }}>Shared passives</h3>
      <p class="flavor" style={{ margin: '0 0 6px' }}>
        Shared: {spent.shared} / {sharedBudget} spent. Available regardless of nation.
      </p>
      <div class="talent-passives">
        {SHARED_PASSIVE_NODES.map((p) => {
          const active = (ranks[p.id] ?? 0) > 0;
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
    </>
  );
}

/** The loadout editor overlay: 3 move slots (dropdown + reorder), stance picker, save/cancel. */
function LoadoutEditor({ s, onClose }: { s: UiSnapshot; onClose: () => void }) {
  const species = speciesOf(s.pet.speciesId!);
  const unlockedIds = new Set(s.battles.unlockedMoveIds);
  const initial =
    s.battles.loadout.moves && s.battles.loadout.moves.length === 3
      ? (s.battles.loadout.moves as [string, string, string])
      : (species.movePool.slice(0, 3).map((m) => m.id) as [string, string, string]);

  const [moves, setMoves] = useState<[string, string, string]>(initial);
  const [stance, setStance] = useState<Stance>(s.battles.loadout.stance ?? 'bulwark');
  const savedTree = s.battles.loadout.tree ?? {};
  const [tree, setTree] = useState<Record<string, number>>(savedTree);
  const [respecArmed, setRespecArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const level = s.progress.level;
  const treeRespec = isRespec(savedTree, tree);
  const cooldownUntilMs = s.battles.lastRespecAt
    ? Date.parse(s.battles.lastRespecAt) + RESPEC_COOLDOWN_MS
    : 0;
  const onCooldown = level >= RESPEC_FREE_BELOW_LEVEL && treeRespec && cooldownUntilMs > Date.now();
  const needsConfirm =
    treeRespec && level >= RESPEC_FREE_BELOW_LEVEL && !onCooldown && !respecArmed;

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

  const save = async () => {
    if (needsConfirm) {
      setRespecArmed(true);
      return;
    }
    setBusy(true);
    setErr(null);
    const payload: SetLoadoutPayload = { stance, moves };
    if (JSON.stringify(tree) !== JSON.stringify(savedTree)) {
      payload.tree = tree;
      payload.respec = treeRespec;
    }
    const r = await window.monsUi.setLoadout(payload);
    setBusy(false);
    if (r.ok) onClose();
    else {
      setRespecArmed(false);
      setErr(r.error ?? 'Failed to save loadout');
    }
  };

  return (
    <div class="loadout-overlay">
      <div class="loadout-card">
        <h3 style={{ marginTop: 0 }}>Edit loadout</h3>
        {([0, 1, 2] as const).map((i) => {
          const move = species.movePool.find((m) => m.id === moves[i]);
          return (
            <div class="loadout-slot" key={i}>
              <div class="row" style={{ border: 0, padding: '4px 0' }}>
                <span class="slot-label">{SLOT_LABELS[i]}</span>
                <div class="row" style={{ border: 0, padding: 0, gap: 4 }}>
                  <button disabled={i === 0} onClick={() => reorder(i, -1)} title="Move up">
                    ↑
                  </button>
                  <button disabled={i === 2} onClick={() => reorder(i, 1)} title="Move down">
                    ↓
                  </button>
                </div>
              </div>
              <select
                value={moves[i]}
                onChange={(e) => setSlot(i, (e.target as HTMLSelectElement).value)}
              >
                {species.movePool.map((m) => (
                  <option key={m.id} value={m.id} disabled={!unlockedIds.has(m.id)}>
                    {m.name} · {m.power} pwr · {m.type === 'nation' ? 'nation' : 'neutral'}
                    {unlockedIds.has(m.id) ? '' : ` (unlocks at level ${m.unlocksAt})`}
                  </option>
                ))}
              </select>
              {move?.effect && <div class="hint">{EFFECT_DESCRIPTIONS[move.effect]}</div>}
            </div>
          );
        })}
        <h3>Stance</h3>
        <p class="flavor" style={{ margin: '0 0 8px' }}>
          Countering the opponent's stance grants +2% damage dealt and -2% damage taken for the
          whole battle.
        </p>
        <div class="row" style={{ border: 0, gap: 8 }}>
          {STANCES.map((id) => (
            <button
              key={id}
              class={id === stance ? 'primary' : ''}
              style={{ flex: 1, textAlign: 'left' }}
              onClick={() => setStance(id)}
            >
              <b>{STANCE_INFO[id].name}</b>
              <div class="hint">{STANCE_INFO[id].description}</div>
            </button>
          ))}
        </div>
        {!distinct && <p class="flavor">Pick 3 different moves.</p>}
        {distinct && !allUnlocked && <p class="flavor">One of these moves isn't unlocked yet.</p>}

        <TalentsSection nation={species.nation} level={level} ranks={tree} onChange={setTree} />
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

        {err && <p class="flavor">{err}</p>}
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
            disabled={busy || !distinct || !allUnlocked || onCooldown}
          >
            {busy ? 'Saving…' : respecArmed ? 'Confirm respec' : 'Save'}
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

export function BattlesView({ s }: { s: UiSnapshot }) {
  const [editing, setEditing] = useState(false);
  const history = s.battles.history;
  const cd = s.battles.cooldownUntil;
  const cdLeft = cd ? Math.max(0, Math.ceil((cd - Date.now()) / 60000)) : 0;
  const hatched = s.pet.speciesId !== null;
  const species = hatched ? speciesOf(s.pet.speciesId!) : null;
  const moves = species
    ? (s.battles.loadout.moves ?? []).map((id) => species.movePool.find((m) => m.id === id))
    : [];

  return (
    <div>
      <div class="section">
        <h3>How to battle</h3>
        <p class="flavor" style={{ margin: 0 }}>
          {s.pet.stage === 'egg'
            ? "Eggs can't fight. Hatch your mon first, then grab it and shake it to challenge another nation."
            : 'Grab your mon with the mouse and shake it to challenge a mon from another nation. Battles resolve automatically.'}
        </p>
        <div class="kv" style={{ marginTop: 8 }}>
          <span>Cooldown</span>
          <span>{cdLeft > 0 ? `${cdLeft} min` : 'ready'}</span>
          <span>Challenges left today</span>
          <span>{s.battles.remainingToday}</span>
          <span>Win streak</span>
          <span>{s.battles.winStreak > 0 ? `${s.battles.winStreak} in a row` : '—'}</span>
        </div>
      </div>
      <div class="section">
        <h3>Loadout</h3>
        {hatched ? (
          <>
            <div class="row" style={{ border: 0, flexWrap: 'wrap', gap: 6 }}>
              {moves.map((m, i) => (
                <span class="badge" key={i}>
                  {moveLabel(m)}
                </span>
              ))}
              <span class="badge">{STANCE_INFO[s.battles.loadout.stance ?? 'bulwark'].name}</span>
            </div>
            <button style={{ marginTop: 8 }} onClick={() => setEditing(true)}>
              Edit loadout
            </button>
          </>
        ) : (
          <p class="flavor" style={{ margin: 0 }}>
            Hatch your mon to pick its moves and stance.
          </p>
        )}
      </div>
      <div class="section">
        <h3>History</h3>
        {history.length === 0 ? (
          <p class="flavor">No battles yet.</p>
        ) : (
          history.map((b) => (
            <div class="row" key={b.id}>
              <div>
                <b style={{ color: b.won ? '#7cb342' : '#ff5252' }}>{b.won ? 'Won' : 'Lost'}</b> vs{' '}
                {b.opponent.nickname}{' '}
                <span class={`badge ${b.opponent.nation}`}>
                  {NATION_INFO[b.opponent.nation].name}
                </span>
                {b.isElite && <span class="badge">Elite</span>}
                <div class="hint">
                  {displayName(b.opponent.speciesId, b.opponent.stage)} Lv {b.opponent.level} ·{' '}
                  {b.turns} turn{b.turns === 1 ? '' : 's'} ·{' '}
                  {b.reason === 'ko' ? 'knockout' : 'timeout'}
                  {b.isBot ? ' · wild' : ''}
                  {b.won && b.winStreak > 1 ? ` · streak x${b.winStreak}` : ''} · {ago(b.at)}
                </div>
              </div>
              <div style={{ color: 'var(--accent)', fontWeight: 600 }}>+{b.xp} XP</div>
            </div>
          ))
        )}
      </div>
      {editing && hatched && <LoadoutEditor s={s} onClose={() => setEditing(false)} />}
    </div>
  );
}
