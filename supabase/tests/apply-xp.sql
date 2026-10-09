-- Run only in an empty disposable PostgreSQL database:
-- psql -v ON_ERROR_STOP=1 -f supabase/tests/apply-xp.sql
-- apply_xp books late minutes to their own UTC day, rejects a batch computed against stale state,
-- never pays one day's bonus twice, and keeps batch idempotency inside its own transaction.
-- Not executed by CI or by agents (agents must not run SQL); run it by hand.
begin;
create schema if not exists extensions;
do $$ begin
  create role anon; create role authenticated; create role service_role;
exception when duplicate_object then null; end $$;
create type public.mon_stage as enum ('egg', 'baby', 'teen', 'adult');
create table public.players (id uuid primary key, streak_days int not null default 0,
  last_active_day date, suspicion int not null default 0, last_seen_at timestamptz);
create table public.mons (id uuid primary key, player_id uuid unique, species_id text,
  stage public.mon_stage not null default 'egg', level int not null default 1,
  total_xp int not null default 0, work_xp int not null default 0, bonus_xp int not null default 0);
create table public.xp_minutes (player_id uuid, minute timestamptz, prompts int not null default 0,
  stops int not null default 0, tool_xp int not null default 0, primary key (player_id, minute));
create table public.xp_daily (player_id uuid, day date, work_xp int not null default 0,
  bonus_xp int not null default 0, prompts int not null default 0, stops int not null default 0,
  tool_xp int not null default 0, primary key (player_id, day));
create table public.ingest_batches (batch_id uuid primary key, player_id uuid not null,
  received_at timestamptz not null default now());
create function public.recompute_mon(p_mon uuid, p_roll double precision) returns public.mons
  language sql as $f$ select * from public.mons where id = p_mon $f$;
\ir ../migrations/20261009000000_apply_xp_per_day_and_concurrency.sql
insert into public.players (id) values ('00000000-0000-0000-0000-000000000001');
insert into public.mons (id, player_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001');
do $$
declare
  p uuid := '00000000-0000-0000-0000-000000000001';
  v_today date := (now() at time zone 'utc')::date;
  v_late timestamptz := (v_today::timestamp - interval '1 minute') at time zone 'utc';
  r jsonb;
  d public.xp_daily;
begin
  -- a late minute from yesterday (2 prompts + 1 stop = 20 XP) is booked to yesterday, not today
  perform public.apply_xp(p, jsonb_build_object(
    'minutes', jsonb_build_array(jsonb_build_object('minute', v_late, 'prompts', 2, 'stops', 1, 'tool_xp', 0)),
    'work_xp', 20, 'bonus_xp', 0, 'expect_work_xp', 0), 0.5);
  select * into d from public.xp_daily where player_id = p and day = v_today - 1;
  if d.work_xp is distinct from 20 or d.prompts is distinct from 2 or d.stops is distinct from 1 then
    raise exception 'late minute not booked to its own day: %', to_jsonb(d);
  end if;
  if exists (select 1 from public.xp_daily where player_id = p and day = v_today and work_xp <> 0) then
    raise exception 'late minute leaked into today';
  end if;

  -- a batch computed against stale state (work_xp moved since it was read) writes nothing
  r := public.apply_xp(p, jsonb_build_object(
    'minutes', jsonb_build_array(jsonb_build_object('minute', now(), 'prompts', 1, 'stops', 0, 'tool_xp', 0)),
    'work_xp', 5, 'bonus_xp', 0, 'expect_work_xp', 0), 0.5);
  if coalesce((r ->> 'conflict')::boolean, false) is not true then
    raise exception 'stale batch was applied: %', r;
  end if;
  if (select work_xp from public.mons where player_id = p) <> 20
     or (select count(*) from public.xp_minutes where player_id = p) <> 1 then
    raise exception 'stale batch changed state';
  end if;

  -- two batches activating the same day pay the bonus only once
  for i in 1..2 loop
    perform public.apply_xp(p, jsonb_build_object('minutes', '[]'::jsonb, 'work_xp', 0,
      'bonus_xp', 35, 'streak_days', 1, 'last_active_day', v_today), 0.5);
  end loop;
  if (select bonus_xp from public.mons where player_id = p) <> 35
     or (select bonus_xp from public.xp_daily where player_id = p and day = v_today) <> 35 then
    raise exception 'daily bonus paid twice';
  end if;

  -- a late activation of yesterday after today is already active pays nothing and keeps the streak
  perform public.apply_xp(p, jsonb_build_object('minutes', '[]'::jsonb, 'work_xp', 0,
    'bonus_xp', 45, 'streak_days', 9, 'last_active_day', v_today - 1), 0.5);
  if (select bonus_xp from public.mons where player_id = p) <> 35
     or (select last_active_day from public.players where id = p) <> v_today
     or (select streak_days from public.players where id = p) <> 1 then
    raise exception 'late activation of yesterday rewound the streak or paid twice';
  end if;

  -- p_deltas.today decides where the bonus is booked
  update public.players set last_active_day = null where id = p;
  perform public.apply_xp(p, jsonb_build_object('minutes', '[]'::jsonb, 'work_xp', 0,
    'bonus_xp', 25, 'streak_days', 1, 'last_active_day', v_today + 1, 'today', v_today + 1), 0.5);
  if (select bonus_xp from public.xp_daily where player_id = p and day = v_today + 1) is distinct from 25 then
    raise exception 'bonus not booked to p_deltas.today';
  end if;
end $$;

-- idempotency: a failure after apply_xp rolls the batch_id back with everything else, so the
-- retry is credited; a second delivery of a committed batch is a duplicate and writes nothing
savepoint failed_request;
select public.apply_xp('00000000-0000-0000-0000-000000000001', jsonb_build_object(
  'batch_id', '00000000-0000-4000-8000-0000000000b1', 'minutes', jsonb_build_array(
    jsonb_build_object('minute', now(), 'prompts', 1, 'stops', 0, 'tool_xp', 0)),
  'work_xp', 5, 'bonus_xp', 0), 0.5);
rollback to savepoint failed_request;
do $$
declare
  p uuid := '00000000-0000-0000-0000-000000000001';
  b jsonb := jsonb_build_object('batch_id', '00000000-0000-4000-8000-0000000000b1',
    'minutes', jsonb_build_array(jsonb_build_object('minute', now(), 'prompts', 1, 'stops', 0, 'tool_xp', 0)),
    'work_xp', 5, 'bonus_xp', 0);
  v_work int := (select work_xp from public.mons where player_id = p);
  r jsonb;
begin
  r := public.apply_xp(p, b, 0.5);
  if r ? 'duplicate' or (select work_xp from public.mons where player_id = p) <> v_work + 5 then
    raise exception 'retry after a rolled-back attempt was not credited: %', r;
  end if;
  r := public.apply_xp(p, b, 0.5);
  if coalesce((r ->> 'duplicate')::boolean, false) is not true
     or (select work_xp from public.mons where player_id = p) <> v_work + 5 then
    raise exception 'a committed batch was applied twice: %', r;
  end if;
end $$;
rollback;
