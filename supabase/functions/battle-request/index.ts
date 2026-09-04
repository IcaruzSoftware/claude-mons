// POST {} -> BattleRequestResponse (DESIGN.md §5.7, §6.2).
// claim_battle_slot -> pick an opponent from another nation (widening level windows) or a Wild Mon
// -> deterministic simulateBattle(seed = battle id) -> settle_battle.
import type { BattleRequestResponse, BattleRewardKind } from '../_shared/game/api.ts';
import {
  challengerReward,
  defenderReward,
  simulateBattle,
  snapshotFor,
  type MonSnapshot,
} from '../_shared/game/battle/battle.ts';
import { BATTLE_RULES } from '../_shared/game/battle/battle.ts';
import { stageForLevel } from '../_shared/game/game/levels.ts';
import { otherNations } from '../_shared/game/game/nations.ts';
import { speciesForNation } from '../_shared/game/game/species.ts';
import type { Nation, Stage } from '../_shared/game/types.ts';
import { requireUser } from '../_shared/auth.ts';
import { rpc, serviceClient, type MonRow, type ServiceClient } from '../_shared/db.ts';
import { error, json, serve } from '../_shared/http.ts';
import { buildMonState } from '../_shared/monState.ts';
import { loadPlayer, loadToday } from '../_shared/queries.ts';
import { randomInt } from '../_shared/random.ts';

type ClaimResult =
  | { ok: true; mon: MonRow }
  | { ok: false; reason: 'no_mon' | 'egg' | 'cooldown' | 'daily_cap'; cooldown_until?: string };

interface OpponentRow {
  mon_id: string;
  player_id: string;
  nickname: string;
  nation: Nation;
  species_id: string;
  stage: Exclude<Stage, 'egg'>;
  level: number;
}

interface SettleResult {
  challenger: MonRow;
  opponent: MonRow | null;
  opponent_xp_paid: number;
}

const LEVEL_WINDOWS: Array<number | null> = [3, 6, 10, null];

serve(async (req) => {
  if (req.method !== 'POST') return error('BAD_REQUEST', 'POST only', 405);
  const { uid } = await requireUser(req);
  const db = serviceClient();
  const now = new Date();

  const player = await loadPlayer(db, uid);
  if (!player) return error('NO_PROFILE', 'create a profile first', 409);

  const claim = await rpc<ClaimResult>(db, 'claim_battle_slot', { p_player: uid });
  if (!claim.ok) {
    switch (claim.reason) {
      case 'no_mon':
        return error('NO_PROFILE', 'create a profile first', 409);
      case 'egg':
        return error('EGG_CANNOT_BATTLE', 'your mon has not hatched yet', 400);
      case 'cooldown':
        return error('COOLDOWN', 'battle cooldown active', 429, {
          cooldownUntil: claim.cooldown_until ?? null,
        });
      case 'daily_cap':
        return error('DAILY_CAP', 'daily challenge limit reached', 429);
    }
  }
  const myMon = claim.mon;
  if (!myMon.species_id || myMon.stage === 'egg') {
    return error('EGG_CANNOT_BATTLE', 'your mon has not hatched yet', 400);
  }

  const me = snapshotFor({
    monId: myMon.id,
    playerId: uid,
    nickname: player.nickname,
    speciesId: myMon.species_id,
    stage: myMon.stage,
    level: myMon.level,
  });

  const opponent = await findOpponent(db, uid, player.nation, myMon.level);
  const isBot = opponent === null;
  const opp: MonSnapshot = opponent ?? wildMon(player.nation, myMon.level);

  const battleId = crypto.randomUUID();
  const result = simulateBattle(me, opp, battleId);
  const won = result.winner === 'a';
  const xp = challengerReward({ won, isBot, myLevel: me.level, oppLevel: opp.level });
  const oppXp = isBot ? 0 : defenderReward(!won);
  const kind: BattleRewardKind = isBot ? (won ? 'bot_win' : 'bot_loss') : won ? 'win' : 'loss';

  const settled = await rpc<SettleResult>(db, 'settle_battle', {
    p: {
      battle_id: battleId,
      challenger_id: uid,
      opponent_id: opp.playerId,
      challenger_snapshot: me,
      opponent_snapshot: opp,
      winner: result.winner,
      reason: result.reason,
      log: result,
      challenger_xp: xp,
      opponent_xp: oppXp,
    },
  });

  const today = await loadToday(db, uid, now);
  const mon = buildMonState(settled.challenger, today, player.streak_days, now);
  const cooldownUntil =
    mon.battle.cooldownUntil ?? new Date(now.getTime() + BATTLE_RULES.cooldownMs).toISOString();

  const response: BattleRequestResponse = {
    battle: { id: battleId, result, a: me, b: opp, isBot },
    reward: { xp, kind },
    mon,
    cooldownUntil,
  };
  return json(response, 200);
});

/**
 * Other-nation opponent with widening level windows. First pass prefers players not fought in the
 * last 24 h; if that yields nobody at any window, the recency clause is dropped.
 */
async function findOpponent(
  db: ServiceClient,
  uid: string,
  nation: Nation,
  level: number,
): Promise<MonSnapshot | null> {
  for (const excludeRecent of [true, false]) {
    for (const window of LEVEL_WINDOWS) {
      const rows = await rpc<OpponentRow[]>(db, 'pick_opponent', {
        p_player: uid,
        p_nation: nation,
        p_level: level,
        p_window: window,
        p_exclude_recent: excludeRecent,
      });
      const row = rows?.[0];
      if (row) {
        return snapshotFor({
          monId: row.mon_id,
          playerId: row.player_id,
          nickname: row.nickname,
          speciesId: row.species_id,
          stage: row.stage,
          level: row.level,
        });
      }
    }
  }
  return null;
}

/** Fallback bot: a random species from a random other nation at the challenger's level. */
function wildMon(myNation: Nation, level: number): MonSnapshot {
  const nations = otherNations(myNation);
  const nation = nations[randomInt(nations.length)]!;
  const pool = speciesForNation(nation);
  const species = pool[randomInt(pool.length)]!;
  const stage = stageForLevel(Math.max(2, level)) as Exclude<Stage, 'egg'>;
  return snapshotFor({
    monId: `wild:${species.id}`,
    playerId: null,
    nickname: `Wild ${species.names.baby}`,
    speciesId: species.id,
    stage,
    level: Math.max(2, level),
  });
}
