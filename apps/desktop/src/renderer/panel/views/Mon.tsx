import {
  HATCH_XP,
  NATION_INFO,
  SPECIES,
  displayName,
  speciesForNation,
  statsAtLevel,
  unlockedMoves,
  type EffectId,
} from '@claude-mons/shared';
import type { UiSnapshot } from '../../../common/ipc.ts';
import { SpriteView } from '../../ui/SpriteView.tsx';

/**
 * Short chip labels for each move effect (docs/design/progression.md Move pool and effects) --
 * `EFFECT_DESCRIPTIONS` (packages/shared/src/battle/effects.ts) is a full sentence meant for the
 * loadout editor's dropdown hint, too long for this compact per-move row.
 */
const EFFECT_NAMES: Record<EffectId, string> = {
  priority: 'Priority',
  crit_up: 'Crit up',
  drain: 'Drain',
  shield_first: 'Shield',
  def_down: 'DEF down',
  burn: 'Burn',
  true_hit: 'True hit',
  charge: 'Charge',
};

export function MonView({ s }: { s: UiSnapshot }) {
  const nation = s.profile.nation!;
  const info = NATION_INFO[nation];
  const species = s.pet.speciesId ? SPECIES[s.pet.speciesId] : null;
  const p = s.progress;
  const total = p.xpIntoLevel + p.xpToNext;
  const pct = total > 0 ? Math.round((p.xpIntoLevel / total) * 100) : 100;
  const isEgg = s.pet.stage === 'egg';
  const stats = species ? statsAtLevel(species.baseStats, p.level) : null;

  return (
    <div>
      <div class="hero">
        <SpriteView
          speciesId={s.pet.speciesId}
          stage={s.pet.stage}
          nation={nation}
          scale={isEgg ? 4 : 3}
        />
        <div class="info">
          <div class="name">{species ? displayName(species.id, s.pet.stage) : 'Egg'}</div>
          <div class="sub">
            <span class={`badge ${nation}`}>{info.name}</span>{' '}
            {isEgg ? 'Unhatched' : `${s.pet.stage} · Level ${p.level}`}
            {species?.rarity === 'rare' && ' · ★ rare'}
          </div>
          <div class="bar">
            <i style={{ width: `${pct}%` }} />
          </div>
          <div class="sub">
            {isEgg
              ? `${p.totalXp} / ${HATCH_XP} XP to hatch`
              : `${p.xpIntoLevel} / ${total} XP to level ${p.level + 1}`}
          </div>
        </div>
      </div>

      {stats && (
        <div class="stats">
          <div class="stat">
            <b>{stats.hp}</b>
            <span>HP</span>
          </div>
          <div class="stat">
            <b>{stats.atk}</b>
            <span>ATK</span>
          </div>
          <div class="stat">
            <b>{stats.def}</b>
            <span>DEF</span>
          </div>
          <div class="stat">
            <b>{stats.spd}</b>
            <span>SPD</span>
          </div>
        </div>
      )}

      <div class="section" style={{ marginTop: 18 }}>
        <h3>Progress</h3>
        <div class="kv">
          <span>Total XP</span>
          <span>{p.totalXp}</span>
          <span>Streak</span>
          <span>
            {p.streakDays} day{p.streakDays === 1 ? '' : 's'}
          </span>
          <span>Status</span>
          <span>{s.pet.state.replace(/_/g, ' ')}</span>
          <span>Server sync</span>
          <span>{s.online.connected ? 'online' : 'offline (local XP)'}</span>
        </div>
      </div>

      <div class="section">
        <h3>{species ? 'About' : 'What could hatch'}</h3>
        {species ? (
          <p class="flavor">{species.flavor}</p>
        ) : (
          <div class="kv">
            {speciesForNation(nation).map((sp) => (
              <>
                <span key={sp.id}>{sp.names.baby}</span>
                <span>{sp.rarity === 'rare' ? '★ rare (25 %)' : 'common (75 %)'}</span>
              </>
            ))}
          </div>
        )}
      </div>

      {species &&
        (() => {
          const unlocked = unlockedMoves(species, p.level);
          const locked = species.movePool.filter((m) => p.level < m.unlocksAt);
          const nextLevel = locked.length > 0 ? Math.min(...locked.map((m) => m.unlocksAt)) : null;
          return (
            <div class="section">
              <h3>Moves</h3>
              <div class="move-list">
                {unlocked.map((m) => (
                  <div class="move-row" key={m.id}>
                    <span class={`chip move-type ${m.type === 'nation' ? nation : 'neutral'}`}>
                      {m.name}
                    </span>
                    <span class="hint">
                      {m.power} pwr · {m.effect ? EFFECT_NAMES[m.effect] : '—'}
                    </span>
                  </div>
                ))}
              </div>
              {locked.length > 0 && (
                <p class="flavor" style={{ margin: '6px 0 0' }}>
                  {locked.length} more move{locked.length === 1 ? '' : 's'} to discover — next at
                  level {nextLevel}
                </p>
              )}
            </div>
          );
        })()}

      <div class="section">
        <h3>Training</h3>
        <p class="flavor" style={{ margin: 0 }}>
          {s.hooks.status === 'installed-binary' || s.hooks.status === 'installed-script'
            ? 'Claude Code is connected. Every prompt, tool call and finished turn earns XP.'
            : 'Connect Claude Code in Settings to start training.'}
        </p>
      </div>

      {s.isDev && (
        <div class="dev">
          dev tools:
          <button onClick={() => void window.monsUi.devGrantXp(25)}>+25 XP</button>
          <button onClick={() => void window.monsUi.devGrantXp(500)}>+500 XP</button>
          <button onClick={() => void window.monsUi.devGrantXp(5000)}>+5000 XP</button>
        </div>
      )}
    </div>
  );
}
