-- Run only in an empty disposable PostgreSQL database:
-- psql -v ON_ERROR_STOP=1 -f supabase/tests/fair-matchmaking.sql
begin;
create schema extensions;
create type public.nation as enum ('water', 'fire', 'earth', 'air');
create type public.mon_stage as enum ('egg', 'baby', 'teen', 'adult');
create table public.players (id uuid primary key, nickname text, nation public.nation,
  last_seen_at timestamptz default now(), suspicion int default 0);
create table public.mons (id uuid, player_id uuid, species_id text, stage public.mon_stage,
  level int, loadout jsonb, last_opponent_id uuid);
create table public.battles (challenger_id uuid, opponent_id uuid, created_at timestamptz);
create table public.species_base_stats (species_id text primary key, hp int, atk int, def int, spd int);
insert into public.species_base_stats values ('bubblit',80,50,55,30),('sparkit',70,60,40,40),
  ('mossling',85,50,55,25),('puffle',65,50,40,55),('wispit',70,50,40,55);
\ir ../migrations/20260924120000_fair_matchmaking.sql
insert into public.players(id,nickname,nation) values
  ('00000000-0000-0000-0000-000000000001','me','water'),
  ('00000000-0000-0000-0000-000000000002','foe','fire');
insert into public.mons(id,player_id,species_id,stage,level) select id,id,'sparkit','teen',10 from public.players;
do $$
declare gap int; found_count int;
begin
  for gap in -5..5 loop
    update public.mons set level = 10 + gap where player_id = '00000000-0000-0000-0000-000000000002';
    select count(*) into found_count from public.pick_opponent(
      '00000000-0000-0000-0000-000000000001', 'water', null, null, false);
    if found_count <> (case when abs(gap) <= 3 then 1 else 0 end) then
      raise exception 'Unbounded legacy caller breached level guard at gap %', gap;
    end if;
  end loop;
  update public.mons set level = 10;
  select count(*) into found_count from public.pick_opponent(
    '00000000-0000-0000-0000-000000000001', 'water', 7, 9, false);
  if found_count <> 0 then raise exception 'Weaker window included a peer'; end if;
  if exists (select 1 from public.species_base_stats where hp+atk+def+spd not in (210,215)) then
    raise exception 'Stat budget changed';
  end if;
end $$;
rollback;
