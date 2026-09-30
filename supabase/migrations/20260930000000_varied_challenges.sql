-- Permit rare +4/+5 trainer challenges while keeping the server-side cap for old clients.
-- A one-hour repeat window gives sparse player pools another real match without back-to-back fights.
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
    and abs(m.level - (select me.level from public.mons me where me.player_id = p_player)) <= 5
    and (p_min_level is null or m.level >= p_min_level)
    and (p_max_level is null or m.level <= p_max_level)
    and (
      not p_exclude_recent
      or not exists (
        select 1 from public.battles b
        where b.challenger_id = p_player
          and b.opponent_id = m.player_id
          and b.created_at > now() - interval '1 hour'
      )
    )
  order by random()
  limit 1;
$$;
