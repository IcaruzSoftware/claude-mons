/** Layout only: the map follows the actual prerequisite graph. Five arms leave the core 72 degrees
 * apart; the main-passive clusters and the stances sit in the five gaps between them. */
export const SKILL_MAP_SIZE = { width: 3490, height: 3350 };
export const SKILL_MAP_ROOT = { x: 1745, y: 1512 };
/** The opening view centres this point, a little above the core so the top gap's main-passive
 * caption and Pressure cluster are on screen. */
export const SKILL_MAP_START = { x: SKILL_MAP_ROOT.x, y: SKILL_MAP_ROOT.y - 150 };
export const MIN_SKILL_ZOOM = 0.08;
export const MAX_SKILL_ZOOM = 1.6;

/** Arm angles in `TREE_BRANCHES` order (bastion, strike, ward, tempo, nation), clockwise from the
 * x axis: bastion upper left, strike upper right, ward right, nation down, tempo left. */
const ARM_ANGLES = [-126, -54, 18, 162, 90];
/** Per tier: distance from the core along the arm and sideways offset. Tiers zigzag across two
 * lanes so the labels below each node clear their neighbours at every arm angle. */
const RADII = [230, 350, 530, 680, 810, 970, 1160, 1320, 1320, 1490, 1660, 1660];
const TANGENTS = [-85, 75, -140, 0, -95, 60, 0, -100, 100, 0, -100, 100];
/** Sideways step of a fork alternative (`choiceOffset` -1/+1) from the tier's base slot. */
const FORK_SPREAD: Record<number, number> = { 3: 280, 7: 200, 10: 200 };

function polar(angleDeg: number, radius: number, tangent = 0) {
  const angle = (angleDeg * Math.PI) / 180;
  return {
    x: Math.round(SKILL_MAP_ROOT.x + Math.cos(angle) * radius - Math.sin(angle) * tangent),
    y: Math.round(SKILL_MAP_ROOT.y + Math.sin(angle) * radius + Math.cos(angle) * tangent),
  };
}
export function skillMapPosition(branch: number, tier: number, choiceOffset = 0) {
  return polar(
    ARM_ANGLES[branch]!,
    RADII[tier - 1]!,
    TANGENTS[tier - 1]! + choiceOffset * (FORK_SPREAD[tier] ?? 0),
  );
}
/** Branch name, beside the arm between tiers 4 and 5 on the side away from the tier-5 node. */
export function skillBranchLabelPosition(branch: number) {
  return polar(ARM_ANGLES[branch]!, 760, 190);
}

/** Gap bisectors between neighbouring arms. */
const GAP = { top: -90, upperRight: -18, lowerRight: 54, lowerLeft: 126, left: 198 };
/** Clusters stand across their gap's bisector, `spacing` apart. */
function clusterPosition(angle: number, radius: number, index: number, count: number) {
  return polar(angle, radius, (index - (count - 1) / 2) * 190);
}
export const STANCE_SKILL_POSITIONS = {
  fury: clusterPosition(GAP.upperRight, 1050, 0, 3),
  bulwark: clusterPosition(GAP.upperRight, 1050, 1, 3),
  gale: clusterPosition(GAP.upperRight, 1050, 2, 3),
};
export const STANCE_SKILL_LABEL = polar(GAP.upperRight, 1360);
/** Between the core and the Pressure cluster, so the opening view shows it. */
export const PASSIVE_SKILL_LABEL = polar(GAP.top, 880);
export const SHARED_SKILL_GROUPS = [
  // Pressure's label sits a little lower so the opening view shows it.
  { name: 'Pressure', angle: GAP.top, ids: ['wildfire', 'aftershock', 'ember-heart'], label: 1200 },
  { name: 'Recovery', angle: GAP.lowerRight, ids: ['tidal-recovery', 'second-breath'] },
  { name: 'Momentum', angle: GAP.lowerLeft, ids: ['tailwind', 'updraft'] },
  { name: 'Resilience', angle: GAP.left, ids: ['stone-skin', 'deep-roots', 'bedrock'] },
].map((group: { name: string; angle: number; ids: string[]; label?: number }) => ({
  ...group,
  ...polar(group.angle, group.label ?? 1260),
}));
export function sharedSkillPosition(id: string) {
  const group = SHARED_SKILL_GROUPS.find((g) => g.ids.some((slug) => `shared:${slug}` === id))!;
  const index = group.ids.findIndex((slug) => `shared:${slug}` === id);
  return clusterPosition(group.angle, 1050, index, group.ids.length);
}

/** Screen footprint of a node button of `size` px plus its name label below (146 px wide, at most
 * two name lines and the role line), for the overlap test. */
export function skillNodeBox(p: { x: number; y: number }, size: number) {
  return { left: p.x - 75, right: p.x + 75, top: p.y - size / 2, bottom: p.y + size / 2 + 80 };
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
