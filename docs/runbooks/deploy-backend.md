---
doc_type: runbook
purpose: "Read this when deploying backend changes to Supabase."
audience: both
last_verified: 2026-09-13
last_verified_commit: 8a24ac9
related_files:
  - supabase/README.md
  - supabase/config.toml
  - supabase/migrations/20260904000000_init.sql
  - supabase/functions/heartbeat/index.ts
  - supabase/functions/create-profile/index.ts
  - supabase/functions/ingest-xp/index.ts
  - supabase/functions/battle-request/index.ts
  - supabase/functions/set-loadout/index.ts
  - .github/workflows/supabase-deploy.yml
  - scripts/sync-shared.mjs
  - scripts/supabase-auth-config.mjs
  - docs/runbooks/auth-email-config.md
---

# Deploy backend to Supabase

Deploy database migrations and Edge Functions to the live Supabase project. Auth config changes go
through `docs/runbooks/auth-email-config.md` instead — see the warning under step 3 for why
`supabase config push` is never part of this flow. Requires `SUPABASE_ACCESS_TOKEN`,
`SUPABASE_DB_PASSWORD`, and `SUPABASE_PROJECT_REF` in `.env.local`.

## Steps

1. Source credentials into your shell:

```bash
set -a; . ./.env.local; set +a
```

2. Link the Supabase CLI to the project:

```bash
npx supabase link --project-ref "$SUPABASE_PROJECT_REF"
```

3. Push database migrations from `supabase/migrations/` (currently 7 files; see
   [`supabase/README.md`](../../supabase/README.md) for the full list):

```bash
npx supabase db push --yes
```

> **Never run `npx supabase config push`.** This project's account-linking auth settings
> (`site_url`, `external_email_enabled`, `security_manual_linking_enabled`, `mailer_autoconfirm`)
> are managed out-of-band by `scripts/supabase-auth-config.mjs`
> (`docs/runbooks/auth-email-config.md`) because they either aren't in `[auth]` in
> `supabase/config.toml` at all (the mailer/manual-linking keys) or the repo's checked-in value is a
> local-dev default (`site_url = "http://127.0.0.1:3000"`) that the live project deliberately
> overrides. `config push` does not know that and silently resets all four to
> `supabase/config.toml`'s values on every push — it has actually happened running this exact
> command. `enable_anonymous_sign_ins` (the one setting in `[auth]` this project does want pushed)
> was already applied once when the project was bootstrapped; it does not need pushing again. If a
> future change to `supabase/config.toml` genuinely needs to reach the hosted project, apply it by
> hand in the Supabase dashboard instead of running `config push`, then immediately run
> `node scripts/supabase-auth-config.mjs` (dry run, `--apply` if it reports a diff) to confirm the
> four out-of-band keys are still correct. `.github/workflows/supabase-deploy.yml` deliberately
> never calls `config push` either — only `db push` and `functions deploy`.

4. Refresh the Edge Functions' shared game code:

```bash
pnpm sync:shared
```

This copies `packages/shared/src/` to `supabase/functions/_shared/game/` (gitignored).

5. Deploy all Edge Functions with per-function `verify_jwt` settings honored:

```bash
npx supabase functions deploy
```

The `heartbeat` function deploys with `verify_jwt = false`; the other four (`create-profile`, `ingest-xp`, `battle-request`, `set-loadout`) require a valid JWT.

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

If `npx supabase db push` fails with a password authentication error, apply the pending migration
manually. As of this writing the `SUPABASE_DB_PASSWORD` in `.env.local` does not authenticate
(tracked as a "Now" blocker in `docs/ROADMAP.md`); this fallback is the current workaround, not a
historical footnote. Once the password is corrected, standard `db push` works again and this section
can be skipped.

**Do not attempt this unless `db push` has failed.** Recovery requires the `SUPABASE_ACCESS_TOKEN`:

```bash
set -a; . ./.env.local; set +a
curl -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"<SQL from the pending file(s) in supabase/migrations/ that have not been applied yet>"}'
```

Check which migrations are pending against `supabase_migrations.schema_migrations` (query it via the
same Management API endpoint, or in the dashboard's SQL editor) before picking the SQL to paste —
apply migrations in filename order (`supabase/migrations/` is currently 7 files; see
[`supabase/README.md`](../../supabase/README.md) for the list and what each one changed). Then insert
the migration version into `supabase_migrations.schema_migrations` so `db push` knows it has run.

## Alternative: GitHub workflow

Push a commit and manually run `.github/workflows/supabase-deploy.yml` from the **Actions** tab, with
the `migrations` and/or `functions` `workflow_dispatch` inputs (both default `true`). This requires
`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, and `SUPABASE_PROJECT_REF` as repository secrets.
The workflow runs `supabase db push` and `supabase functions deploy` only — it never runs
`supabase config push`, consistent with the warning above.

## Acceptance

- [ ] `npx supabase db push --yes` (or the Management API fallback) applied cleanly with no errors
- [ ] `pnpm sync:shared` ran before `functions deploy` so `supabase/functions/_shared/game/` is current
- [ ] `npx supabase functions deploy` completed for all 5 functions with no errors
- [ ] `supabase config push` was **not** run; if `supabase/config.toml` needed a genuine change, it was applied by hand in the dashboard and `node scripts/supabase-auth-config.mjs` confirmed no diff afterward
- [ ] The heartbeat curl in Verification returns `{ "ok": true, ... }`
- [ ] No errors in the Supabase dashboard's **Functions** → **Logs** tab
