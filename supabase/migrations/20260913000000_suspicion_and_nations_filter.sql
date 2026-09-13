-- Fixes two suspicion-heuristic bugs found via a live false-positive (a legitimate heavy user
-- reached suspicion = 96 purely from hitting the per-minute/hour/day caps on busy days, and
-- vanished from leaderboard_alltime/leaderboard_weekly while leaderboard_nations still counted
-- his XP). See docs/design/backend-rules.md and docs/design/economy.md.
--
-- (a) leaderboard_nations: the `members` CTE already filtered `p.suspicion < 10`, matching
--     leaderboard_alltime/leaderboard_weekly, but the `weekly` CTE (weekly_xp) did not -- a
--     suspicious player's weekly XP still counted toward their nation's weekly_xp. Add the same
--     filter there so members/hatched_members/total_xp/weekly_xp/avg_level are all computed over
--     the same non-suspicious population.
-- (b) apply_xp: `players.suspicion` only ever went up. ingest-xp's suspicion increment (see the
--     accompanying Edge Function change) now only fires for batches whose non-cap drops
--     (implausible/stale/future/no_prompt_context) exceed half of a claimed XP of at least 100 --
--     cap drops (cap_minute/cap_hour/cap_day) are the normal shape of a heavy legitimate day and
--     never count. To let a flagged-by-mistake or since-behaving-normally player recover, decay
--     suspicion by 1 (floor 0) every time a batch activates a new day -- the same "day activated"
--     signal already used to pay the daily/streak bonus (`p_deltas ->> 'streak_days' is not null`),
--     so the decay is atomic with the rest of apply_xp and costs no extra round trip.

-- --- (a) leaderboard_nations: filter the weekly CTE by suspicion too -----------------------------

create or replace view public.leaderboard_nations as
with week as (
  select date_trunc('week', now() at time zone 'utc') as start
),
nations as (
  select unnest(enum_range(null::public.nation)) as nation
),
members as (
  select
    p.nation,
    count(*)::int as members,
    count(*) filter (where m.stage <> 'egg')::int as hatched_members,
    coalesce(sum(m.total_xp), 0)::bigint as total_xp,
    round(avg(m.level) filter (where m.stage <> 'egg'), 2) as avg_level
  from public.players p
  join public.mons m on m.player_id = p.id
  where p.suspicion < 10
  group by p.nation
),
weekly as (
  select p.nation, sum(d.work_xp + d.bonus_xp + d.battle_xp)::bigint as weekly_xp
  from public.xp_daily d
  join public.players p on p.id = d.player_id
  cross join week
  where d.day >= week.start::date
    and p.suspicion < 10
  group by p.nation
),
fights as (
  -- A nation wins a battle when its mon was on the winning side. Wild Mons (opponent_id is null)
  -- carry a nation in their snapshot too but do not count for or against that nation.
  select
    n.nation,
    count(*) filter (where
      (b.winner = 'a' and b.challenger_snapshot ->> 'nation' = n.nation::text) or
      (b.winner = 'b' and b.opponent_id is not null and b.opponent_snapshot ->> 'nation' = n.nation::text)
    )::int as weekly_battles_won,
    count(*) filter (where
      (b.winner = 'b' and b.challenger_snapshot ->> 'nation' = n.nation::text) or
      (b.winner = 'a' and b.opponent_id is not null and b.opponent_snapshot ->> 'nation' = n.nation::text)
    )::int as weekly_battles_lost
  from nations n
  cross join week
  left join public.battles b on b.created_at >= week.start
  group by n.nation
)
select
  n.nation,
  coalesce(mem.members, 0) as members,
  coalesce(mem.hatched_members, 0) as hatched_members,
  coalesce(mem.total_xp, 0) as total_xp,
  coalesce(w.weekly_xp, 0) as weekly_xp,
  mem.avg_level,
  coalesce(f.weekly_battles_won, 0) as weekly_battles_won,
  coalesce(f.weekly_battles_lost, 0) as weekly_battles_lost,
  rank() over (order by coalesce(w.weekly_xp, 0) desc, coalesce(mem.total_xp, 0) desc, n.nation) as rank
from nations n
left join members mem on mem.nation = n.nation
left join weekly w on w.nation = n.nation
left join fights f on f.nation = n.nation;

-- leaderboard_nations is a plain view owned by postgres (not security_invoker), same as before:
-- it aggregates all players' xp_daily/battles, which clients cannot read row by row. Re-assert the
-- client grant so the replace above is a no-op for privileges.
grant select on public.leaderboard_nations to authenticated;

-- --- (b) apply_xp: decay suspicion by 1 (floor 0) whenever a batch activates a new day -----------

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
  v_day date := (now() at time zone 'utc')::date;
  v_work int := coalesce((p_deltas ->> 'work_xp')::int, 0);
  v_bonus int := coalesce((p_deltas ->> 'bonus_xp')::int, 0);
  v_prompts int := 0;
  v_stops int := 0;
  v_tool int := 0;
begin
  select * into v_before from public.mons where player_id = p_player for update;
  if not found then
    raise exception 'no mon for player %', p_player;
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
    v_prompts := v_prompts + coalesce(v_min.prompts, 0);
    v_stops := v_stops + coalesce(v_min.stops, 0);
    v_tool := v_tool + coalesce(v_min.tool_xp, 0);
  end loop;

  insert into public.xp_daily (player_id, day, work_xp, bonus_xp, prompts, stops, tool_xp)
  values (p_player, v_day, v_work, v_bonus, v_prompts, v_stops, v_tool)
  on conflict (player_id, day) do update set
    work_xp = public.xp_daily.work_xp + excluded.work_xp,
    bonus_xp = public.xp_daily.bonus_xp + excluded.bonus_xp,
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
    where id = p_player;
  else
    update public.players set last_seen_at = now() where id = p_player;
  end if;

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
    'stage_after', v_after.stage
  );
end;
$$;

-- Same security posture as before: security definer, execute revoked from anon/authenticated,
-- granted only to service_role. Re-asserted here since this migration replaces the function body.
revoke execute on function public.apply_xp(uuid, jsonb, double precision) from public, anon, authenticated;
grant execute on function public.apply_xp(uuid, jsonb, double precision) to service_role;
