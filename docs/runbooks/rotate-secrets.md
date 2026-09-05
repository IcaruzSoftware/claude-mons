---
doc_type: runbook
purpose: "Read this when rotating API tokens, database passwords, or code signing credentials that workflows and local development depend on."
audience: both
last_verified: 2026-09-05
last_verified_commit: ab12392
related_files:
  - .github/workflows/release.yml
  - .github/workflows/supabase-deploy.yml
  - .github/workflows/keepalive.yml
  - docs/CODE_SIGNING_POLICY.md
  - docs/runbooks/apt-repository.md
  - supabase/README.md
---

# Rotate secrets

Rotate credentials when a signing service, hosting provider, or developer access is updated. Each secret is checked into GitHub (as a repository secret) and locally (as `.env.local`); some workflows also re-run `supabase link` to re-authenticate the CLI.

Use this when you need to refresh a signing token before it expires, rotate passwords after a database reset or policy change, or add a missing secret to unblock a workflow.

## SIGNPATH_API_TOKEN

Code signing for Windows builds (see [`docs/CODE_SIGNING_POLICY.md`](../CODE_SIGNING_POLICY.md)).

1. **Sign in** to the SignPath dashboard at https://signpath.org/. Navigate to **Users** > the **CI** user account > **API Tokens**.
2. **Create a new token** with submitter rights and copy it.
3. **Update the repository secret**:

```bash
gh secret set SIGNPATH_API_TOKEN
```

Paste the token when prompted; it will not echo to the terminal.

## SIGNPATH_ORGANIZATION_ID

Organization ID for the SignPath account (rarely changes).

1. **Open** the SignPath dashboard and navigate to your organization settings page.
2. **Copy** the organization ID.
3. **Update the repository secret**:

```bash
gh secret set SIGNPATH_ORGANIZATION_ID
```

## SUPABASE_ACCESS_TOKEN

Personal access token for the Supabase CLI during deployment.

1. **Sign in** to the Supabase dashboard at https://app.supabase.com/. Navigate to **Account** > **Access Tokens**.
2. **Create a new token** and copy it.
3. **Update locally** in `.env.local`:

```bash
export SUPABASE_ACCESS_TOKEN=<token>
```

4. **Update the repository secret**:

```bash
gh secret set SUPABASE_ACCESS_TOKEN
```

## SUPABASE_DB_PASSWORD

Database password for migrations and function deployments.

1. **Sign in** to the Supabase dashboard. Navigate to **Project Settings** > **Database** > **Database Password**.
2. **Click Reset** and copy the new password.
3. **Update locally** in `.env.local`:

```bash
export SUPABASE_DB_PASSWORD=<password>
```

4. **Re-authenticate the CLI**:

```bash
set -a; . ./.env.local; set +a
supabase link --project-ref dbeotjfprckdrymmpexv
```

5. **Update the repository secret**:

```bash
gh secret set SUPABASE_DB_PASSWORD
```

## SUPABASE_ANON_KEY

Optional keepalive secret; not required for core operations.

The anon key is embedded in [`apps/desktop/src/main/net/config.ts`](../../apps/desktop/src/main/net/config.ts) and is public by design. If configured as a repository secret, it is passed to the `.github/workflows/keepalive.yml` heartbeat call; otherwise the function runs without authentication (it has `verify_jwt = false`).

To add it:

1. **Sign in** to the Supabase dashboard and navigate to **Project Settings** > **API** > **Project API keys**. Copy the **anon** key.
2. **Update the repository secret** (optional):

```bash
gh secret set SUPABASE_ANON_KEY
```

## APT_GPG_PRIVATE_KEY / APT_GPG_PASSPHRASE

Sign the APT repository published to `gh-pages` (see [`docs/runbooks/apt-repository.md`](../runbooks/apt-repository.md)).

1. **Generate** a new key and export it, following the "Key rotation" steps in [`docs/runbooks/apt-repository.md`](../runbooks/apt-repository.md#key-rotation).
2. **Update the repository secrets**:

```bash
gh secret set APT_GPG_PRIVATE_KEY < claude-mons-apt-private.asc
gh secret set APT_GPG_PASSPHRASE
```

Paste the passphrase when prompted; it will not echo to the terminal. Delete the local `.asc` file
once both secrets are set.

3. Note the rotation in `CHANGELOG.md`: existing installs cache the old public key locally and must
   re-run `install.sh` after the next tagged release or their `apt update` will fail signature
   verification.

## Acceptance

- All secret names match those used in `.github/workflows/*.yml`.
- `.env.local` contains non-empty values for `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, and `SUPABASE_PROJECT_REF`.
- Trigger `.github/workflows/supabase-deploy.yml` to verify `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` work.
- Trigger `.github/workflows/release.yml` via `workflow_dispatch` to verify `SIGNPATH_API_TOKEN` and `SIGNPATH_ORGANIZATION_ID` work.
- After the next tagged release, confirm the `publish apt repository` job signed successfully (no `::notice::` skip in its log) to verify `APT_GPG_PRIVATE_KEY` and `APT_GPG_PASSPHRASE` work; `workflow_dispatch` with `apt_dry_run: true` only checks the unsigned tree, not the secrets.
