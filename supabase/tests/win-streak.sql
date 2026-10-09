-- Run only in an empty disposable PostgreSQL database:
-- psql -v ON_ERROR_STOP=1 -f supabase/tests/win-streak.sql
-- settle_battle counts only wins against real players (rivals) in mons.win_streak: NPC battles
-- (opponent_id null) neither raise nor reset it and are paid without the streak multiplier.
begin;
create schema if not exists extensions;
do $$ begin
  create role anon; create role authenticated; create role service_role;
exception when duplicate_object then null; end $$;
create table public.players (id uuid primary key);
create table public.mons (id uuid primary key, player_id uuid unique, total_xp int not null default 0,
  battle_xp int not null default 0, last_opponent_id uuid, win_streak int not null default 0);
create table public.xp_daily (player_id uuid, day date, battle_xp int not null default 0,
  battles_defended int not null default 0, primary key (player_id, day));
create table public.battles (id uuid primary key, challenger_id uuid, opponent_id uuid,
  challenger_snapshot jsonb, opponent_snapshot jsonb, winner text, reason text, log jsonb,
  challenger_xp int, opponent_xp int, protocol_version int);
create table public.battle_notifications (player_id uuid, battle_id uuid);
create function public.recompute_mon(p_mon uuid, p_roll double precision default null)
  returns public.mons language sql as $f$ select * from public.mons where id = p_mon $f$;
\ir ../migrations/20261009010000_win_streak_rivals_only.sql
insert into public.players (id) values
  ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
insert into public.mons (id, player_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000002');
do $$
declare
  me uuid := '00000000-0000-0000-0000-000000000001';
  rival uuid := '00000000-0000-0000-0000-000000000002';
  r jsonb;
  -- one settle_battle call: opponent (null = NPC), winner, pre-streak challenger XP
  fight constant text := 'select public.settle_battle(jsonb_build_object(''battle_id'', gen_random_uuid(),
    ''challenger_id'', $1, ''opponent_id'', $2, ''winner'', $3, ''reason'', ''ko'',
    ''challenger_xp'', 100, ''opponent_xp'', 3))';
begin
  -- two rival wins: streak 2, the second paid at x1.2
  execute fight using me, rival, 'a' into r;
  execute fight using me, rival, 'a' into r;
  if (r ->> 'challenger_xp_paid')::int <> 120 then raise exception 'rival win multiplier: %', r; end if;

  -- an NPC win keeps the streak and pays no multiplier
  execute fight using me, null::uuid, 'a' into r;
  if (r ->> 'challenger_xp_paid')::int <> 100 then raise exception 'NPC win got a multiplier: %', r; end if;
  if (select win_streak from public.mons where player_id = me) <> 2 then
    raise exception 'NPC win changed the streak';
  end if;

  -- an NPC loss keeps the streak too
  execute fight using me, null::uuid, 'b' into r;
  if (select win_streak from public.mons where player_id = me) <> 2 then
    raise exception 'NPC loss reset the streak';
  end if;

  -- the next rival win continues the streak (3, x1.3); a rival loss resets it
  execute fight using me, rival, 'a' into r;
  if (r ->> 'challenger_xp_paid')::int <> 130 then raise exception 'streak did not continue: %', r; end if;
  execute fight using me, rival, 'b' into r;
  if (select win_streak from public.mons where player_id = me) <> 0 then
    raise exception 'rival loss did not reset the streak';
  end if;
end $$;
rollback;
