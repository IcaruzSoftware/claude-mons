-- claude-mons initial schema (DESIGN.md §6.1, Phase 4/5).
--
-- Trust model: clients hold an anonymous-auth JWT and may only READ (players, mons, own xp_daily,
-- own battles, own notifications, the three leaderboard views) and UPDATE battle_notifications.seen_at
-- on their own rows. Every write goes through the Edge Functions, which use the service role to call
-- the security-definer functions at the bottom of this file (execute revoked from anon/authenticated).

create extension if not exists citext with schema extensions;

-- --- enums -----------------------------------------------------------------------------------------

create type public.nation as enum ('water', 'fire', 'earth', 'air');
create type public.mon_stage as enum ('egg', 'baby', 'teen', 'adult');

-- --- tables ----------------------------------------------------------------------------------------

create table public.players (
  id uuid primary key references auth.users (id) on delete cascade,
  nickname extensions.citext not null unique
    constraint players_nickname_format check (nickname ~ '^[A-Za-z0-9_]{3,16}$'),
  nation public.nation not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  nickname_changed_at timestamptz,
  streak_days int not null default 0,
  last_active_day date,
  suspicion int not null default 0
);
comment on table public.players is 'One row per anonymous auth user. nation is permanent in v1.';
comment on column public.players.suspicion is 'Incremented by ingest-xp when >50% of a batch is dropped; >= 10 hides the player from leaderboards and matchmaking.';

-- Base stats per species, duplicated from packages/shared/src/game/species.ts so that the SQL side
-- can compute level-scaled stats and roll a species without a round trip. Keep in sync.
create table public.species_base_stats (
  species_id text primary key,
  nation public.nation not null,
  rarity text not null check (rarity in ('common', 'rare')),
  weight int not null,
  hp int not null,
  atk int not null,
  def int not null,
  spd int not null,
  sort_order int not null
);
insert into public.species_base_stats (species_id, nation, rarity, weight, hp, atk, def, spd, sort_order) values
  ('dripple',   'water', 'common', 75, 85, 45, 50, 30, 1),
  ('bubblit',   'water', 'rare',   25, 80, 50, 55, 30, 2),
  ('sparkit',   'fire',  'common', 75, 70, 60, 40, 40, 3),
  ('cinderpup', 'fire',  'rare',   25, 75, 60, 40, 40, 4),
  ('pebblet',   'earth', 'common', 75, 90, 45, 55, 20, 5),
  ('mossling',  'earth', 'rare',   25, 85, 50, 55, 25, 6),
  ('puffle',    'air',   'common', 75, 65, 50, 40, 55, 7),
  ('wispit',    'air',   'rare',   25, 70, 50, 40, 55, 8);

create table public.mons (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null unique references public.players (id) on delete cascade,
  species_id text references public.species_base_stats (species_id),
  stage public.mon_stage not null default 'egg',
  level int not null default 1,
  total_xp int not null default 0,
  work_xp int not null default 0,
  battle_xp int not null default 0,
  bonus_xp int not null default 0,
  stats jsonb not null default '{}'::jsonb,
  hatched_at timestamptz,
  teen_at timestamptz,
  adult_at timestamptz,
  last_battle_at timestamptz,
  last_opponent_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mons_species_or_egg check (species_id is not null or stage = 'egg')
);
comment on table public.mons is 'One mon per player. level/stage/stats are derived from total_xp by recompute_mon().';

create table public.xp_daily (
  player_id uuid not null references public.players (id) on delete cascade,
  day date not null,
  work_xp int not null default 0,
  bonus_xp int not null default 0,
  battle_xp int not null default 0,
  prompts int not null default 0,
  stops int not null default 0,
  tool_xp int not null default 0,
  battles_started int not null default 0,
  battles_defended int not null default 0,
  primary key (player_id, day)
);
comment on table public.xp_daily is 'Per player per UTC day counters. Also drives the weekly leaderboards and the battle caps.';

create table public.xp_minutes (
  player_id uuid not null references public.players (id) on delete cascade,
  minute timestamptz not null,
  prompts int not null default 0,
  stops int not null default 0,
  tool_xp int not null default 0,
  primary key (player_id, minute)
);
comment on table public.xp_minutes is 'Credited XP per UTC minute for the rolling caps and replay protection. Pruned after 48 h.';

create table public.ingest_batches (
  batch_id uuid primary key,
  player_id uuid not null references public.players (id) on delete cascade,
  received_at timestamptz not null default now()
);
comment on table public.ingest_batches is 'Idempotency keys for ingest-xp. Pruned after 48 h.';

create table public.battles (
  id uuid primary key,
  challenger_id uuid references public.players (id) on delete set null,
  opponent_id uuid references public.players (id) on delete set null,
  challenger_snapshot jsonb not null,
  opponent_snapshot jsonb not null,
  winner text not null check (winner in ('a', 'b')),
  reason text not null,
  log jsonb not null,
  challenger_xp int not null default 0,
  opponent_xp int not null default 0,
  created_at timestamptz not null default now()
);
comment on table public.battles is 'id doubles as the battle seed. Side a = challenger, b = opponent. opponent_id null = Wild Mon (bot).';

create table public.battle_notifications (
  id bigint generated always as identity primary key,
  player_id uuid not null references public.players (id) on delete cascade,
  battle_id uuid not null references public.battles (id) on delete cascade,
  created_at timestamptz not null default now(),
  seen_at timestamptz
);
comment on table public.battle_notifications is 'Tells a defender they were challenged. Clients may only set seen_at on their own rows.';

-- --- indexes ---------------------------------------------------------------------------------------

create index mons_level_hatched_idx on public.mons (level) where stage <> 'egg';
create index mons_total_xp_idx on public.mons (total_xp desc);
create index players_nation_idx on public.players (nation);
create index battles_challenger_idx on public.battles (challenger_id, created_at desc);
create index battles_opponent_idx on public.battles (opponent_id, created_at desc);
create index battles_created_idx on public.battles (created_at desc);
create index battle_notifications_unseen_idx on public.battle_notifications (player_id) where seen_at is null;
create index xp_daily_day_idx on public.xp_daily (day);
create index xp_minutes_minute_idx on public.xp_minutes (minute);
create index ingest_batches_received_idx on public.ingest_batches (received_at);

-- --- views -----------------------------------------------------------------------------------------

-- leaderboard_alltime only reads players and mons, both fully readable by authenticated users, so
-- it can run with the caller's privileges (security_invoker) and RLS applies as usual.
create view public.leaderboard_alltime
  with (security_invoker = true) as
select
  p.id as player_id,
  p.nickname::text as nickname,
  p.nation,
  m.species_id,
  m.stage,
  m.level,
  m.total_xp,
  rank() over (order by m.total_xp desc, m.hatched_at asc, p.id) as rank
from public.players p
join public.mons m on m.player_id = p.id
where m.stage <> 'egg'
  and p.suspicion < 10;

-- leaderboard_weekly and leaderboard_nations aggregate xp_daily and battles of ALL players, which
-- clients may only read row-by-row for themselves. They are therefore ordinary (non security_invoker)
-- views owned by postgres: PostgreSQL evaluates them with the owner's privileges, so RLS on the
-- underlying tables does not restrict the aggregates. The views expose only aggregated/public columns.
create view public.leaderboard_weekly as
with week as (
  select date_trunc('week', now() at time zone 'utc')::date as start
),
weekly as (
  select d.player_id, sum(d.work_xp + d.bonus_xp + d.battle_xp)::int as weekly_xp
  from public.xp_daily d, week
  where d.day >= week.start
  group by d.player_id
)
select
  p.id as player_id,
  p.nickname::text as nickname,
  p.nation,
  m.species_id,
  m.stage,
  m.level,
  coalesce(w.weekly_xp, 0) as weekly_xp,
  rank() over (order by coalesce(w.weekly_xp, 0) desc, m.total_xp desc, p.id) as rank
from public.players p
join public.mons m on m.player_id = p.id
left join weekly w on w.player_id = p.id
where m.stage <> 'egg'
  and p.suspicion < 10;

create view public.leaderboard_nations as
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

-- --- row level security ----------------------------------------------------------------------------

alter table public.players enable row level security;
alter table public.species_base_stats enable row level security;
alter table public.mons enable row level security;
alter table public.xp_daily enable row level security;
alter table public.xp_minutes enable row level security;
alter table public.ingest_batches enable row level security;
alter table public.battles enable row level security;
alter table public.battle_notifications enable row level security;

create policy players_select_authenticated on public.players
  for select to authenticated using (true);

create policy mons_select_authenticated on public.mons
  for select to authenticated using (true);

create policy species_select_authenticated on public.species_base_stats
  for select to authenticated using (true);

create policy xp_daily_select_own on public.xp_daily
  for select to authenticated using (player_id = (select auth.uid()));

create policy battles_select_own on public.battles
  for select to authenticated
  using (challenger_id = (select auth.uid()) or opponent_id = (select auth.uid()));

create policy battle_notifications_select_own on public.battle_notifications
  for select to authenticated using (player_id = (select auth.uid()));

create policy battle_notifications_update_own on public.battle_notifications
  for update to authenticated
  using (player_id = (select auth.uid()))
  with check (player_id = (select auth.uid()));

-- No insert/update/delete policies anywhere else: clients cannot write. Belt and braces: also strip
-- the table privileges Supabase grants by default so even a future permissive policy cannot open
-- writes by accident, and keep anon (no session) out entirely.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant select on public.players, public.mons, public.species_base_stats, public.xp_daily,
  public.battles, public.battle_notifications to authenticated;
grant update (seen_at) on public.battle_notifications to authenticated;
grant select on public.leaderboard_alltime, public.leaderboard_weekly, public.leaderboard_nations
  to authenticated;

-- --- functions (service role only) -----------------------------------------------------------------
-- All are security definer with a fixed search_path. Execute is revoked from anon/authenticated at
-- the end of this section; the Edge Functions call them through the service-role client.

-- Rolls a species inside a nation. Same weights and order as rollSpecies() in shared/game/species.ts
-- (common 75 / rare 25, common listed first), so a given roll picks the same species on both sides.
create or replace function public.roll_species(p_nation public.nation, p_roll double precision)
returns text
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_total int;
  v_r double precision;
  v_row record;
  v_last text;
begin
  select coalesce(sum(weight), 0) into v_total from public.species_base_stats where nation = p_nation;
  if v_total = 0 then
    raise exception 'no species for nation %', p_nation;
  end if;
  v_r := least(greatest(coalesce(p_roll, 0), 0), 0.999999) * v_total;
  for v_row in
    select species_id, weight from public.species_base_stats where nation = p_nation order by sort_order
  loop
    v_r := v_r - v_row.weight;
    v_last := v_row.species_id;
    if v_r < 0 then
      return v_row.species_id;
    end if;
  end loop;
  return v_last;
end;
$$;

-- Same math as shared/game/levels.ts: levelFromXp, stageForLevel, statAtLevel.
create or replace function public.level_from_xp(p_total_xp int)
returns int
language sql
immutable
as $$
  select case
    when p_total_xp is null or p_total_xp <= 0 then 1
    else least(50, greatest(1, floor((1 + sqrt(1 + p_total_xp::double precision / 12.5)) / 2)::int))
  end;
$$;

create or replace function public.stage_for_level(p_level int)
returns public.mon_stage
language sql
immutable
as $$
  select case
    when p_level < 2 then 'egg'::public.mon_stage
    when p_level < 10 then 'baby'::public.mon_stage
    when p_level < 25 then 'teen'::public.mon_stage
    else 'adult'::public.mon_stage
  end;
$$;

-- Re-derives level, stage, stats and the *_at milestones of a mon from its total_xp. Rolls the
-- species when the mon crosses HATCH_XP (100) and still has none; p_species_roll must then be a
-- uniform number in [0, 1) supplied by the caller (crypto random in the Edge Function).
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
    select * into v_base from public.species_base_stats where species_id = m.species_id;
    m.stats := jsonb_build_object(
      'hp',  (v_base.hp  * (v_level + 49)) / 50,
      'atk', (v_base.atk * (v_level + 49)) / 50,
      'def', (v_base.def * (v_level + 49)) / 50,
      'spd', (v_base.spd * (v_level + 49)) / 50
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

-- Applies one credited ingest batch. p_deltas:
--   { "minutes": [{ "minute": iso, "prompts": n, "stops": n, "tool_xp": n }, ...],
--     "work_xp": n, "bonus_xp": n, "streak_days": n | null, "last_active_day": "YYYY-MM-DD" | null }
-- Returns { mon, hatched, level_before, level_after, stage_before, stage_after }.
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
    update public.players set
      streak_days = (p_deltas ->> 'streak_days')::int,
      last_active_day = coalesce((p_deltas ->> 'last_active_day')::date, last_active_day),
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

-- Atomically claims a challenge slot: not an egg, 5 min cooldown, 10 challenges per UTC day.
-- Returns { ok: true, mon } or { ok: false, reason: 'no_mon' | 'egg' | 'cooldown' | 'daily_cap', cooldown_until? }.
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
  v_cooldown interval := interval '5 minutes';
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
  if coalesce(v_started, 0) >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'daily_cap');
  end if;

  update public.mons set last_battle_at = now(), updated_at = now() where id = m.id returning * into m;
  insert into public.xp_daily (player_id, day, battles_started) values (p_player, v_day, 1)
  on conflict (player_id, day) do update set battles_started = public.xp_daily.battles_started + 1;

  return jsonb_build_object('ok', true, 'mon', to_jsonb(m));
end;
$$;

-- Random opponent from another nation. p_window null = any level; p_exclude_recent skips players the
-- challenger already fought in the last 24 h. PostgREST cannot express order by random(), hence SQL.
create or replace function public.pick_opponent(
  p_player uuid,
  p_nation public.nation,
  p_level int,
  p_window int,
  p_exclude_recent boolean
)
returns table (
  mon_id uuid,
  player_id uuid,
  nickname text,
  nation public.nation,
  species_id text,
  stage public.mon_stage,
  level int
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select m.id, m.player_id, p.nickname::text, p.nation, m.species_id, m.stage, m.level
  from public.mons m
  join public.players p on p.id = m.player_id
  where p.nation <> p_nation
    and m.stage <> 'egg'
    and m.species_id is not null
    and p.last_seen_at > now() - interval '30 days'
    and p.suspicion < 10
    and m.player_id <> p_player
    and m.player_id is distinct from (select me.last_opponent_id from public.mons me where me.player_id = p_player)
    and (p_window is null or abs(m.level - p_level) <= p_window)
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

-- Records a finished battle and pays out. p:
--   { battle_id, challenger_id, opponent_id | null, challenger_snapshot, opponent_snapshot,
--     winner: 'a' | 'b', reason, log, challenger_xp, opponent_xp }
-- Returns { challenger: mons, opponent: mons | null, opponent_xp_paid }.
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
  v_day date := (now() at time zone 'utc')::date;
  v_ch_mon uuid;
  v_op_mon uuid;
  v_defended int;
  v_op_paid int := 0;
  v_ch_row public.mons;
  v_op_row public.mons;
begin
  select id into v_ch_mon from public.mons where player_id = v_ch for update;
  if v_ch_mon is null then
    raise exception 'challenger % has no mon', v_ch;
  end if;

  insert into public.battles (
    id, challenger_id, opponent_id, challenger_snapshot, opponent_snapshot,
    winner, reason, log, challenger_xp, opponent_xp
  ) values (
    v_battle, v_ch, v_op, p -> 'challenger_snapshot', p -> 'opponent_snapshot',
    p ->> 'winner', p ->> 'reason', coalesce(p -> 'log', '{}'::jsonb), v_ch_xp, 0
  );

  update public.mons set
    total_xp = total_xp + v_ch_xp,
    battle_xp = battle_xp + v_ch_xp,
    last_opponent_id = v_op
  where id = v_ch_mon;
  insert into public.xp_daily (player_id, day, battle_xp) values (v_ch, v_day, v_ch_xp)
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
    'opponent_xp_paid', v_op_paid
  );
end;
$$;

-- Deletes xp_minutes and ingest_batches older than 48 h. Returns the number of rows removed.
create or replace function public.prune_ephemeral()
returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_minutes int;
  v_batches int;
begin
  delete from public.xp_minutes where minute < now() - interval '48 hours';
  get diagnostics v_minutes = row_count;
  delete from public.ingest_batches where received_at < now() - interval '48 hours';
  get diagnostics v_batches = row_count;
  return v_minutes + v_batches;
end;
$$;

create or replace function public.touch_player(p_player uuid)
returns void
language sql
security definer
set search_path = public, extensions
as $$
  update public.players set last_seen_at = now() where id = p_player;
$$;

revoke execute on function public.roll_species(public.nation, double precision) from public, anon, authenticated;
revoke execute on function public.level_from_xp(int) from public, anon, authenticated;
revoke execute on function public.stage_for_level(int) from public, anon, authenticated;
revoke execute on function public.recompute_mon(uuid, double precision) from public, anon, authenticated;
revoke execute on function public.apply_xp(uuid, jsonb, double precision) from public, anon, authenticated;
revoke execute on function public.claim_battle_slot(uuid) from public, anon, authenticated;
revoke execute on function public.pick_opponent(uuid, public.nation, int, int, boolean) from public, anon, authenticated;
revoke execute on function public.settle_battle(jsonb) from public, anon, authenticated;
revoke execute on function public.prune_ephemeral() from public, anon, authenticated;
revoke execute on function public.touch_player(uuid) from public, anon, authenticated;

grant execute on function public.roll_species(public.nation, double precision) to service_role;
grant execute on function public.level_from_xp(int) to service_role;
grant execute on function public.stage_for_level(int) to service_role;
grant execute on function public.recompute_mon(uuid, double precision) to service_role;
grant execute on function public.apply_xp(uuid, jsonb, double precision) to service_role;
grant execute on function public.claim_battle_slot(uuid) to service_role;
grant execute on function public.pick_opponent(uuid, public.nation, int, int, boolean) to service_role;
grant execute on function public.settle_battle(jsonb) to service_role;
grant execute on function public.prune_ephemeral() to service_role;
grant execute on function public.touch_player(uuid) to service_role;
