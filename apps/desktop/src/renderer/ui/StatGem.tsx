/**
 * Diamond stat gem (docs/design/ui-style.md Component specs): fixed per-stat color hints (HP
 * fire-red, ATK accent-yellow, DEF earth-green, SPD air-blue) -- these are NOT the mon's own
 * nation color, so all four stats stay visually distinct on every nation's mon.
 */
export function StatGem({
  kind,
  value,
  label,
}: {
  kind: 'hp' | 'atk' | 'def' | 'spd';
  value: number | string;
  label: string;
}) {
  return (
    <div class={`gem ${kind}`}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}
