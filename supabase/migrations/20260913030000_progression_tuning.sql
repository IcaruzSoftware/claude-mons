-- Phase A balance tuning (docs/design/progression.md Stances / Evolution multipliers, CLAUDE.md's
-- "Tune the Phase A balance numbers" task): retunes the evolution-stage stat multiplier that
-- 20260913020000_progression_phase_a.sql introduced. The original 1.00/1.15/1.30 made a
-- stage-boundary matchup (level 9 vs. 11, level 24 vs. 26) win only ~27-28% for the low-level side,
-- well outside the 35-65% band docs/design/battle.md's balance harness targets elsewhere.
-- Simulation (packages/shared/test/balance.test.ts, and the sweep script referenced in the Phase A
-- implementation report) found 1.00/1.03/1.06 lands both boundary matchups at 38-48% instead.
--
-- Only recompute_mon needs a new function body here: the stance counter/grant/cost constants
-- (STANCE_INFO, STANCE_COUNTER_DEALT_MULT/TAKEN_MULT in packages/shared/src/game/progression.ts)
-- are pure application-layer values used only inside simulateBattle (packages/shared/src/battle/
-- battle.ts), which runs in the battle-request Edge Function's bundled shared code, not in
-- Postgres -- there is no SQL mirror of the stance math to update.

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
    -- Retuned 2026-09-13: was 1.15 / 1.30 (20260913020000_progression_phase_a.sql). Mirrors
    -- packages/shared/src/game/levels.ts:STAGE_STAT_MULTIPLIER exactly.
    v_stage_mult := case v_stage
      when 'teen' then 1.03
      when 'adult' then 1.06
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

-- Same security posture as before: security definer, execute revoked from anon/authenticated,
-- granted only to service_role. Re-asserted here since this migration replaces the function body.
revoke execute on function public.recompute_mon(uuid, double precision) from public, anon, authenticated;
grant execute on function public.recompute_mon(uuid, double precision) to service_role;
