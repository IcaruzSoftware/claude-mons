-- apply_xp, replaced to fix four ingest defects (economy numbers unchanged):
--   (a) every minute's work XP is booked to the minute's own UTC day in xp_daily. A late minute from
--       yesterday used to land in today's row, tightening today's caps, letting today activate
--       early, and moving the XP into the wrong leaderboard day or week. Only bonus_xp goes to today.
--   (b) optimistic concurrency: ingest-xp reads mons.work_xp before it loads history and today's
--       totals, and passes it as p_deltas.expect_work_xp. If another batch (a second device) was
--       applied in between, the caps were computed against stale state; the function then writes
--       nothing and returns {conflict: true}, and ingest-xp recomputes the batch.
--   (c) the streak/bonus update only applies when last_active_day is before the day being
--       activated (today, or yesterday for a late batch), so two batches never both pay a day's
--       bonus and a late activation of yesterday never rewinds a later streak.
--   (d) idempotency: p_deltas.batch_id is recorded in ingest_batches inside this transaction, under
--       the mon lock. ingest-xp used to insert it before the pipeline ran, so a failure after the
--       insert made the client's retry a "duplicate" and its uncredited buckets were dropped. A known
--       batch_id returns {duplicate: true} without writing anything.
--       Deploy this migration before the ingest-xp that sends batch_id: without batch_id the
--       function behaves as before, so the previous ingest-xp (which inserts the id itself) keeps
--       working; the new ingest-xp against the old function would lose idempotency.
--   p_deltas.today is the edge function's UTC day (bonus booking), falling back to the DB clock.

create or replace function public.apply_xp(p_player uuid, p_deltas jsonb, p_species_roll double precision)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_before public.mons;
  v_after public.mons;
  v_min record;
  v_today date := coalesce((p_deltas ->> 'today')::date, (now() at time zone 'utc')::date);
  v_batch uuid := (p_deltas ->> 'batch_id')::uuid;
  v_work int := coalesce((p_deltas ->> 'work_xp')::int, 0);
  v_bonus int := coalesce((p_deltas ->> 'bonus_xp')::int, 0);
  v_expect int := (p_deltas ->> 'expect_work_xp')::int;
begin
  select * into v_before from public.mons where player_id = p_player for update;
  if not found then
    raise exception 'no mon for player %', p_player;
  end if;

  if v_batch is not null and exists (select 1 from public.ingest_batches where batch_id = v_batch) then
    return jsonb_build_object('duplicate', true, 'mon', to_jsonb(v_before));
  end if;

  if v_expect is not null and v_before.work_xp <> v_expect then
    return jsonb_build_object('conflict', true);
  end if;

  if v_batch is not null then
    insert into public.ingest_batches (batch_id, player_id) values (v_batch, p_player);
  end if;

  for v_min in
    select * from jsonb_to_recordset(coalesce(p_deltas -> 'minutes', '[]'::jsonb))
      as x(minute timestamptz, prompts int, stops int, tool_xp int)
  loop
    if v_min.minute is null then continue; end if;
    insert into public.xp_minutes (player_id, minute, prompts, stops, tool_xp)
    values (p_player, v_min.minute, coalesce(v_min.prompts, 0), coalesce(v_min.stops, 0), coalesce(v_min.tool_xp, 0))
    on conflict (player_id, minute) do update set
      prompts = public.xp_minutes.prompts + excluded.prompts,
      stops = public.xp_minutes.stops + excluded.stops,
      tool_xp = public.xp_minutes.tool_xp + excluded.tool_xp;
  end loop;

  -- per-minute work XP = prompts * 5 + stops * 10 + tool_xp (EVENT_XP in packages/shared/src/game/xp.ts)
  insert into public.xp_daily (player_id, day, work_xp, prompts, stops, tool_xp)
  select p_player, (x.minute at time zone 'utc')::date,
    sum(coalesce(x.prompts, 0) * 5 + coalesce(x.stops, 0) * 10 + coalesce(x.tool_xp, 0)),
    sum(coalesce(x.prompts, 0)), sum(coalesce(x.stops, 0)), sum(coalesce(x.tool_xp, 0))
  from jsonb_to_recordset(coalesce(p_deltas -> 'minutes', '[]'::jsonb))
    as x(minute timestamptz, prompts int, stops int, tool_xp int)
  where x.minute is not null
  group by 2
  on conflict (player_id, day) do update set
    work_xp = public.xp_daily.work_xp + excluded.work_xp,
    prompts = public.xp_daily.prompts + excluded.prompts,
    stops = public.xp_daily.stops + excluded.stops,
    tool_xp = public.xp_daily.tool_xp + excluded.tool_xp;

  if (p_deltas ->> 'streak_days') is not null then
    -- A batch that activates a new day (pays the daily/streak bonus) is also a sign of a full day
    -- of legitimate-looking activity; decay suspicion by 1 (floor 0) so a flagged player who keeps
    -- playing normally recovers over time. See docs/design/backend-rules.md.
    update public.players set
      streak_days = (p_deltas ->> 'streak_days')::int,
      last_active_day = coalesce((p_deltas ->> 'last_active_day')::date, last_active_day),
      suspicion = greatest(suspicion - 1, 0),
      last_seen_at = now()
    where id = p_player
      and (last_active_day is null or last_active_day < (p_deltas ->> 'last_active_day')::date);
    if not found then
      -- another batch already activated this day (or a later one) and paid its bonus
      v_bonus := 0;
      update public.players set last_seen_at = now() where id = p_player;
    end if;
  else
    update public.players set last_seen_at = now() where id = p_player;
  end if;

  insert into public.xp_daily (player_id, day, bonus_xp)
  values (p_player, v_today, v_bonus)
  on conflict (player_id, day) do update set
    bonus_xp = public.xp_daily.bonus_xp + excluded.bonus_xp;

  update public.mons set
    total_xp = total_xp + v_work + v_bonus,
    work_xp = work_xp + v_work,
    bonus_xp = bonus_xp + v_bonus
  where id = v_before.id;

  v_after := public.recompute_mon(v_before.id, p_species_roll);

  return jsonb_build_object(
    'mon', to_jsonb(v_after),
    'hatched', (v_before.species_id is null and v_after.species_id is not null),
    'level_before', v_before.level,
    'level_after', v_after.level,
    'stage_before', v_before.stage,
    'stage_after', v_after.stage,
    'bonus_xp', v_bonus
  );
end;
$$;

-- Same security posture as before: security definer, execute revoked from anon/authenticated,
-- granted only to service_role. Re-asserted here since this migration replaces the function body.
revoke execute on function public.apply_xp(uuid, jsonb, double precision) from public, anon, authenticated;
grant execute on function public.apply_xp(uuid, jsonb, double precision) to service_role;
