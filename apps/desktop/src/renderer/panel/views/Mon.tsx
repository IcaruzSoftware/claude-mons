import {
  HATCH_XP,
  NATION_INFO,
  RARITY_WEIGHT,
  SPECIES,
  displayName,
  speciesForNation,
  statsAtLevel,
  unlockedMoves,
} from '@claude-mons/shared';
import type { UiSnapshot } from '../../../common/ipc.ts';
import { SpriteView } from '../../ui/SpriteView.tsx';
import { SegmentedBar } from '../../ui/SegmentedBar.tsx';
import { StatGem } from '../../ui/StatGem.tsx';
import { TypeChip } from '../../ui/TypeChip.tsx';
import { Glyph } from '../../ui/Glyph.tsx';
import { PixelPanel } from '../../ui/PixelPanel.tsx';

export function MonView({ s }: { s: UiSnapshot }) {
  const nation = s.profile.nation!;
  const info = NATION_INFO[nation];
  const isEgg = s.pet.stage === 'egg';
  // While the mon is still an egg, treat it as an egg even if the server has pre-set its species
  // (pre-destined eggs): the sprite stays the egg and this view shows the egg/hatch copy.
  const species = !isEgg && s.pet.speciesId ? SPECIES[s.pet.speciesId] : null;
  const p = s.progress;
  const total = p.xpIntoLevel + p.xpToNext;
  const pct = total > 0 ? Math.round((p.xpIntoLevel / total) * 100) : 100;
  const stats = species ? statsAtLevel(species.baseStats, p.level) : null;
  const shortPersonality = info.personality.split('.')[0]!.toLowerCase();

  return (
    <div>
      <div class={`hero tint-${nation}`}>
        <div class="mon-slot">
          <SpriteView
            speciesId={s.pet.speciesId}
            stage={s.pet.stage}
            nation={nation}
            scale={isEgg ? 4 : 3}
          />
        </div>
        <div class="info">
          <div class="name-row">
            <span class="name">{species ? displayName(species.id, s.pet.stage) : 'Egg'}</span>
            {!isEgg && <span class="stagebadge">{s.pet.stage}</span>}
            <span class="lvbadge">{isEgg ? 'Unhatched' : `Lv ${p.level}`}</span>
            {species?.rarity === 'rare' && <span class="rarebadge">★ rare</span>}
          </div>
          <div class="nationline">
            {isEgg ? `${info.name} egg` : `${info.name} · ${shortPersonality}`}
          </div>
          <SegmentedBar pct={isEgg ? Math.min(100, (p.totalXp / HATCH_XP) * 100) : pct} />
          <div class="xp-caption">
            {isEgg
              ? `${p.totalXp} / ${HATCH_XP} XP to hatch`
              : `${p.xpIntoLevel} / ${total} XP to level ${p.level + 1}`}
          </div>
        </div>
      </div>

      {stats && (
        <div class="section">
          <div class="gems">
            <StatGem kind="hp" value={stats.hp} label="HP" />
            <StatGem kind="atk" value={stats.atk} label="ATK" />
            <StatGem kind="def" value={stats.def} label="DEF" />
            <StatGem kind="spd" value={stats.spd} label="SPD" />
          </div>
        </div>
      )}

      {!species &&
        (() => {
          const pool = speciesForNation(nation);
          const weightTotal = pool.reduce((sum, sp) => sum + RARITY_WEIGHT[sp.rarity], 0);
          return (
            <div class="section">
              <h3>What could hatch</h3>
              <div class="hatch-odds">
                {pool.map((sp) => {
                  const odds = Math.round((RARITY_WEIGHT[sp.rarity] / weightTotal) * 100);
                  return (
                    <div class="row" key={sp.id}>
                      <span>{sp.names.baby}</span>
                      <span class="hint">
                        {sp.rarity === 'rare' ? `★ rare · ${odds}%` : `common · ${odds}%`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

      {species &&
        (() => {
          const unlocked = unlockedMoves(species, p.level);
          const locked = species.movePool.filter((m) => p.level < m.unlocksAt);
          const nextLevel = locked.length > 0 ? Math.min(...locked.map((m) => m.unlocksAt)) : null;
          return (
            <div class="section">
              <h3>
                Known moves · {unlocked.length}/{species.movePool.length} unlocked
              </h3>
              <div class="movecards">
                {unlocked.map((m) => (
                  <div class="movecard" key={m.id}>
                    <b>{m.name}</b>
                    <span class="pow">{m.power} pwr</span>
                    <TypeChip
                      nation={m.type === 'nation' ? nation : 'neutral'}
                      label={m.type === 'nation' ? info.name.toUpperCase() : 'NEUTRAL'}
                    />
                  </div>
                ))}
                {locked.length > 0 && (
                  <div class="teaser">
                    {locked.length} more move{locked.length === 1 ? '' : 's'} to discover · unlocks
                    at level {nextLevel}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

      <div class="section">
        <h3>Streak &amp; training</h3>
        <PixelPanel style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div class="streak-row">
            <Glyph name="flame" size={14} class="flame" />
            <span style={{ fontSize: 11.5 }}>
              {p.streakDays > 0 ? `${p.streakDays}-day streak` : 'No streak yet'}
            </span>
          </div>
          <p class="trainline">
            <span class="dot" />
            {s.hooks.status === 'installed-binary' || s.hooks.status === 'installed-script'
              ? 'Claude Code connected · every prompt and tool call earns XP'
              : 'Connect Claude Code in Settings to start training'}
          </p>
        </PixelPanel>
      </div>

      {species && <p class="flavor">{species.flavor}</p>}

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
