-- Adds all-time nation battle tallies (battles_won, battles_lost) alongside the existing weekly
-- ones. The weekly CTE and every previously exposed column are left untouched (create or replace
-- view only permits appending columns); a new fights_all CTE applies the same orphan-battle and
-- defender-side rules as the weekly fights CTE but without the week filter, and its two columns are
-- appended after rank.
create or replace view public.leaderboard_nations as
WITH week AS (
         SELECT date_trunc('week'::text, (now() AT TIME ZONE 'utc'::text)) AS start
        ), nations AS (
         SELECT unnest(enum_range(NULL::nation)) AS nation
        ), members AS (
         SELECT p.nation,
            (count(*))::integer AS members,
            (count(*) FILTER (WHERE (m.stage <> 'egg'::mon_stage)))::integer AS hatched_members,
            COALESCE(sum(m.total_xp), (0)::bigint) AS total_xp,
            round(avg(m.level) FILTER (WHERE (m.stage <> 'egg'::mon_stage)), 2) AS avg_level
           FROM (players p
             JOIN mons m ON ((m.player_id = p.id)))
          WHERE (p.suspicion < 10)
          GROUP BY p.nation
        ), weekly AS (
         SELECT p.nation,
            sum(((d.work_xp + d.bonus_xp) + d.battle_xp)) AS weekly_xp
           FROM ((xp_daily d
             JOIN players p ON ((p.id = d.player_id)))
             CROSS JOIN week)
          WHERE ((d.day >= (week.start)::date) AND (p.suspicion < 10))
          GROUP BY p.nation
        ), fights AS (
         SELECT n_1.nation,
            (count(*) FILTER (WHERE (((b.winner = 'a'::text) AND (b.challenger_id IS NOT NULL) AND ((b.challenger_snapshot ->> 'nation'::text) = (n_1.nation)::text)) OR ((b.winner = 'b'::text) AND (b.opponent_id IS NOT NULL) AND ((b.opponent_snapshot ->> 'nation'::text) = (n_1.nation)::text)))))::integer AS weekly_battles_won,
            (count(*) FILTER (WHERE (((b.winner = 'b'::text) AND (b.challenger_id IS NOT NULL) AND ((b.challenger_snapshot ->> 'nation'::text) = (n_1.nation)::text)) OR ((b.winner = 'a'::text) AND (b.opponent_id IS NOT NULL) AND ((b.opponent_snapshot ->> 'nation'::text) = (n_1.nation)::text)))))::integer AS weekly_battles_lost
           FROM ((nations n_1
             CROSS JOIN week)
             LEFT JOIN battles b ON ((b.created_at >= week.start)))
          GROUP BY n_1.nation
        ), fights_all AS (
         SELECT n_1.nation,
            (count(*) FILTER (WHERE (((b.winner = 'a'::text) AND (b.challenger_id IS NOT NULL) AND ((b.challenger_snapshot ->> 'nation'::text) = (n_1.nation)::text)) OR ((b.winner = 'b'::text) AND (b.opponent_id IS NOT NULL) AND ((b.opponent_snapshot ->> 'nation'::text) = (n_1.nation)::text)))))::integer AS battles_won,
            (count(*) FILTER (WHERE (((b.winner = 'b'::text) AND (b.challenger_id IS NOT NULL) AND ((b.challenger_snapshot ->> 'nation'::text) = (n_1.nation)::text)) OR ((b.winner = 'a'::text) AND (b.opponent_id IS NOT NULL) AND ((b.opponent_snapshot ->> 'nation'::text) = (n_1.nation)::text)))))::integer AS battles_lost
           FROM (nations n_1
             LEFT JOIN battles b ON (true))
          GROUP BY n_1.nation
        )
 SELECT n.nation,
    COALESCE(mem.members, 0) AS members,
    COALESCE(mem.hatched_members, 0) AS hatched_members,
    COALESCE(mem.total_xp, (0)::bigint) AS total_xp,
    COALESCE(w.weekly_xp, (0)::bigint) AS weekly_xp,
    mem.avg_level,
    COALESCE(f.weekly_battles_won, 0) AS weekly_battles_won,
    COALESCE(f.weekly_battles_lost, 0) AS weekly_battles_lost,
    rank() OVER (ORDER BY COALESCE(w.weekly_xp, (0)::bigint) DESC, COALESCE(mem.total_xp, (0)::bigint) DESC, n.nation) AS rank,
    COALESCE(fa.battles_won, 0) AS battles_won,
    COALESCE(fa.battles_lost, 0) AS battles_lost
   FROM ((((nations n
     LEFT JOIN members mem ON ((mem.nation = n.nation)))
     LEFT JOIN weekly w ON ((w.nation = n.nation)))
     LEFT JOIN fights f ON ((f.nation = n.nation)))
     LEFT JOIN fights_all fa ON ((fa.nation = n.nation)));

grant select on public.leaderboard_nations to authenticated;
