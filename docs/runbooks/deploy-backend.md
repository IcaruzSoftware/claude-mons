---
doc_type: runbook
purpose: "Read this when deploying backend changes to Supabase."
audience: both
last_verified: 2026-09-05
last_verified_commit: d7db9c0
related_files:
  - supabase/README.md
  - supabase/config.toml
  - supabase/migrations/20260904000000_init.sql
  - supabase/functions/heartbeat/index.ts
  - supabase/functions/create-profile/index.ts
  - supabase/functions/ingest-xp/index.ts
  - supabase/functions/battle-request/index.ts
  - .github/workflows/supabase-deploy.yml
  - scripts/sync-shared.mjs
---

# Deploy backend to Supabase

Deploy database migrations, config changes, and Edge Functions to the live Supabase project.
Requires `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, and `SUPABASE_PROJECT_REF` in `.env.local`.

## Steps

1. Source credentials into your shell:

```bash
set -a; . ./.env.local; set +a
```

2. Link the Supabase CLI to the project:

```bash
npx supabase link --project-ref "$SUPABASE_PROJECT_REF"
```

3. Push database migrations from `supabase/migrations/`:

```bash
npx supabase db push --yes
```

4. Push config changes (enables anonymous sign-ins from `supabase/config.toml`):

```bash
npx supabase config push --yes
```

5. Refresh the Edge Functions' shared game code:

```bash
pnpm sync:shared
```

This copies `packages/shared/src/` to `supabase/functions/_shared/game/` (gitignored).

6. Deploy all Edge Functions with per-function `verify_jwt` settings honored:

```bash
npx supabase functions deploy
```

The `heartbeat` function deploys with `verify_jwt = false`; the other three (`create-profile`, `ingest-xp`, `battle-request`) require a valid JWT.

## Verification

1. Curl the heartbeat function to verify it is live:

```bash
curl "https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/heartbeat"
```

Expect `{ "ok": true, "pruned": 0, "players": 1, "ts": 1234567890 }` (or similar).

2. **Open the [Supabase dashboard](https://supabase.com/dashboard)** and confirm:
   - The `players`, `mons`, `xp_daily`, `battles` tables are populated or empty as expected.
   - No errors appear in the **Functions** → **Logs** tab.

## Fallback: Manual migration via Management API

If `npx supabase db push` fails with a password authentication error, apply the migration manually.

> Unverified: This path is documented in `docs/history/v1-handoff-2026-09-04.md` as the recovery method used when the database password did not authenticate. Once the password is corrected in `.env.local`, standard `db push` will work.

**Do not attempt this unless `db push` has failed.** Recovery requires the `SUPABASE_ACCESS_TOKEN`:

```bash
set -a; . ./.env.local; set +a
curl -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"<SQL from supabase/migrations/20260904000000_init.sql>"}'
```

Then insert the migration version into `supabase_migrations.schema_migrations` so `db push` knows it has run.

## Alternative: GitHub workflow

Push a commit and manually run `.github/workflows/supabase-deploy.yml` from the **Actions** tab. This requires `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, and `SUPABASE_PROJECT_REF` as repository secrets.
