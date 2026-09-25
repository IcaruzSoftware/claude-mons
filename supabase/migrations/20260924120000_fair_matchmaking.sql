-- Bound both sides, even when an older Edge Function supplies an unbounded window.
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
    and abs(m.level - (select me.level from public.mons me where me.player_id = p_player)) <= 3
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
-- Preserve each rarity's stat budget while balancing the smaller elemental swing.
update public.species_base_stats as s
set hp = v.hp, atk = v.atk, def = v.def, spd = v.spd
from (values
  ('bubblit', 76, 50, 53, 36),
  ('sparkit', 70, 60, 42, 38),
  ('mossling', 91, 46, 55, 23),
  ('puffle', 61, 52, 48, 49),
  ('wispit', 70, 48, 42, 55)
) as v(species_id, hp, atk, def, spd)
where s.species_id = v.species_id;
