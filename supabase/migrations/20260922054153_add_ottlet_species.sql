-- Adds the third Water species, Ottlet (rare fast attacker), to species_base_stats.
-- sort_order must follow the SPECIES insertion order in packages/shared/src/game/species.ts
-- (Ottlet sits after Bubblit) so roll_species and rollSpecies pick the same species for a roll.
insert into public.species_base_stats
  (species_id, nation, rarity, weight, hp, atk, def, spd, sort_order)
values
  ('ottlet', 'water', 'rare', 25, 75, 60, 40, 40, 9);
