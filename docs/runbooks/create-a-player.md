---
doc_type: runbook
purpose: "Read this when you need to create a server-side player for a given email so they can adopt it by signing in, optionally with a pre-destined egg."
audience: both
last_verified: 2026-09-22
last_verified_commit: 6d5bbcd
related_files:
  - scripts/create-a-player.mjs
  - scripts/create-a-player.test.mjs
  - docs/runbooks/delete-a-player.md
  - docs/runbooks/auth-email-config.md
  - docs/architecture/flows/account-linking.md
  - supabase/migrations/20260904000000_init.sql
---

# Create a Player

Provision a complete player (auth user + `players` row + `mons` row) for an email address, so that
signing in with that email in the app adopts it. This is the inverse of
[`docs/runbooks/delete-a-player.md`](delete-a-player.md) and the server-side counterpart of the
sign-in flow in [`docs/architecture/flows/account-linking.md`](../architecture/flows/account-linking.md).

`scripts/create-a-player.mjs` does the work: it reveals the service-role key at runtime, creates the
auth user email-confirmed via the Auth Admin API, then inserts the game rows through the Management
API SQL query endpoint (the same endpoint the deploy runbook's fallback uses,
[`docs/runbooks/deploy-backend.md`](deploy-backend.md)). It is zero-dependency and **dry-run by
default**: without `--apply` it prints the plan and the exact SQL, and creates nothing. It never
prints the access token or the service-role key.

Requires `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` in `.env.local` (gitignored).

## Steps

1. Source credentials into your shell (same idiom as
   [`docs/runbooks/auth-email-config.md`](auth-email-config.md)):

```bash
set -a; . ./.env.local; set +a
```

2. Dry run first — prints the plan and the SQL, changes nothing:

```bash
node scripts/create-a-player.mjs --email <addr> --nation <water|fire|earth|air>
```

Add `--nickname <name>` to set the leaderboard name (3-16 of `[A-Za-z0-9_]`); omit it to have one
generated the same way `create-profile` does. Add `--species <species_id>` to pre-destine the egg
(see below). Read the printed plan and confirm the nickname, nation and species are what you want.

3. Apply — creates the auth user, then inserts the player and mon:

```bash
node scripts/create-a-player.mjs --email <addr> --nation water --species bubblit --apply
```

On success it prints the resulting `id`, `nickname`, `nation`, `species_id` and `stage`. If the auth
user already exists for that email, the script reuses its id and reports so; the two inserts are
idempotent (`on conflict do nothing`), so re-running never duplicates or overwrites a player.

4. Verify at any time — selects the player and mon by email:

```bash
node scripts/create-a-player.mjs --email <addr> --verify
```

## Why the user is created email-confirmed

The project runs with `mailer_autoconfirm = false`
([`docs/runbooks/auth-email-config.md`](auth-email-config.md)). An auth user whose email is not
confirmed cannot complete `signInWithOtp`, so the script sends `email_confirm: true` when it creates
the user. Without it the row would exist but nobody could ever sign in to adopt it.

## Why `--species` makes a pre-destined egg

Leaving `--species` off inserts a mon with `species_id = null`: an ordinary egg that rolls a random
species of its nation the first time it crosses the hatch threshold. Passing `--species` inserts the
egg with that `species_id` already set. The `recompute_mon` function
(`supabase/migrations/20260904000000_init.sql`) only rolls a species when `species_id is null`, so a
pre-set egg hatches into exactly that species instead of a random one — it stays an egg (stage
`egg`, level 1, 0 XP) until it earns XP like any other. The `mons_species_or_egg` constraint permits
this because it only requires a species once the mon is past the egg stage (`species_id is not null
or stage = 'egg'`), and a pre-destined egg satisfies both halves.

The species must exist in `public.species_base_stats`; the script validates `--species` with a
`SELECT` against that table and fails with an "unknown species" error if it is absent (which also
proves the species' migration is deployed). Use an id from
[`docs/design/species-and-nations.md`](../design/species-and-nations.md). The `SELECT` also returns
the species' nation, and the script fails with exit 1 ("species 'X' belongs to nation 'water', not
'fire'") if it does not match `--nation`, so the mon is always reachable in the chosen nation.

## The player cannot sign in until custom SMTP delivers codes

Creating the player is only half the story: adopting it on a device needs a typed 6-digit sign-in
code, and the sign-in path has no confirmation-link fallback. On the free-tier default mailer those
codes are never delivered, so the player stays unreachable until custom SMTP is configured. Set that
up first via [`docs/runbooks/auth-email-config.md`](auth-email-config.md), then have the recipient
use **"Already have a mon? Sign in"** in onboarding, as described in
[`docs/architecture/flows/account-linking.md`](../architecture/flows/account-linking.md).

## Acceptance

- [ ] `node scripts/create-a-player.mjs --email <addr> --nation water` (no `--apply`) prints the plan
      and the two SQL inserts, and creates nothing.
- [ ] A bad `--species` fails with a clear "unknown species" message and exit code 1.
- [ ] With `--apply`, `--verify` afterwards returns the new player with the expected `nickname`,
      `nation` and `species_id` (null for a plain egg, the given id for a pre-destined one).
- [ ] Re-running the same `--apply` command is a no-op (the auth user is reused, the inserts conflict
      out) and does not duplicate or change the player.
- [ ] Neither the access token nor the service-role key ever appears in the script's output.
