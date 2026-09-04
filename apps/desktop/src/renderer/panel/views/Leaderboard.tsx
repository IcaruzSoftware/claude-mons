import type { UiSnapshot } from '../../../common/ipc.ts';

export function LeaderboardView({ s }: { s: UiSnapshot }) {
  return (
    <div class="placeholder">
      <p>The global leaderboard and nation standings go live once your mon is synced.</p>
      <p>
        {s.online.connected ? 'Loading…' : 'Offline: connect to the internet to see the standings.'}
      </p>
    </div>
  );
}
