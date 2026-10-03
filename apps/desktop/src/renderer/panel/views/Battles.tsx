import { useEffect, useRef, useState } from 'preact/hooks';
import {
  DEFAULT_STANCE,
  EFFECT_DESCRIPTIONS,
  defaultLoadoutMoveIds,
  displayName,
  findMove,
  nationNodes,
  pointsAvailable,
  sharedPassivePoints,
  singlePurchaseTree,
  speciesOf,
  treeSpent,
  type Stance,
  type TreeNode,
} from '@claude-mons/shared';
import type { BattleSummary, SetLoadoutPayload, UiSnapshot } from '../../../common/ipc.ts';
import { TypeChip } from '../../ui/TypeChip.tsx';
import { Glyph } from '../../ui/Glyph.tsx';
import { SkillTree } from './SkillTree.tsx';
import { mergeBattleHistory } from '../../../common/battleHistory.ts';
const SLOT_LABELS = ['Opener', 'Default', 'Finisher'] as const;
function clearDependents(
  nodes: TreeNode[],
  branch: string,
  tier: number,
  ranks: Record<string, number>,
) {
  for (const n of nodes) if (n.branch === branch && n.tier > tier) ranks[n.id] = 0;
}
function LoadoutEditor({ s, onDiscard }: { s: UiSnapshot; onDiscard: () => void }) {
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
  const [stance, setStance] = useState<Stance>(s.battles.loadout.stance ?? 'bulwark');
  const rawSavedTree = s.battles.loadout.tree ?? {};
  const savedTree = singlePurchaseTree(rawSavedTree);
  const [tree, setTree] = useState<Record<string, number>>(savedTree);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setSaved(false), [moves, stance, tree]);

  const [mapOpen, setMapOpen] = useState(false);
  const mapStart = useRef({ tree, stance });
  const mapDialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!mapOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    mapDialog.current?.focus();
    return () => previous?.focus();
  }, [mapOpen]);
  const cancelMap = () => {
    if (busy) return;
    setTree(mapStart.current.tree);
    setStance(mapStart.current.stance);
    setMapOpen(false);
    setErr(null);
  };
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
    if (moves.some((moveId, slot) => slot !== i && moveId === id)) return;
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

  const save = async (treeOnly = false) => {
    setBusy(true);
    setErr(null);
    const payload: SetLoadoutPayload = {};
    if (!treeOnly || stance !== (s.battles.loadout.stance ?? DEFAULT_STANCE))
      payload.stance = stance;
    if (!treeOnly && movesValid) payload.moves = moves;
    if (JSON.stringify(tree) !== JSON.stringify(rawSavedTree)) {
      payload.tree = tree;
    }
    try {
      const r = await window.monsUi.setLoadout(payload);
      if (r.ok) {
        if (treeOnly) setMapOpen(false);
        else setSaved(true);
      } else {
        setErr(r.error ?? 'Failed to save loadout');
      }
    } catch {
      setErr('Failed to save loadout. Your draft is still here; try again.');
    } finally {
      setBusy(false);
    }
  };

  const saveDisabledReason =
    canPickThreeMoves && !distinct
      ? 'Pick 3 different moves.'
      : canPickThreeMoves && !allUnlocked
        ? "One of these moves isn't unlocked yet."
        : null;
  const saveDisabled = busy || saved || saveDisabledReason !== null;

  return (
    <div class="section">
      <fieldset class="loadout-card" disabled={busy}>
        <h3 style={{ marginTop: 0 }}>Abilities</h3>
        <p class="hint">Try changes freely. Only Save applies them to future battles.</p>
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
                    value={!canPickThreeMoves && i === 2 ? '' : moves[i]}
                    disabled={!canPickThreeMoves && i === 2}
                    onChange={(e) => setSlot(i, (e.target as HTMLSelectElement).value)}
                  >
                    {!canPickThreeMoves && i === 2 && (
                      <option value="">Unlock a third move to use this slot</option>
                    )}
                    {species.movePool.map((m) => (
                      <option
                        key={m.id}
                        value={m.id}
                        disabled={
                          !unlockedIds.has(m.id) ||
                          moves.some((id, slot) => slot !== i && id === m.id)
                        }
                      >
                        {m.name} · {m.power} pwr
                        {!unlockedIds.has(m.id)
                          ? ` (unlocks at level ${m.unlocksAt})`
                          : moves.some((id, slot) => slot !== i && id === m.id)
                            ? ' (equipped in another slot)'
                            : ''}
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
        <button
          class="skill-entry"
          onClick={() => {
            mapStart.current = { tree: { ...tree }, stance };
            setMapOpen(true);
          }}
        >
          <Glyph name="leaf" size={12} /> Skill Tree
          <span>{pointsAvailable(level) - treeSpent(species.nation, tree).nation} pts left</span>
        </button>
        {([0, 1, 2] as const).map((i) => {
          const move = species.movePool.find((m) => m.id === moves[i]);
          return move?.effect ? (
            <p class="hint" key={i} style={{ margin: '4px 0 0' }}>
              {SLOT_LABELS[i]}: {EFFECT_DESCRIPTIONS[move.effect]}
            </p>
          ) : null;
        })}

        {!canPickThreeMoves && (
          <p class="flavor">
            Only {unlockedIds.size} move{unlockedIds.size === 1 ? '' : 's'} unlocked so far -- more
            open up as this mon levels up. Skills can still be saved in the Skill Tree.
          </p>
        )}
        {canPickThreeMoves && !distinct && <p class="flavor">Pick 3 different moves.</p>}
        {canPickThreeMoves && distinct && !allUnlocked && (
          <p class="flavor">One of these moves isn't unlocked yet.</p>
        )}

        {mapOpen && (
          <div
            class="skill-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Skill Tree"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                cancelMap();
              }
              if (e.key !== 'Tab') return;
              const controls = Array.from(
                e.currentTarget.querySelectorAll<HTMLElement>(
                  'button:not(:disabled), [tabindex="0"]',
                ),
              );
              const first = controls[0],
                last = controls.at(-1);
              if (
                e.shiftKey &&
                (document.activeElement === first || document.activeElement === mapDialog.current)
              ) {
                e.preventDefault();
                last?.focus();
              } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first?.focus();
              }
            }}
          >
            <div class="skill-card" tabIndex={-1} ref={mapDialog}>
              <h3>Skill Tree</h3>
              <fieldset class="skill-fieldset" disabled={busy}>
                <SkillTree
                  nation={species.nation}
                  ranks={tree}
                  level={level}
                  onAdd={addRank}
                  onRemove={removeRank}
                  onPassive={togglePassive}
                  stance={stance}
                  onStance={setStance}
                />
              </fieldset>
              <div class="row" style={{ border: 0, justifyContent: 'space-between', marginTop: 8 }}>
                <span class="hint">Changes apply after Save. Respec is free.</span>
                <button
                  disabled={busy || Object.values(tree).every((r) => !r)}
                  onClick={() => setTree({})}
                >
                  Reset all
                </button>
              </div>
              {err && <p class="loadout-error">Couldn't save: {err}</p>}
              <div
                class="skill-footer row"
                style={{ border: 0, justifyContent: 'flex-end', gap: 8 }}
              >
                <button disabled={busy} onClick={cancelMap}>
                  Cancel
                </button>
                <button class="primary" disabled={busy} onClick={() => void save(true)}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}
        {err && <p class="loadout-error">Couldn't save: {err}</p>}
        {saveDisabledReason && !err && !saved && (
          <p class="hint" style={{ textAlign: 'right' }}>
            {saveDisabledReason}
          </p>
        )}
        <div class="row" style={{ border: 0, justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button onClick={onDiscard} disabled={busy}>
            Discard changes
          </button>
          <button
            class="primary"
            onClick={() => void save()}
            disabled={saveDisabled}
            title={saveDisabledReason ?? undefined}
          >
            {saved ? 'Saved' : busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </fieldset>
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

function HistoryEntry({ b }: { b: BattleSummary }) {
  const o = b.opponent;
  const species = speciesOf(o.speciesId);
  const ids =
    o.loadout.moves?.length === 3 ? o.loadout.moves : defaultLoadoutMoveIds(species, o.level);
  return (
    <div class="opponent-strip" data-battle-id={b.id}>
      <div class="top">
        <b>{o.nickname}</b>
        <span class={b.won ? 'res-w' : 'res-l'}>
          {b.won ? 'WON' : 'LOST'} +{b.xp} XP
        </span>
      </div>
      <p class="hint" style={{ margin: '3px 0 0' }}>
        {displayName(o.speciesId, o.stage)} Lv {o.level} · {b.turns} turns · {ago(b.at)}
      </p>
      <div class="moves">
        {ids.map((id, i) => (
          <span class="chip" key={i}>
            {findMove(species, id)?.name ?? id}
          </span>
        ))}
      </div>
    </div>
  );
}
export function BattlesView({ s }: { s: UiSnapshot }) {
  const [editorKey, setEditorKey] = useState(0);
  const [, setTick] = useState(0);
  useEffect(() => {
    const refresh = () => void window.monsUi.refreshBattles().catch(() => {});
    refresh();
    const timer = setInterval(refresh, 30_000);
    return () => clearInterval(timer);
  }, [s.profile.userId]);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const history = mergeBattleHistory(s.battles.history).slice(0, 10);
  return (
    <div>
      {s.pet.speciesId ? (
        <LoadoutEditor
          key={s.pet.speciesId + '-' + editorKey}
          s={s}
          onDiscard={() => setEditorKey((k) => k + 1)}
        />
      ) : (
        <div class="section">
          <p class="flavor">Hatch your mon to pick its abilities.</p>
        </div>
      )}
      <div class="section">
        <h3>Battle History</h3>
        {history.length === 0 ? (
          <p class="flavor">No battles yet.</p>
        ) : (
          history.map((b) => <HistoryEntry key={b.id} b={b} />)
        )}
      </div>
    </div>
  );
}
