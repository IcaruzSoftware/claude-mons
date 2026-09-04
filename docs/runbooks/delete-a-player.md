---
doc_type: runbook
purpose: "Read this when a player requests account deletion via PRIVACY.md."
audience: both
last_verified: 2026-09-05
last_verified_commit: d7db9c0
related_files:
  - supabase/migrations/20260904000000_init.sql
  - PRIVACY.md
---

# Delete a Player

Use this runbook to remove a player's account and all associated game data from Supabase. Cascade deletes handle most tables; `battles` keeps snapshots with null player IDs.

## 1. Identify the player by nickname

Connect to your Supabase project dashboard and open the SQL editor.

```sql
select id, nickname, nation, created_at, suspicion
from public.players
where nickname = '<nickname>'
limit 1;
```

Copy the player's UUID from the result. If no row is found, the player does not exist in the database.

## 2. Delete from the auth system

The most reliable deletion path uses the Supabase auth dashboard or the SQL editor. **Navigate to Authentication → Users** in the Supabase dashboard, search for the player's UUID, and **click Delete User**. Confirm the prompt.

Alternatively, use the SQL editor:

```sql
delete from auth.users where id = '<player_uuid>';
```

This cascades automatically to:
- `public.players` (by FK constraint `on delete cascade`)
- `public.mons` (by FK constraint `on delete cascade`)
- `public.xp_daily` (by FK constraint `on delete cascade`)
- `public.xp_minutes` (by FK constraint `on delete cascade`)
- `public.ingest_batches` (by FK constraint `on delete cascade`)
- `public.battle_notifications` (by FK constraint `on delete cascade`)

The `public.battles` table keeps all battle records unchanged; its `challenger_id` and `opponent_id` columns set to NULL where they referenced the deleted player (by `on delete set null` constraints).

## 3. (Test only) Reset leaderboards

To clear all player data during integration testing, truncate tables in dependency order:

```sql
truncate public.battle_notifications cascade;
truncate public.battles cascade;
truncate public.ingest_batches cascade;
truncate public.xp_minutes cascade;
truncate public.xp_daily cascade;
truncate public.mons cascade;
truncate public.players cascade;
```

## 4. Verify deletion

Run this query to confirm the player is gone:

```sql
select count(*) as remaining_players from public.players where id = '<player_uuid>';
```

The result must be `0`. Then check the leaderboard views:

```sql
select * from public.leaderboard_alltime where player_id = '<player_uuid>';
select * from public.leaderboard_weekly where player_id = '<player_uuid>';
```

Both must return zero rows.

## Acceptance

- [ ] Player no longer appears in `public.players` (query at step 4 returns 0)
- [ ] Leaderboard views exclude the deleted player (both queries return empty)
- [ ] Battle records remain (with null player IDs if they involved this player)
- [ ] No orphaned rows in `public.mons`, `public.xp_daily`, or other child tables
