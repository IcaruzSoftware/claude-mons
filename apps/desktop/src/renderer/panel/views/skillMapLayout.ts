/** Layout only: the map follows the actual prerequisite graph. */
export const SKILL_MAP_SIZE = { width: 3200, height: 2250 };
export const SKILL_MAP_ROOT = { x: 1050, y: 1080 };
export const STANCE_SKILL_POSITIONS = {
  fury: { x: 1700, y: 1060 },
  bulwark: { x: 1860, y: 1060 },
  gale: { x: 2020, y: 1060 },
};
export const MIN_SKILL_ZOOM = 0.08;
export const MAX_SKILL_ZOOM = 1.6;
export const STANCE_SKILL_AREA = { x: 1600, y: 925, width: 500, height: 250 };
export const PASSIVE_SKILL_AREA = { x: 2130, y: 220, width: 990, height: 1420 };

/** Four curved arms around the core; fork alternatives fan out tangentially. */
function radialPosition(branch: number, radius: number, tangent: number) {
  const angle = ((-135 + branch * 90) * Math.PI) / 180;
  return {
    x: SKILL_MAP_ROOT.x + Math.cos(angle) * radius - Math.sin(angle) * tangent,
    y: SKILL_MAP_ROOT.y + Math.sin(angle) * radius + Math.cos(angle) * tangent,
  };
}
export function skillMapPosition(branch: number, tier: number, choiceOffset = 0) {
  const radii = [150, 250, 350, 450, 550, 650, 800, 950, 950, 1100, 1250, 1250];
  const tangents = [-65, 65, -65, 65, -65, 0, 0, -90, 90, 0, -90, 90];
  return radialPosition(
    branch,
    radii[tier - 1]!,
    tier === 7 || tier === 10 ? choiceOffset * 170 : tangents[tier - 1]!,
  );
}
export function skillBranchLabelPosition(branch: number) {
  return radialPosition(branch, 400, 210);
}
export const SHARED_SKILL_GROUPS = [
  { name: 'Resilience', x: 2310, y: 450, ids: ['stone-skin', 'deep-roots', 'bedrock'] },
  { name: 'Pressure', x: 2760, y: 450, ids: ['wildfire', 'aftershock', 'ember-heart'] },
  { name: 'Momentum', x: 2310, y: 1150, ids: ['tailwind', 'updraft'] },
  { name: 'Recovery', x: 2760, y: 1150, ids: ['tidal-recovery', 'second-breath'] },
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
