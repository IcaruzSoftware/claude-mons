import { useState } from 'preact/hooks';
import {
  EFFECT_DESCRIPTIONS,
  NATION_INFO,
  STANCES,
  displayName,
  speciesOf,
  type Move,
  type Stance,
} from '@claude-mons/shared';
import type { UiSnapshot } from '../../../common/ipc.ts';

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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
    setBusy(true);
    setErr(null);
    const r = await window.monsUi.setLoadout({ stance, moves });
    setBusy(false);
    if (r.ok) onClose();
    else setErr(r.error ?? 'Failed to save loadout');
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
        {err && <p class="flavor">{err}</p>}
        <div class="row" style={{ border: 0, justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            class="primary"
            onClick={() => void save()}
            disabled={busy || !distinct || !allUnlocked}
          >
            {busy ? 'Saving…' : 'Save'}
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
