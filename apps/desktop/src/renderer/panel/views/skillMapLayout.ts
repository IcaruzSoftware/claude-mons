/** Layout only: edges still use the game's actual prerequisites, never decorative prerequisites. */
export const SKILL_MAP_SIZE = { width: 2450, height: 1360 };
export const SKILL_MAP_ROOT = { x: 800, y: 970 };
export const STANCE_SKILL_POSITIONS = {
  fury: { x: 640, y: 1190 },
  bulwark: { x: 800, y: 1190 },
  gale: { x: 960, y: 1190 },
};
export const MIN_SKILL_ZOOM = 0.08;
export const MAX_SKILL_ZOOM = 1.6;
export const STANCE_SKILL_AREA = { x: 535, y: 1070, width: 530, height: 230 };
export const PASSIVE_SKILL_AREA = { x: 1575, y: 45, width: 830, height: 1240 };

/** Twelve stations per branch, moving from the core through six paired rows. */
export function skillMapPosition(branch: number, tier: number) {
  return {
    x: 160 + branch * 380 + ((tier - 1) % 2) * 160,
    y: [830, 690, 520, 360, 235, 100][Math.floor((tier - 1) / 2)]!,
  };
}
export const SHARED_SKILL_GROUPS = [
  { name: 'Resilience', x: 1775, y: 270, ids: ['stone-skin', 'deep-roots', 'bedrock'] },
  { name: 'Pressure', x: 2200, y: 270, ids: ['wildfire', 'aftershock', 'ember-heart'] },
  { name: 'Momentum', x: 1775, y: 825, ids: ['tailwind', 'updraft'] },
  { name: 'Recovery', x: 2200, y: 825, ids: ['tidal-recovery', 'second-breath'] },
] as const;
export function sharedSkillPosition(id: string) {
  const group = SHARED_SKILL_GROUPS.find((g) => g.ids.some((slug) => `shared:${slug}` === id))!;
  const index = group.ids.findIndex((slug) => `shared:${slug}` === id);
  return {
    x: group.x + (index - (group.ids.length - 1) / 2) * 115,
    y: group.y + 120 + (index % 2) * 80,
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
