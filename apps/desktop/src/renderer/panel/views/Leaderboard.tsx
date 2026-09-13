import { useEffect, useState } from 'preact/hooks';
import { NATION_INFO, NATIONS, displayName, type Nation } from '@claude-mons/shared';
import type { LeaderboardPayload, UiSnapshot } from '../../../common/ipc.ts';
import { SpriteView } from '../../ui/SpriteView.tsx';
import { NationBadge } from '../../ui/NationBadge.tsx';
import { TypeChip } from '../../ui/TypeChip.tsx';
import { podiumOrder } from './leaderboardHelpers.ts';

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
  const podiumRows = podiumOrder(filtered.slice(0, 3));
  const restRows = filtered.slice(3);
  const nationRows = NATIONS.map(
    (n) => data.nations.find((r) => r.nation === n) ?? emptyNation(n),
  ).sort((a, b) => b.weekly_xp - a.weekly_xp || b.total_xp - a.total_xp);

  return (
    <div>
      <div class="section">
        <h3>Nation standings · this week</h3>
        {nationRows.map((r) => {
          const games = r.weekly_battles_won + r.weekly_battles_lost;
          const winPct = games > 0 ? Math.round((r.weekly_battles_won / games) * 100) : 0;
          return (
            <div
              class={`banner-tile tint-${r.nation} ${r.nation === myNation ? 'mine' : ''}`}
              key={r.nation}
            >
              <NationBadge nation={r.nation} />
              <div class="mid">
                <div class="nname">{NATION_INFO[r.nation].name}</div>
                <div class="xpnum">{r.weekly_xp.toLocaleString()} XP</div>
                <div class="meta">
                  {r.hatched_members}/{r.members} trainers · avg Lv{' '}
                  {r.avg_level ? Math.round(r.avg_level) : '–'}
                </div>
              </div>
              {games > 0 ? (
                <div class="winbar" title={`${winPct}% battles won`}>
                  <i style={{ width: `${winPct}%` }} />
                </div>
              ) : (
                <span class="winbar-empty">no battles yet</span>
              )}
            </div>
          );
        })}
      </div>

      <div class="section">
        <div class="board-header">
          <h3 style={{ margin: 0 }}>Trainers</h3>
          <span class="seg-pixel">
            <button class={scope === 'weekly' ? 'active' : ''} onClick={() => setScope('weekly')}>
              WEEK
            </button>
            <button class={scope === 'alltime' ? 'active' : ''} onClick={() => setScope('alltime')}>
              ALL-TIME
            </button>
          </span>
          <button
            style={{ padding: '3px 8px', fontSize: 11 }}
            class={onlyMine ? 'active' : ''}
            onClick={() => setOnlyMine(!onlyMine)}
            disabled={!myNation}
          >
            My nation
          </button>
        </div>
        {data.error && <p class="flavor">Could not refresh: {data.error}</p>}
        {filtered.length === 0 ? (
          <p class="flavor">
            {loading ? 'Loading…' : 'Nobody here yet. Hatch your egg to claim the first spot.'}
          </p>
        ) : (
          <>
            <div class="podium">
              {podiumRows.map(({ place, entry: r }) => (
                <div class={`pedestal p${place}`} key={r.rank}>
                  <SpriteView
                    speciesId={r.species_id}
                    stage={r.stage}
                    nation={r.nation}
                    scale={place === 1 ? 5 : 4}
                  />
                  <span class="pname">{r.nickname}</span>
                  <span class="pxp">
                    {('weekly_xp' in r ? r.weekly_xp : r.total_xp).toLocaleString()} XP
                  </span>
                  <div class="block">{place}</div>
                </div>
              ))}
            </div>
            {restRows.map((r) => {
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
                  <TypeChip nation={r.nation} label={NATION_INFO[r.nation].name.toUpperCase()} />
                  <span class="xp">{xp.toLocaleString()}</span>
                </div>
              );
            })}
          </>
        )}
        {data.myRank !== null && <p class="hint">Your all-time rank: #{data.myRank}</p>}
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
