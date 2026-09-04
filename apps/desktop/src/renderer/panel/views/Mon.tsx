import {
  HATCH_XP,
  NATION_INFO,
  SPECIES,
  displayName,
  speciesForNation,
  statsAtLevel,
} from '@claude-mons/shared';
import type { UiSnapshot } from '../../../common/ipc.ts';
import { SpriteView } from '../../ui/SpriteView.tsx';

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

      {species && (
        <div class="section">
          <h3>Moves</h3>
          <div class="kv">
            <span>Normal</span>
            <span>{species.moves.normal}</span>
            <span>{info.name} move</span>
            <span>{species.moves.typed}</span>
            <span>Special</span>
            <span>{species.moves.special}</span>
          </div>
        </div>
      )}

      <div class="section">
        <h3>Training</h3>
        <p class="flavor" style={{ margin: 0 }}>
          {s.hooks.status === 'installed'
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
