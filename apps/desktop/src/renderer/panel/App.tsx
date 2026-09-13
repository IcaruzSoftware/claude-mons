import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { snapshot } from '../ui/useSnapshot.ts';
import { BottomTabBar, type BottomTab } from '../ui/BottomTabBar.tsx';
import { Onboarding } from './views/Onboarding.tsx';
import { MonView } from './views/Mon.tsx';
import { LeaderboardView } from './views/Leaderboard.tsx';
import { BattlesView } from './views/Battles.tsx';
import { SettingsView } from './views/Settings.tsx';

export type Route = 'mon' | 'leaderboard' | 'battles' | 'settings';
const route = signal<Route>('mon');

const TABS: ReadonlyArray<BottomTab<Route>> = [
  { id: 'mon', label: 'MON', glyph: 'mon' },
  { id: 'leaderboard', label: 'BOARD', glyph: 'trophy' },
  { id: 'battles', label: 'BATTLE', glyph: 'swords' },
  { id: 'settings', label: 'SETUP', glyph: 'gear' },
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
  if (!s.profile.nation) return <Onboarding s={s} />;

  return (
    <div class="app">
      <main class="view">
        {route.value === 'mon' && <MonView s={s} />}
        {route.value === 'leaderboard' && <LeaderboardView s={s} />}
        {route.value === 'battles' && <BattlesView s={s} />}
        {route.value === 'settings' && <SettingsView s={s} />}
        <div class="scroll-fade" aria-hidden="true" />
      </main>
      <BottomTabBar tabs={TABS} active={route.value} onChange={(id) => (route.value = id)} />
    </div>
  );
}
