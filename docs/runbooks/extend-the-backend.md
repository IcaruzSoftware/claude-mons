---
doc_type: runbook
purpose: "Read this when adding an Edge Function or database migration to the Supabase backend."
audience: both
last_verified: 2026-09-05
last_verified_commit: d7db9c0
related_files:
  - supabase/README.md
  - supabase/config.toml
  - supabase/functions/create-profile/index.ts
  - supabase/functions/_shared/http.ts
  - supabase/functions/_shared/auth.ts
  - supabase/functions/_shared/db.ts
  - supabase/migrations/20260904000000_init.sql
  - packages/shared/src/api.ts
  - scripts/sync-shared.mjs
---

# Extend the Supabase backend

**When to use:** You are adding a new Edge Function to handle a client request, or a database migration to change the schema.

## Part A: Add an Edge Function

1. **Define the wire types.** Add request and response interfaces to `packages/shared/src/api.ts`. Keep request fields snake_case (for database column alignment), responses camelCase.

2. **Create the function file.** Copy the structure from `supabase/functions/create-profile/index.ts`:

```typescript
import { serve, readJson, error, json } from '../_shared/http.ts';
import { requireUser } from '../_shared/auth.ts';
import { serviceClient } from '../_shared/db.ts';

serve(async (req) => {
  if (req.method !== 'POST') return error('BAD_REQUEST', 'POST only', 405);
  const { uid } = await requireUser(req);
  const body = await readJson<YourRequest>(req, 65536); // set size limit (bytes)
  const db = serviceClient();

  // Authenticate, validate, write via RPCs or direct queries.
  // Return json(response, 200) or error(code, message, status).
});
```

3. **Import shared code.** After running `pnpm sync:shared`, import from `../` shared modules:

```typescript
import { isNation } from '../_shared/game/types.ts';
```

4. **Register in config.** Add a `[functions.<name>]` block to `supabase/config.toml`:

```toml
[functions.your-endpoint]
enabled = true
verify_jwt = true
entrypoint = "./functions/your-endpoint/index.ts"
```

Set `verify_jwt = false` only for public endpoints (e.g., heartbeat).

5. **Test locally.** Write a Deno test file next to `supabase/functions/_shared/pipeline.test.ts`. Run:

```bash
pnpm sync:shared
deno test --allow-read supabase/functions/<your-file>.test.ts
```

6. **Type-check and deploy.** Verify Deno compatibility:

```bash
pnpm deno:check
```

Then deploy (see `docs/runbooks/deploy-backend.md`).

## Part B: Add a database migration

1. **Create the migration file.** In `supabase/migrations/`, use the naming pattern `<YYYYMMDDHHMMSS>_<name>.sql`.

2. **Keep SQL formulas in sync.** If your migration adds or changes level/stage/stat logic, mirror the changes from `packages/shared/src/game/levels.ts` and `packages/shared/src/game/species.ts` in the SQL functions `level_from_xp`, `stage_for_level`, `stat_at_level`, and `roll_species` in `supabase/migrations/20260904000000_init.sql`.

3. **Apply RLS and grant rules.** Follow the trust model: clients may only read specified tables and update one column (`battle_notifications.seen_at`). All writes go through service-role RPCs:

```sql
create policy <name> on public.<table>
  for select to authenticated using (player_id = (select auth.uid()));

create or replace function public.<rpc_name>(p_player uuid, ...)
  returns <type>
  language plpgsql
  security definer
  set search_path = public, extensions
  as $$
  begin
    -- Perform the write with service-role access.
  end;
  $$;

grant execute on function public.<rpc_name>(uuid, ...) to service_role;
revoke execute on function public.<rpc_name>(uuid, ...) from anon, authenticated;
```

4. **Test locally (if Docker available).** Run:

```bash
npx supabase start
npx supabase db reset
# Your migration will be applied. Verify in Studio or via SQL.
npx supabase stop
```

5. **Deploy.** Follow `docs/runbooks/deploy-backend.md` to push the migration.

## Acceptance

- Edge Function: `pnpm deno:check` passes; the function runs locally with `npx supabase functions serve`; types in `packages/shared/src/api.ts` exist.
- Migration: `npx supabase db reset` applies cleanly; RLS policies and RPCs are in place; any level/stage/stat changes match the shared code.
