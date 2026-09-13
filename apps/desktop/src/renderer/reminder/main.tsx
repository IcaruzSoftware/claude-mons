import { render } from 'preact';
import '../ui/theme.css';
import './reminder.css';
import { snapshot, startSnapshotFeed } from '../ui/useSnapshot.ts';
import { SpriteView } from '../ui/SpriteView.tsx';
import { Glyph } from '../ui/Glyph.tsx';

/**
 * Water reminder card. The window itself is only ever shown while `WaterReminder` (main process)
 * has decided it is due, so this component always renders the same fixed content — no local
 * due/visibility logic needed here.
 */
function Card() {
  const s = snapshot.value;
  if (!s) return null;
  return (
    <div class="reminder-card">
      <div class="icon">
        {s.pet.speciesId ? (
          <SpriteView
            speciesId={s.pet.speciesId}
            stage={s.pet.stage}
            nation={s.profile.nation}
            scale={3}
          />
        ) : (
          <Glyph name="drop" size={28} />
        )}
      </div>
      <div class="body">
        <div class="msg">Time for a sip of water</div>
        <div class="actions">
          <button class="primary" onClick={() => void window.monsUi.water.done()}>
            Done
          </button>
          <button onClick={() => void window.monsUi.water.snooze()}>Snooze 10 min</button>
        </div>
      </div>
    </div>
  );
}

startSnapshotFeed();
render(<Card />, document.getElementById('root')!);
