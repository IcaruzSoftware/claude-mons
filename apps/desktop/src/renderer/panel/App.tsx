import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { snapshot } from '../ui/useSnapshot.ts';
import { Onboarding } from './views/Onboarding.tsx';
import { MonView } from './views/Mon.tsx';
import { LeaderboardView } from './views/Leaderboard.tsx';
import { BattlesView } from './views/Battles.tsx';
import { SettingsView } from './views/Settings.tsx';

export type Route = 'mon' | 'leaderboard' | 'battles' | 'settings';
const route = signal<Route>('mon');

const TABS: Array<{ id: Route; label: string }> = [
  { id: 'mon', label: 'Mon' },
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'battles', label: 'Battles' },
  { id: 'settings', label: 'Settings' },
];

export function App() {
  const s = snapshot.value;
  useEffect(() => {
    const onHash = () => {
      const r = location.hash.replace('#', '') as Route;
      if (TABS.some((t) => t.id === r)) route.value = r;
    };
    window.addEventListener('hashchange', onHash);
    onHash();
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (!s) return <div class="placeholder">Loading…</div>;
  if (!s.profile.nation) return <Onboarding />;

  return (
    <div class="app">
      <nav class="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            class={route.value === t.id ? 'active' : ''}
            onClick={() => (route.value = t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main class="view">
        {route.value === 'mon' && <MonView s={s} />}
        {route.value === 'leaderboard' && <LeaderboardView s={s} />}
        {route.value === 'battles' && <BattlesView s={s} />}
        {route.value === 'settings' && <SettingsView s={s} />}
      </main>
    </div>
  );
}
