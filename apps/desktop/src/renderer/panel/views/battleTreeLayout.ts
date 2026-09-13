/**
 * Pure SVG coordinate lookup for `Battles.tsx`'s talent tree, kept dependency-free (no Preact
 * import) so the layout is unit-testable without mounting the tree's component.
 */

/** Tier y-coordinates, tier 1 (nearest the trunk) to tier 6 (the capstone), rising upward. */
export const TIER_Y = [185, 155, 125, 95, 65, 35] as const;
/** x-coordinate per branch column (left/center/right). */
export const BRANCH_X = [60, 150, 240] as const;

/**
 * `branchIndex` is 0-2 (left/center/right column), `tier` is 1-6 (nearest the trunk to the
 * capstone, rising upward -- a higher tier means a smaller y).
 */
export function treeNodePosition(branchIndex: number, tier: number): { x: number; y: number } {
  return { x: BRANCH_X[branchIndex]!, y: TIER_Y[tier - 1]! };
}
