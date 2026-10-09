-- settle_battle: mons.win_streak counts only wins against real players (rivals), as
-- docs/design/progression.md Matchmaking and streaks always said. Until now every challenger win
-- raised it, including Wild/Trainer NPC battles (opponent_id null), which are most battles.
-- NPC battles are now neutral: they neither raise nor reset the streak and are paid without the
-- streak multiplier. Rival wins raise it and are multiplied by 1 + 0.10 * min(new_streak, 5);
-- rival losses reset it to 0. Everything else is unchanged from
-- supabase/migrations/20260913020000_progression_phase_a.sql.

comment on column public.mons.win_streak is 'Consecutive real-player challenger wins; +1 on a rival win, reset to 0 on a rival loss, unchanged by NPC battles (settle_battle).';

create or replace function public.settle_battle(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_battle uuid := (p ->> 'battle_id')::uuid;
  v_ch uuid := (p ->> 'challenger_id')::uuid;
  v_op uuid := nullif(p ->> 'opponent_id', '')::uuid;
  v_ch_xp int := coalesce((p ->> 'challenger_xp')::int, 0);
  v_op_xp int := coalesce((p ->> 'opponent_xp')::int, 0);
  v_protocol int := coalesce((p ->> 'protocol_version')::int, 1);
  v_won boolean := (p ->> 'winner') = 'a';
  v_day date := (now() at time zone 'utc')::date;
  v_ch_mon uuid;
  v_prev_streak int;
  v_new_streak int;
  v_streak_mult numeric;
  v_ch_xp_final int;
  v_op_mon uuid;
  v_defended int;
  v_op_paid int := 0;
  v_ch_row public.mons;
  v_op_row public.mons;
begin
  select id, win_streak into v_ch_mon, v_prev_streak from public.mons where player_id = v_ch for update;
  if v_ch_mon is null then
    raise exception 'challenger % has no mon', v_ch;
  end if;

  v_new_streak := case
    when v_op is null then coalesce(v_prev_streak, 0)
    when v_won then coalesce(v_prev_streak, 0) + 1
    else 0
  end;
  v_streak_mult := case when v_won and v_op is not null then 1 + 0.1 * least(v_new_streak, 5) else 1 end;
  v_ch_xp_final := round(v_ch_xp * v_streak_mult)::int;

  insert into public.battles (
    id, challenger_id, opponent_id, challenger_snapshot, opponent_snapshot,
    winner, reason, log, challenger_xp, opponent_xp, protocol_version
  ) values (
    v_battle, v_ch, v_op, p -> 'challenger_snapshot', p -> 'opponent_snapshot',
    p ->> 'winner', p ->> 'reason', coalesce(p -> 'log', '{}'::jsonb), v_ch_xp_final, 0, v_protocol
  );

  update public.mons set
    total_xp = total_xp + v_ch_xp_final,
    battle_xp = battle_xp + v_ch_xp_final,
    last_opponent_id = v_op,
    win_streak = v_new_streak
  where id = v_ch_mon;
  insert into public.xp_daily (player_id, day, battle_xp) values (v_ch, v_day, v_ch_xp_final)
  on conflict (player_id, day) do update set battle_xp = public.xp_daily.battle_xp + excluded.battle_xp;
  v_ch_row := public.recompute_mon(v_ch_mon);

  if v_op is not null then
    select id into v_op_mon from public.mons where player_id = v_op for update;
    if v_op_mon is not null then
      select battles_defended into v_defended from public.xp_daily where player_id = v_op and day = v_day;
      if coalesce(v_defended, 0) < 10 then
        v_op_paid := v_op_xp;
        update public.mons set total_xp = total_xp + v_op_xp, battle_xp = battle_xp + v_op_xp where id = v_op_mon;
        insert into public.xp_daily (player_id, day, battle_xp, battles_defended) values (v_op, v_day, v_op_xp, 1)
        on conflict (player_id, day) do update set
          battle_xp = public.xp_daily.battle_xp + excluded.battle_xp,
          battles_defended = public.xp_daily.battles_defended + 1;
        update public.battles set opponent_xp = v_op_xp where id = v_battle;
      end if;
      -- The defender is told about every battle, even once the daily defender-XP cap is reached.
      insert into public.battle_notifications (player_id, battle_id) values (v_op, v_battle);
      v_op_row := public.recompute_mon(v_op_mon);
    end if;
  end if;

  return jsonb_build_object(
    'challenger', to_jsonb(v_ch_row),
    'opponent', to_jsonb(v_op_row),
    'opponent_xp_paid', v_op_paid,
    'challenger_xp_paid', v_ch_xp_final
  );
end;
$$;

revoke execute on function public.settle_battle(jsonb) from public, anon, authenticated;
grant execute on function public.settle_battle(jsonb) to service_role;
