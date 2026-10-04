/** Layout only: the map follows the actual prerequisite graph. */
export const SKILL_MAP_SIZE = { width: 2450, height: 2250 };
export const SKILL_MAP_ROOT = { x: 1225, y: 1125 };
export const STANCE_SKILL_POSITIONS = {
  fury: { x: 1745, y: 965 },
  bulwark: { x: 1745, y: 1125 },
  gale: { x: 1745, y: 1285 },
};
export const MIN_SKILL_ZOOM = 0.08;
export const MAX_SKILL_ZOOM = 1.6;
export const STANCE_SKILL_LABEL = { x: 1745, y: 790 };
export const PASSIVE_SKILL_LABEL = { x: 1225, y: 150 };

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
  return radialPosition(branch, 400, -210);
}
export const SHARED_SKILL_GROUPS = [
  { name: 'Resilience', x: 575, y: 775, ids: ['stone-skin', 'deep-roots', 'bedrock'] },
  { name: 'Pressure', x: 1225, y: 290, ids: ['wildfire', 'aftershock', 'ember-heart'] },
  { name: 'Momentum', x: 1225, y: 1615, ids: ['tailwind', 'updraft'] },
  { name: 'Recovery', x: 1945, y: 825, ids: ['tidal-recovery', 'second-breath'] },
] as const;
export function sharedSkillPosition(id: string) {
  const group = SHARED_SKILL_GROUPS.find((g) => g.ids.some((slug) => `shared:${slug}` === id))!;
  const index = group.ids.findIndex((slug) => `shared:${slug}` === id);
  const offset = index - (group.ids.length - 1) / 2;
  if (group.name === 'Resilience') return { x: group.x, y: 1125 + offset * 170 };
  if (group.name === 'Recovery') return { x: group.x, y: 1125 + offset * 200 };
  return {
    x: group.x + offset * (group.name === 'Pressure' ? 170 : 200),
    y: group.name === 'Pressure' ? 475 + (index % 2) * 60 : 1775,
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
