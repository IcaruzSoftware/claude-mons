import { useEffect, useState } from 'preact/hooks';
import { NATION_INFO, NATIONS, displayName, type Nation } from '@claude-mons/shared';
import type { LeaderboardPayload, UiSnapshot } from '../../../common/ipc.ts';

type Scope = 'alltime' | 'weekly';

export function LeaderboardView({ s }: { s: UiSnapshot }) {
  const [data, setData] = useState<LeaderboardPayload | null>(null);
  const [scope, setScope] = useState<Scope>('weekly');
  const [onlyMine, setOnlyMine] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setData(await window.monsUi.getLeaderboard());
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, []);

  if (!s.online.configured) {
    return <div class="placeholder">This build runs offline; there is no leaderboard.</div>;
  }
  if (!data) return <div class="placeholder">Loading standings…</div>;

  const myNation = s.profile.nation;
  const rows = scope === 'alltime' ? data.alltime : data.weekly;
  const filtered = onlyMine && myNation ? rows.filter((r) => r.nation === myNation) : rows;
  const nationRows = NATIONS.map(
    (n) => data.nations.find((r) => r.nation === n) ?? emptyNation(n),
  ).sort((a, b) => b.weekly_xp - a.weekly_xp || b.total_xp - a.total_xp);

  return (
    <div>
      <div class="section">
        <h3>Nation standings · this week</h3>
        <div class="nations-table">
          {nationRows.map((r, i) => {
            const info = NATION_INFO[r.nation];
            const games = r.weekly_battles_won + r.weekly_battles_lost;
            return (
              <div class={`nation-row ${r.nation === myNation ? 'mine' : ''}`} key={r.nation}>
                <span class="rank">#{i + 1}</span>
                <span class={`badge ${r.nation}`}>{info.name}</span>
                <span class="power">{r.weekly_xp.toLocaleString()} XP</span>
                <span class="hint">
                  {r.hatched_members}/{r.members} trainers · avg Lv{' '}
                  {r.avg_level ? Math.round(r.avg_level) : '–'} ·{' '}
                  {games > 0
                    ? `${Math.round((r.weekly_battles_won / games) * 100)} % battles won`
                    : 'no battles yet'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div class="section">
        <h3>
          Trainers
          <span class="seg" style={{ marginLeft: 10 }}>
            <button class={scope === 'weekly' ? 'active' : ''} onClick={() => setScope('weekly')}>
              This week
            </button>
            <button class={scope === 'alltime' ? 'active' : ''} onClick={() => setScope('alltime')}>
              All time
            </button>
          </span>
          <button
            style={{ marginLeft: 8, padding: '3px 8px', fontSize: 11 }}
            class={onlyMine ? 'active' : ''}
            onClick={() => setOnlyMine(!onlyMine)}
            disabled={!myNation}
          >
            My nation
          </button>
        </h3>
        {data.error && <p class="flavor">Could not refresh: {data.error}</p>}
        {filtered.length === 0 ? (
          <p class="flavor">
            {loading ? 'Loading…' : 'Nobody here yet. Hatch your egg to claim the first spot.'}
          </p>
        ) : (
          <div class="board">
            {filtered.map((r) => {
              const xp = 'weekly_xp' in r ? r.weekly_xp : r.total_xp;
              const mine = r.nickname === s.profile.nickname;
              return (
                <div class={`board-row ${mine ? 'mine' : ''}`} key={`${r.rank}-${r.nickname}`}>
                  <span class="rank">#{r.rank}</span>
                  <span class="who">
                    <b>{r.nickname}</b>
                    <span class="hint">
                      {displayName(r.species_id, r.stage)} · Lv {r.level}
                    </span>
                  </span>
                  <span class={`badge ${r.nation}`}>{NATION_INFO[r.nation].name}</span>
                  <span class="xp">{xp.toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        )}
        {data.myRank !== null && (
          <p class="hint" style={{ marginTop: 8 }}>
            Your all-time rank: #{data.myRank}
          </p>
        )}
        {s.pet.stage === 'egg' && <p class="hint">Eggs are not listed. Hatch first!</p>}
      </div>
    </div>
  );
}

function emptyNation(n: Nation) {
  return {
    nation: n,
    members: 0,
    hatched_members: 0,
    total_xp: 0,
    weekly_xp: 0,
    avg_level: null,
    weekly_battles_won: 0,
    weekly_battles_lost: 0,
    rank: 0,
  };
}
