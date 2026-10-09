import { describe, expect, it } from 'vitest';
import type { BattleAction, BattleResult } from '@claude-mons/shared';
import type { BattlePlayMessage } from '../src/common/ipc.ts';
import { BattlePlayer, treeTriggerText } from '../src/renderer/pet/BattlePlayer.ts';

const hit = (over: Partial<BattleAction>): BattleAction => ({
  actor: 'a',
  move: 'Drip Tap',
  moveId: 'drip-tap',
  dodged: false,
  damage: 7,
  crit: false,
  effectiveness: 1,
  targetHpAfter: 93,
  effect: null,
  ...over,
});

/** Plays `result` to the end and returns every distinct banner in order. */
function banners(result: BattleResult, practice = false): string[] {
  const msg = {
    id: 'b1',
    result,
    me: { nickname: 'Drip' },
    opponent: { nickname: 'Pebs' },
    reward: 10,
    isBot: true,
    isElite: false,
    winStreak: 0,
    practice,
  } as unknown as BattlePlayMessage;
  const player = new BattlePlayer(
    msg,
    { x: 100, groundY: 100, facing: 1, spriteScale: 1, worldMinX: 0, worldMaxX: 400 },
    () => {},
    () => {},
  );
  const seen: string[] = [];
  for (let now = 1; player.tick(now); now += 20) {
    const banner = player.view.banner;
    if (banner && seen.at(-1) !== banner) seen.push(banner);
  }
  return seen;
}

describe('battle playback status banners', () => {
  it('does not say a knocked-out foe was burned', () => {
    const result = (targetHpAfter: number): BattleResult => ({
      seed: 's',
      winner: 'a',
      reason: 'ko',
      finalHp: { a: 90, b: targetHpAfter },
      maxHp: { a: 100, b: 100 },
      turns: [
        {
          turn: 1,
          first: 'a',
          actions: [
            hit({ move: 'Hotfix Howl', moveId: 'hotfix-howl', effect: 'burn', targetHpAfter }),
          ],
        },
      ],
    });
    expect(banners(result(0)).some((b) => b.includes('burns'))).toBe(false);
    expect(banners(result(40)).some((b) => b.includes('burns'))).toBe(true);
  });
});

describe('battle playback tree triggers', () => {
  it('names the node and what it did, without repeating the log prefix', () => {
    expect(
      treeTriggerText({
        side: 'b',
        node: 'bastion:1',
        step: 'crit',
        effect: 'noncrit',
        detail: 'Keel: crit cancelled',
      }),
    ).toBe('Keel — crit cancelled');
    expect(
      treeTriggerText({
        side: 'a',
        node: 'ward:6',
        step: 'lethal',
        effect: 'clamp',
        detail: 'held at 8 HP',
      }),
    ).toBe('Lastline — held at 8 HP');
    expect(
      treeTriggerText({
        side: 'a',
        node: 'gone:1',
        step: 'hit',
        effect: 'heal',
        detail: 'healed 3 HP',
      }),
    ).toBe('healed 3 HP');
  });

  it('shows action and turn triggers in the banner and still reads legacy combo logs', () => {
    const shown = banners({
      seed: 's',
      winner: 'a',
      reason: 'ko',
      finalHp: { a: 90, b: 0 },
      maxHp: { a: 100, b: 100 },
      turns: [
        {
          turn: 1,
          first: 'a',
          treeTriggers: [
            {
              side: 'b',
              node: 'bastion:3',
              step: 'pick',
              effect: 'finisher_early',
              detail: 'Quartermaster: finisher played early (slot 3)',
            },
          ],
          actions: [
            hit({
              crit: true,
              treeTriggers: [
                {
                  side: 'b',
                  node: 'bastion:1',
                  step: 'crit',
                  effect: 'noncrit',
                  detail: 'Keel: crit cancelled',
                },
                {
                  side: 'a',
                  node: 'strike:1',
                  step: 'hit',
                  effect: 'payoff_armed',
                  detail: "Hunter's Eye: armed",
                },
              ],
            }),
            // A dodged hit still reports the rule it armed.
            hit({
              actor: 'b',
              dodged: true,
              damage: 0,
              targetHpAfter: 100,
              treeTriggers: [
                {
                  side: 'a',
                  node: 'ward:2',
                  step: 'dodge',
                  effect: 'payoff_armed',
                  detail: 'Riposte Step: armed',
                },
              ],
            }),
          ],
        },
        {
          turn: 2,
          first: 'a',
          actions: [hit({ effect: 'def_down', targetHpAfter: 0, comboTalent: 'Quick Setup' })],
          treeTriggers: [
            {
              side: 'a',
              node: 'ward:8',
              step: 'turn_end',
              effect: 'heal',
              detail: 'Second Skin: healed 5 HP',
            },
          ],
        },
      ],
    });
    expect(shown).toEqual([
      'Pebs challenges you!',
      "Pebs's Quartermaster — finisher played early (slot 3)",
      'Drip used Drip Tap',
      "Pebs's Keel — crit cancelled",
      "Drip's Hunter's Eye — armed",
      'Pebs used Drip Tap',
      "Drip's Riposte Step — armed",
      'Drip used Drip Tap',
      "Drip's Quick Setup combo!",
      "Drip's Second Skin — healed 5 HP",
      'You win! +10 XP',
    ]);
  });

  it('labels a practice battle instead of showing +0 XP', () => {
    const result: BattleResult = {
      seed: 's',
      winner: 'b',
      reason: 'ko',
      finalHp: { a: 0, b: 50 },
      maxHp: { a: 100, b: 100 },
      turns: [{ turn: 1, first: 'b', actions: [hit({ actor: 'b', targetHpAfter: 0 })] }],
    };
    expect(banners(result, true).at(-1)).toBe('Pebs wins. Practice');
    expect(banners(result).at(-1)).toBe('Pebs wins. +10 XP');
  });
});
