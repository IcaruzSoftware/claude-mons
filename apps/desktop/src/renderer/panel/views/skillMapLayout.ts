/** Layout only: edges still use the game's actual prerequisites, never decorative prerequisites. */
export const SKILL_MAP_SIZE = { width: 1700, height: 1150 };
export const SKILL_MAP_ROOT = { x: 600, y: 470 };
export const MIN_SKILL_ZOOM = 0.08;
export const MAX_SKILL_ZOOM = 1.6;

const PATHS = [
  [
    [465, 395],
    [345, 310],
    [195, 345],
    [135, 220],
    [265, 140],
    [155, 65],
  ],
  [
    [595, 315],
    [635, 215],
    [525, 130],
    [680, 75],
    [755, 190],
    [865, 85],
  ],
  [
    [745, 395],
    [860, 305],
    [1020, 355],
    [1090, 245],
    [955, 165],
    [1090, 70],
  ],
  [
    [950, 520],
    [1140, 540],
    [1325, 460],
    [1420, 320],
    [1550, 210],
    [1510, 70],
  ],
] as const;

export function skillMapPosition(branch: number, tier: number) {
  const [x, y] = PATHS[branch]![tier - 1]!;
  return { x, y };
}

export const SHARED_SKILL_GROUPS = [
  { name: 'Resilience', x: 290, y: 615, ids: ['stone-skin', 'deep-roots', 'bedrock'] },
  { name: 'Pressure', x: 460, y: 845, ids: ['wildfire', 'aftershock', 'ember-heart'] },
  { name: 'Momentum', x: 785, y: 845, ids: ['tailwind', 'updraft'] },
  { name: 'Recovery', x: 920, y: 615, ids: ['tidal-recovery', 'second-breath'] },
] as const;

export function sharedSkillPosition(id: string) {
  const group = SHARED_SKILL_GROUPS.find((g) => g.ids.some((slug) => `shared:${slug}` === id))!;
  const index = group.ids.findIndex((slug) => `shared:${slug}` === id);
  return {
    x: group.x + (index - (group.ids.length - 1) / 2) * 115,
    y: group.y + 100 + (index % 2) * 65,
  };
}

/** Zoom around the cursor, keeping the same world point beneath it. */
export function zoomSkillMap(
  view: { x: number; y: number; zoom: number },
  zoom: number,
  anchor: { x: number; y: number },
) {
  const nextZoom = Math.max(MIN_SKILL_ZOOM, Math.min(MAX_SKILL_ZOOM, zoom));
  const ratio = nextZoom / view.zoom;
  return {
    x: anchor.x - (anchor.x - view.x) * ratio,
    y: anchor.y - (anchor.y - view.y) * ratio,
    zoom: nextZoom,
  };
}
