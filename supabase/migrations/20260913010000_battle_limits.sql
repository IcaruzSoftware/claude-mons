-- Raises the battle challenge limits per the owner decision in packages/shared/src/battle/battle.ts
-- BATTLE_RULES: cooldown 5 min -> 10 min, challenges/day 10 -> 50. No cap on battle XP itself (battle
-- rewards were never subject to the work-XP daily caps in packages/shared/src/game/xp.ts and still
-- aren't). The defender-side cap (first 10 defenses/day pay XP, in settle_battle) is unchanged and
-- was already its own literal, not derived from the challenger cooldown/cap -- left untouched here.
-- See docs/design/battle.md.

create or replace function public.claim_battle_slot(p_player uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  m public.mons;
  v_day date := (now() at time zone 'utc')::date;
  v_started int;
  v_cooldown interval := interval '10 minutes';
begin
  select * into m from public.mons where player_id = p_player for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_mon');
  end if;
  if m.stage = 'egg' then
    return jsonb_build_object('ok', false, 'reason', 'egg');
  end if;
  if m.last_battle_at is not null and m.last_battle_at > now() - v_cooldown then
    return jsonb_build_object('ok', false, 'reason', 'cooldown', 'cooldown_until', m.last_battle_at + v_cooldown);
  end if;
  select battles_started into v_started from public.xp_daily where player_id = p_player and day = v_day;
  if coalesce(v_started, 0) >= 50 then
    return jsonb_build_object('ok', false, 'reason', 'daily_cap');
  end if;

  update public.mons set last_battle_at = now(), updated_at = now() where id = m.id returning * into m;
  insert into public.xp_daily (player_id, day, battles_started) values (p_player, v_day, 1)
  on conflict (player_id, day) do update set battles_started = public.xp_daily.battles_started + 1;

  return jsonb_build_object('ok', true, 'mon', to_jsonb(m));
end;
$$;

-- Same security posture as before: security definer, execute revoked from anon/authenticated,
-- granted only to service_role. Re-asserted here since this migration replaces the function body.
revoke execute on function public.claim_battle_slot(uuid) from public, anon, authenticated;
grant execute on function public.claim_battle_slot(uuid) to service_role;
