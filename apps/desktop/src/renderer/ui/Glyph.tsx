/**
 * 8x8 pixel glyph set (docs/design/ui-style.md Iconography): the only icon language besides a mon's
 * own sprite. Each glyph is an 8-row string grid ('#' = filled, '.' = empty), the same string-row
 * convention `packages/sprites` uses for real sprites, just at a much smaller logical size and with
 * a single color (`currentColor`) instead of a palette.
 */
export type GlyphName =
  'mon' | 'trophy' | 'swords' | 'gear' | 'flame' | 'clock' | 'leaf' | 'drop' | 'spark' | 'wind';

const GRID: Record<GlyphName, readonly string[]> = {
  mon: [
    '..####..',
    '.######.',
    '########',
    '##.##.##',
    '########',
    '###..###',
    '.######.',
    '..####..',
  ],
  trophy: [
    '.######.',
    '########',
    '#.####.#',
    '.######.',
    '..####..',
    '..####..',
    '.######.',
    '########',
  ],
  swords: [
    '#......#',
    '.#....#.',
    '..#..#..',
    '...##...',
    '...##...',
    '..#..#..',
    '.#....#.',
    '#......#',
  ],
  gear: [
    '..####..',
    '.#.##.#.',
    '##.##.##',
    '########',
    '########',
    '##.##.##',
    '.#.##.#.',
    '..####..',
  ],
  flame: [
    '...##...',
    '..####..',
    '.######.',
    '#.####.#',
    '########',
    '#.####.#',
    '.######.',
    '..####..',
  ],
  clock: [
    '..####..',
    '.#....#.',
    '#...#..#',
    '#...#..#',
    '#..##..#',
    '#......#',
    '.#....#.',
    '..####..',
  ],
  leaf: [
    '....#...',
    '...###..',
    '..#####.',
    '.#######',
    '#######.',
    '.#####..',
    '..###...',
    '...#....',
  ],
  drop: [
    '...##...',
    '...##...',
    '..####..',
    '.######.',
    '########',
    '########',
    '.######.',
    '..####..',
  ],
  spark: [
    '...##...',
    '...##...',
    '#..##..#',
    '.#....#.',
    '.#....#.',
    '#..##..#',
    '...##...',
    '...##...',
  ],
  wind: [
    '........',
    '..####..',
    '........',
    '.####...',
    '........',
    '..####..',
    '........',
    '........',
  ],
};

export function Glyph({
  name,
  size = 8,
  class: cls,
}: {
  name: GlyphName;
  size?: number;
  class?: string;
}) {
  const rows = GRID[name];
  const cells: [number, number][] = [];
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y]!;
    for (let x = 0; x < row.length; x++) {
      if (row[x] === '#') cells.push([x, y]);
    }
  }
  return (
    <svg
      class={`glyph ${cls ?? ''}`}
      viewBox="0 0 8 8"
      width={size}
      height={size}
      aria-hidden="true"
    >
      {cells.map(([x, y]) => (
        <rect x={x} y={y} width={1} height={1} fill="currentColor" key={`${x}-${y}`} />
      ))}
    </svg>
  );
}
