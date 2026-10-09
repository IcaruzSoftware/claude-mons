import { describe, expect, it } from 'vitest';
import { NATIONS, SHARED_PASSIVE_NODES, TREE_BRANCHES, treeNodesFor } from '@claude-mons/shared';
import {
  MAX_SKILL_ZOOM,
  MIN_SKILL_ZOOM,
  PASSIVE_SKILL_LABEL,
  SHARED_SKILL_GROUPS,
  SKILL_MAP_ROOT,
  SKILL_MAP_SIZE,
  STANCE_SKILL_LABEL,
  STANCE_SKILL_POSITIONS,
  sharedSkillPosition,
  skillBranchLabelPosition,
  skillMapPosition,
  skillNodeBox,
  zoomSkillMap,
} from '../src/renderer/panel/views/skillMapLayout.ts';

type Box = { id: string; left: number; right: number; top: number; bottom: number };
const centred = (id: string, p: { x: number; y: number }, w: number, h: number): Box => ({
  id,
  left: p.x - w / 2,
  right: p.x + w / 2,
  top: p.y - h / 2,
  bottom: p.y + h / 2,
});

/** Every node with its label and every free-standing caption, as drawn (sizes from panel.css). */
function mapBoxes(nation: (typeof NATIONS)[number]): Box[] {
  return [
    { id: 'core', ...skillNodeBox(SKILL_MAP_ROOT, 88) },
    ...treeNodesFor(nation).map((n) => ({
      id: n.id,
      ...skillNodeBox(
        skillMapPosition(TREE_BRANCHES.indexOf(n.branch), n.tier, n.choiceOffset),
        n.kind === 'capstone' ? 76 : n.kind === 'passive' ? 60 : 44,
      ),
    })),
    ...Object.entries(STANCE_SKILL_POSITIONS).map(([id, p]) => ({ id, ...skillNodeBox(p, 60) })),
    ...SHARED_PASSIVE_NODES.map((p) => ({
      id: p.id,
      ...skillNodeBox(sharedSkillPosition(p.id), 60),
    })),
    ...TREE_BRANCHES.map((b, i) => centred(`label:${b}`, skillBranchLabelPosition(i), 170, 50)),
    ...SHARED_SKILL_GROUPS.map((g) => centred(`label:${g.name}`, g, 170, 40)),
    centred('caption:stance', STANCE_SKILL_LABEL, 280, 64),
    centred('caption:passive', PASSIVE_SKILL_LABEL, 480, 64),
  ];
}

describe('skill map navigation', () => {
  it('lays out five arms with no overlapping node, label or caption for every nation', () => {
    for (const nation of NATIONS) {
      const boxes = mapBoxes(nation);
      expect(boxes.filter((b) => b.id.startsWith('label:'))).toHaveLength(9);
      const overlaps: string[] = [];
      for (const [i, a] of boxes.entries()) {
        expect(a.left).toBeGreaterThan(20);
        expect(a.top).toBeGreaterThan(20);
        expect(a.right).toBeLessThan(SKILL_MAP_SIZE.width - 20);
        expect(a.bottom).toBeLessThan(SKILL_MAP_SIZE.height - 20);
        for (const b of boxes.slice(i + 1))
          if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)
            overlaps.push(`${a.id} x ${b.id}`);
      }
      expect(overlaps, nation).toEqual([]);
    }
  });
  it('points the five arms in five different directions', () => {
    const tips = TREE_BRANCHES.map((_, i) => skillMapPosition(i, 12));
    const angles = tips.map((p) =>
      Math.round((Math.atan2(p.y - SKILL_MAP_ROOT.y, p.x - SKILL_MAP_ROOT.x) * 180) / Math.PI),
    );
    expect(new Set(angles).size).toBe(5);
    for (const [i, a] of angles.entries())
      for (const b of angles.slice(i + 1))
        expect(Math.min(Math.abs(a - b), 360 - Math.abs(a - b))).toBeGreaterThan(60);
  });
  it('anchors zoom under the cursor, reverses accurately, and clamps both limits', () => {
    const view = { x: -120, y: -80, zoom: 0.75 };
    const anchor = { x: 180, y: 120 };
    const zoomed = zoomSkillMap(view, 1.2, anchor);
    expect((anchor.x - zoomed.x) / zoomed.zoom).toBeCloseTo((anchor.x - view.x) / view.zoom);
    expect((anchor.y - zoomed.y) / zoomed.zoom).toBeCloseTo((anchor.y - view.y) / view.zoom);
    const restored = zoomSkillMap(zoomed, 0.75, anchor);
    expect(restored.x).toBeCloseTo(view.x);
    expect(restored.y).toBeCloseTo(view.y);
    expect(restored.zoom).toBe(view.zoom);
    expect(zoomSkillMap(view, 100, anchor).zoom).toBe(MAX_SKILL_ZOOM);
    expect(zoomSkillMap(view, 0.001, anchor).zoom).toBe(MIN_SKILL_ZOOM);
  });
});
