-- Progression system Phase A (docs/design/progression.md): stances, evolution stat multipliers,
-- widened real-player matchmaking windows, win streaks, and the `set-loadout` Edge Function's
-- storage column. See CLAUDE.md's "add or change a species or nation" / battle rows for the related
-- docs, and docs/runbooks/extend-the-backend.md for the migration conventions followed here.

-- --- schema ------------------------------------------------------------------------------------

alter table public.mons add column loadout jsonb not null default '{}'::jsonb;
alter table public.mons add column win_streak int not null default 0;
-- Not enforced anywhere yet (Phase A has no talent tree to respec); added now so Phase C's respec
-- cooldown does not need another migration just to add the column.
alter table public.mons add column last_respec_at timestamptz;
comment on column public.mons.loadout is '{ stance?, moves?, tree? } (docs/design/progression.md). Only stance is set/read before Phase B/C.';
comment on column public.mons.win_streak is 'Consecutive real-player challenger wins; +1 on a win, reset to 0 on a loss (settle_battle).';
comment on column public.mons.last_respec_at is 'Reserved for the Phase C talent-tree respec cooldown; unused in Phase A.';

alter table public.battles add column protocol_version int not null default 1;
comment on column public.battles.protocol_version is 'packages/shared/src/battle/battle.ts:BATTLE_PROTOCOL_VERSION at the time this battle was simulated. Old rows replay from their stored log, never recomputed at a newer version.';

-- --- recompute_mon: evolution stat multiplier (Baby x1.00, Teen x1.15, Adult x1.30) -------------
-- Mirrors packages/shared/src/game/levels.ts:statAtLevel exactly (same floor-after-multiply order).

create or replace function public.recompute_mon(p_mon_id uuid, p_species_roll double precision default null)
returns public.mons
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  m public.mons;
  v_level int;
  v_stage public.mon_stage;
  v_stage_mult numeric;
  v_nation public.nation;
  v_base public.species_base_stats;
  v_now timestamptz := now();
begin
  select * into m from public.mons where id = p_mon_id for update;
  if not found then
    raise exception 'mon % not found', p_mon_id;
  end if;

  v_level := public.level_from_xp(m.total_xp);

  if m.species_id is null and m.total_xp >= 100 then
    if p_species_roll is null then
      raise exception 'species roll required to hatch mon %', p_mon_id;
    end if;
    select nation into v_nation from public.players where id = m.player_id;
    m.species_id := public.roll_species(v_nation, p_species_roll);
  end if;

  if m.species_id is null then
    v_stage := 'egg';
    m.stats := '{}'::jsonb;
  else
    v_stage := public.stage_for_level(v_level);
    v_stage_mult := case v_stage
      when 'teen' then 1.15
      when 'adult' then 1.30
      else 1.00
    end;
    select * into v_base from public.species_base_stats where species_id = m.species_id;
    m.stats := jsonb_build_object(
      'hp',  floor(v_base.hp::numeric  * (v_level + 49) * v_stage_mult / 50),
      'atk', floor(v_base.atk::numeric * (v_level + 49) * v_stage_mult / 50),
      'def', floor(v_base.def::numeric * (v_level + 49) * v_stage_mult / 50),
      'spd', floor(v_base.spd::numeric * (v_level + 49) * v_stage_mult / 50)
    );
  end if;

  if v_stage <> 'egg' and m.hatched_at is null then m.hatched_at := v_now; end if;
  if v_stage in ('teen', 'adult') and m.teen_at is null then m.teen_at := v_now; end if;
  if v_stage = 'adult' and m.adult_at is null then m.adult_at := v_now; end if;

  m.level := v_level;
  m.stage := v_stage;
  m.updated_at := v_now;

  update public.mons set
    species_id = m.species_id,
    stage = m.stage,
    level = m.level,
    stats = m.stats,
    hatched_at = m.hatched_at,
    teen_at = m.teen_at,
    adult_at = m.adult_at,
    updated_at = m.updated_at
  where id = m.id;

  return m;
end;
$$;

-- --- pick_opponent: asymmetric widening windows relative to the challenger's own level -----------
-- Was abs(level - p_level) <= p_window (symmetric); now an explicit [min_level, max_level] range so
-- battle-request's findOpponent can pass pass 1 [-2,+1], pass 2 [-4,+2], pass 3 any (both null).
-- Also now returns loadout so the opponent's stance carries into the battle snapshot.

drop function if exists public.pick_opponent(uuid, public.nation, int, int, boolean);

create or replace function public.pick_opponent(
  p_player uuid,
  p_nation public.nation,
  p_min_level int,
  p_max_level int,
  p_exclude_recent boolean
)
returns table (
  mon_id uuid,
  player_id uuid,
  nickname text,
  nation public.nation,
  species_id text,
  stage public.mon_stage,
  level int,
  loadout jsonb
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select m.id, m.player_id, p.nickname::text, p.nation, m.species_id, m.stage, m.level, m.loadout
  from public.mons m
  join public.players p on p.id = m.player_id
  where p.nation <> p_nation
    and m.stage <> 'egg'
    and m.species_id is not null
    and p.last_seen_at > now() - interval '30 days'
    and p.suspicion < 10
    and m.player_id <> p_player
    and m.player_id is distinct from (select me.last_opponent_id from public.mons me where me.player_id = p_player)
    and (p_min_level is null or m.level >= p_min_level)
    and (p_max_level is null or m.level <= p_max_level)
    and (
      not p_exclude_recent
      or not exists (
        select 1 from public.battles b
        where b.challenger_id = p_player
          and b.opponent_id = m.player_id
          and b.created_at > now() - interval '24 hours'
      )
    )
  order by random()
  limit 1;
$$;

-- --- settle_battle: win-streak XP multiplier + protocol_version ---------------------------------
-- p gains an optional `protocol_version` (defaults to 1 for callers that don't pass it yet).
-- challenger_xp is treated as the PRE-streak-multiplier amount (any elite-wild-mon doubling is
-- already folded in by battle-request); this function multiplies by
-- 1 + 0.10 * min(new_streak, 5) when the challenger won, and returns the actual amount credited as
-- `challenger_xp_paid` so the caller's response reflects what was really paid.

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

  v_new_streak := case when v_won then coalesce(v_prev_streak, 0) + 1 else 0 end;
  v_streak_mult := case when v_won then 1 + 0.1 * least(v_new_streak, 5) else 1 end;
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

-- --- grants --------------------------------------------------------------------------------------
-- Same security posture as before: security definer, execute revoked from anon/authenticated,
-- granted only to service_role. Re-asserted here since this migration replaces these function bodies
-- (and pick_opponent's signature changed).

revoke execute on function public.recompute_mon(uuid, double precision) from public, anon, authenticated;
grant execute on function public.recompute_mon(uuid, double precision) to service_role;

revoke execute on function public.pick_opponent(uuid, public.nation, int, int, boolean) from public, anon, authenticated;
grant execute on function public.pick_opponent(uuid, public.nation, int, int, boolean) to service_role;

revoke execute on function public.settle_battle(jsonb) from public, anon, authenticated;
grant execute on function public.settle_battle(jsonb) to service_role;
