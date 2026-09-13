/**
 * Segmented XP bar (docs/design/ui-style.md XP bar): a row of discrete bordered segments instead of
 * a single gradient fill. Segment count is cosmetic only -- it must never be read as "1 segment = 1
 * XP" or any other exact quantity.
 */
export function SegmentedBar({
  pct,
  segments = 16,
  class: cls,
}: {
  /** 0-100 */
  pct: number;
  segments?: number;
  class?: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const filled = Math.round((clamped / 100) * segments);
  return (
    <div class={`segbar ${cls ?? ''}`}>
      {Array.from({ length: segments }, (_, i) => (
        <i class={i < filled ? 'fill' : ''} key={i} />
      ))}
    </div>
  );
}
