-- Keep authoritative SQL stats aligned with the measured rarity budgets in species.ts.
-- No hatch odds, XP, species ids or historical battle snapshots change.
update public.species_base_stats as s
set hp = v.hp, atk = v.atk, def = v.def, spd = v.spd
from (values
  ('dripple', 88, 45, 50, 30),
  ('bubblit', 78, 50, 53, 36),
  ('ottlet', 79, 61, 42, 40),
  ('sparkit', 71, 60, 42, 38),
  ('cinderpup', 77, 60, 40, 40),
  ('mossling', 93, 47, 55, 23),
  ('wispit', 76, 49, 43, 55)
) as v(species_id, hp, atk, def, spd)
where s.species_id = v.species_id;

-- Refresh current stats without re-hatching or touching earned XP and saved moves.
select public.recompute_mon(id) from public.mons
where species_id in ('dripple', 'bubblit', 'ottlet', 'sparkit', 'cinderpup', 'mossling', 'wispit');
