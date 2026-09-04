import type { UiSnapshot } from '../../../common/ipc.ts';

export function BattlesView({ s }: { s: UiSnapshot }) {
  return (
    <div class="placeholder">
      {s.pet.stage === 'egg' ? (
        <p>
          Eggs can't fight. Hatch your mon first, then grab it and shake it to challenge another
          nation.
        </p>
      ) : (
        <p>Grab your mon and shake it to enter a battle. Your history will appear here.</p>
      )}
    </div>
  );
}
