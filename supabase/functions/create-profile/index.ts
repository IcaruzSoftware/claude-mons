// POST { nickname?, nation? } -> CreateProfileResponse (DESIGN.md §6.2).
// First call creates players + egg mon (nation required, nickname optional/generated).
// Later calls: nation is locked (409 NATION_LOCKED); nickname may change once per 7 days.
import type { CreateProfileRequest, CreateProfileResponse } from '../_shared/game/api.ts';
import { generateNickname, validateNickname } from '../_shared/game/game/nickname.ts';
import { isNation } from '../_shared/game/types.ts';
import { requireUser } from '../_shared/auth.ts';
import { rpc, serviceClient, type MonRow, type PlayerRow } from '../_shared/db.ts';
import { error, json, readJson, serve } from '../_shared/http.ts';
import { loadPlayer, monStateFor } from '../_shared/queries.ts';

const RENAME_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const UNIQUE_VIOLATION = '23505';

serve(async (req) => {
  if (req.method !== 'POST') return error('BAD_REQUEST', 'POST only', 405);
  const { uid } = await requireUser(req);
  const body = await readJson<CreateProfileRequest>(req, 4096);
  const db = serviceClient();
  const now = new Date();

  const requestedNick = typeof body.nickname === 'string' ? body.nickname.trim() : '';
  if (requestedNick) {
    const v = validateNickname(requestedNick);
    if (!v.ok) {
      return error('NICKNAME_INVALID', `nickname rejected (${v.reason})`, 400, {
        reason: v.reason,
      });
    }
  }

  const existing = await loadPlayer(db, uid);

  if (!existing) {
    if (!isNation(body.nation)) {
      return error('INVALID_NATION', 'nation must be one of water, fire, earth, air', 400);
    }
    let player: PlayerRow | null = null;
    for (let attempt = 0; attempt < 5 && !player; attempt++) {
      const nickname = requestedNick || generateNickname(attempt === 0 ? uid : `${uid}:${attempt}`);
      const { data, error: insertError } = await db
        .from('players')
        .insert({ id: uid, nickname, nation: body.nation })
        .select('*')
        .single();
      if (insertError) {
        if (insertError.code === UNIQUE_VIOLATION) {
          if (requestedNick) return error('NICKNAME_TAKEN', 'nickname already in use', 409);
          continue;
        }
        throw new Error(`players insert: ${insertError.message}`);
      }
      player = data as PlayerRow;
    }
    if (!player) return error('NICKNAME_TAKEN', 'could not allocate a nickname', 409);

    const { data: monData, error: monError } = await db
      .from('mons')
      .insert({ player_id: uid })
      .select('*')
      .single();
    if (monError) throw new Error(`mons insert: ${monError.message}`);
    const mon = monData as MonRow;

    const response: CreateProfileResponse = {
      player: { id: player.id, nickname: player.nickname, nation: player.nation },
      mon: await monStateFor(db, mon, player.streak_days, now),
      created: true,
    };
    return json(response, 201);
  }

  // --- existing profile -------------------------------------------------------------------------
  if (body.nation !== undefined && body.nation !== existing.nation) {
    return error('NATION_LOCKED', 'nation cannot be changed in v1', 409);
  }

  let player = existing;
  if (requestedNick && requestedNick !== existing.nickname) {
    const changedAt = existing.nickname_changed_at ? Date.parse(existing.nickname_changed_at) : 0;
    const nextAllowed = changedAt + RENAME_COOLDOWN_MS;
    if (nextAllowed > now.getTime()) {
      return error('RENAME_COOLDOWN', 'nickname can be changed once every 7 days', 429, {
        nextAllowedAt: new Date(nextAllowed).toISOString(),
      });
    }
    const { data, error: updateError } = await db
      .from('players')
      .update({ nickname: requestedNick, nickname_changed_at: now.toISOString() })
      .eq('id', uid)
      .select('*')
      .single();
    if (updateError) {
      if (updateError.code === UNIQUE_VIOLATION) {
        return error('NICKNAME_TAKEN', 'nickname already in use', 409);
      }
      throw new Error(`players update: ${updateError.message}`);
    }
    player = data as PlayerRow;
  }

  await rpc(db, 'touch_player', { p_player: uid });

  const { data: monData, error: monError } = await db
    .from('mons')
    .select('*')
    .eq('player_id', uid)
    .maybeSingle();
  if (monError) throw new Error(`mons: ${monError.message}`);
  let mon = monData as MonRow | null;
  if (!mon) {
    // Should not happen (mons row is created with the player) but heal instead of failing.
    const { data, error: healError } = await db
      .from('mons')
      .insert({ player_id: uid })
      .select('*')
      .single();
    if (healError) throw new Error(`mons insert: ${healError.message}`);
    mon = data as MonRow;
  }

  const response: CreateProfileResponse = {
    player: { id: player.id, nickname: player.nickname, nation: player.nation },
    mon: await monStateFor(db, mon, player.streak_days, now),
    created: false,
  };
  return json(response, 200);
});
