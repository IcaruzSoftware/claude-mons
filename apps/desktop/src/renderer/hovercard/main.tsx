import { render } from 'preact';
import { HATCH_XP, NATION_INFO, displayName } from '@claude-mons/shared';
import { xpCaption } from '../../common/xpCaption.ts';
import '../ui/theme.css';
import './hovercard.css';
import { snapshot, startSnapshotFeed } from '../ui/useSnapshot.ts';

function Card() {
  const s = snapshot.value;
  if (!s) return null;
  const nation = s.profile.nation;
  const name = s.pet.speciesId ? displayName(s.pet.speciesId, s.pet.stage) : 'Egg';
  const p = s.progress;
  const pct =
    s.pet.stage === 'egg'
      ? Math.min(100, Math.round((p.totalXp / HATCH_XP) * 100))
      : Math.round(p.fraction * 100);
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
        <span>{xpCaption({ ...p, stage: s.pet.stage })}</span>
        <span class="state">{s.pet.state.replace(/_/g, ' ')}</span>
      </div>
    </div>
  );
}

startSnapshotFeed();
render(<Card />, document.getElementById('root')!);
