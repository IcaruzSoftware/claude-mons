import { NATION_INFO, displayName } from '@claude-mons/shared';
import type { UiSnapshot } from '../../../common/ipc.ts';

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
  const history = s.battles.history;
  const cd = s.battles.cooldownUntil;
  const cdLeft = cd ? Math.max(0, Math.ceil((cd - Date.now()) / 60000)) : 0;
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
        </div>
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
                <div class="hint">
                  {displayName(b.opponent.speciesId, b.opponent.stage)} Lv {b.opponent.level} ·{' '}
                  {b.turns} turn{b.turns === 1 ? '' : 's'} ·{' '}
                  {b.reason === 'ko' ? 'knockout' : 'timeout'}
                  {b.isBot ? ' · wild' : ''} · {ago(b.at)}
                </div>
              </div>
              <div style={{ color: 'var(--accent)', fontWeight: 600 }}>+{b.xp} XP</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
