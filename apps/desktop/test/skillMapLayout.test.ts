import { describe, expect, it } from 'vitest';
import { NATIONS, SHARED_PASSIVE_NODES, nationNodes } from '@claude-mons/shared';
import {
  MAX_SKILL_ZOOM,
  MIN_SKILL_ZOOM,
  SKILL_MAP_SIZE,
  STANCE_SKILL_POSITIONS,
  sharedSkillPosition,
  skillMapPosition,
  zoomSkillMap,
} from '../src/renderer/panel/views/skillMapLayout.ts';

describe('skill map navigation', () => {
  it('keeps every nation and shared skill on the map without overlapping node centers', () => {
    for (const nation of NATIONS) {
      const nodes = nationNodes(nation);
      const branches = [...new Set(nodes.map((n) => n.branch))];
      const positions = [
        ...Object.values(STANCE_SKILL_POSITIONS),
        ...nodes.map((n) => skillMapPosition(branches.indexOf(n.branch), n.tier, n.choiceOffset)),
        ...SHARED_PASSIVE_NODES.map((p) => sharedSkillPosition(p.id)),
      ];
      for (const p of positions) {
        expect(p.x).toBeGreaterThan(40);
        expect(p.y).toBeGreaterThan(40);
        expect(p.x).toBeLessThan(SKILL_MAP_SIZE.width - 40);
        expect(p.y).toBeLessThan(SKILL_MAP_SIZE.height - 40);
        for (const other of positions) {
          if (p === other) continue;
          expect(Math.hypot(p.x - other.x, p.y - other.y)).toBeGreaterThan(90);
        }
      }
    }
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
