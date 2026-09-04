import { render } from 'preact';
import { NATION_INFO, displayName } from '@claude-mons/shared';
import '../ui/theme.css';
import './hovercard.css';
import { snapshot, startSnapshotFeed } from '../ui/useSnapshot.ts';

function Card() {
  const s = snapshot.value;
  if (!s) return null;
  const nation = s.profile.nation;
  const name = s.pet.speciesId ? displayName(s.pet.speciesId, s.pet.stage) : 'Egg';
  const p = s.progress;
  const total = p.xpIntoLevel + p.xpToNext;
  const pct = total > 0 ? Math.round((p.xpIntoLevel / total) * 100) : 100;
  return (
    <div class="card">
      <div class="row">
        <span class="name pixel">{name}</span>
        {nation && <span class={`badge ${nation}`}>{NATION_INFO[nation].name}</span>}
        <span class="lvl">{s.pet.stage === 'egg' ? 'Egg' : `Lv ${p.level}`}</span>
      </div>
      <div class="bar">
        <i style={{ width: `${pct}%` }} />
      </div>
      <div class="row dim">
        <span>
          {s.pet.stage === 'egg'
            ? `${p.totalXp} / ${total} XP to hatch`
            : `${p.xpIntoLevel} / ${total} XP`}
        </span>
        <span class="state">{s.pet.state.replace(/_/g, ' ')}</span>
      </div>
    </div>
  );
}

startSnapshotFeed();
render(<Card />, document.getElementById('root')!);
