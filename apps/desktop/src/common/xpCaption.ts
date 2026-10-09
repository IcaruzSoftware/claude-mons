import { HATCH_XP, MAX_LEVEL, type LevelProgress } from '@claude-mons/shared';

/** The XP line under the hover card's bar and in the tray tooltip (same rules as the Mon view).
 * Pass the displayed stage, which stays `egg` until the server confirms the hatch. */
export function xpCaption(p: LevelProgress): string {
  if (p.stage === 'egg') return `${p.totalXp} / ${HATCH_XP} XP to hatch`;
  if (p.level >= MAX_LEVEL) return 'Max level';
  return `${p.xpIntoLevel} / ${p.xpIntoLevel + p.xpToNext} XP`;
}
