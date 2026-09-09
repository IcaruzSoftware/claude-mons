---
doc_type: runbook
purpose: "Read this when you need to change the Supabase auth email config (templates, site_url, manual linking) for account linking, or when a player reports never receiving a sign-in code."
audience: both
last_verified: 2026-09-09
last_verified_commit: b0a0308
related_files:
  - scripts/supabase-auth-config.mjs
  - apps/desktop/src/main/net/SupabaseClient.ts
  - docs/decisions/0016-email-otp-account-linking.md
  - docs/architecture/flows/account-linking.md
  - supabase/README.md
---

# Auth email config for account linking

Configures the Supabase project's auth config settings so email OTP account linking
(`docs/decisions/0016-email-otp-account-linking.md`) actually delivers a typed 6-digit code.
Requires `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` in `.env.local`.

## What it changes

`scripts/supabase-auth-config.mjs` is repeatable: it `GET`s the current config, diffs it against the
values below, prints only the keys that will change, and (with `--apply`) `PATCH`es only those keys.

| Key | Value | Why |
|---|---|---|
| `site_url` | `https://github.com/IcaruzSoftware/claude-mons` | Required non-empty; the link target is irrelevant since this app only ever types the code |
| `external_email_enabled` | `true` | Required for `updateUser`/`signInWithOtp` email flows at all |
| `security_manual_linking_enabled` | `true` | Required for `updateUser({ email })` to succeed on an anonymous user — without it the call is rejected outright ([Supabase docs](https://supabase.com/docs/guides/auth/auth-identity-linking#manual-linking-beta)) |
| `mailer_autoconfirm` | `false` | **Critical, found by reading GoTrue's source, not the docs:** it special-cases `is_anonymous && Autoconfirm` to silently auto-verify an anonymous user's first email with **no code sent at all**, which would make the whole "type in a code" UI a no-op for that call. Everyone else (non-anonymous, or anonymous with this off) always gets a real confirmation email. |
| `mailer_secure_email_change_enabled` | `true` | Consistent with never letting a linked email be replaced without confirming a code (this app never exposes a "change email" UI beyond the initial link, so this mostly matters if that changes later) |
| `mailer_templates_magic_link_content` | Adds `{{ .Token }}` prominently + a one-line claude-mons sentence, keeps the link | This is the template `signInWithOtp()` uses to deliver the sign-in code |
| `mailer_templates_email_change_content` | Same | This is the template `updateUser({ email })` uses — including the anonymous-linking call, once the two settings above force it through the normal email-change path instead of auto-verifying |
| `mailer_templates_confirmation_content` | Same | Not currently reached by any call this app makes (see below), kept in sync in case a future path signs up a non-anonymous user directly |

## Steps

1. Source credentials into your shell:

```bash
set -a; . ./.env.local; set +a
```

2. Dry run first — prints the diff, changes nothing:

```bash
node scripts/supabase-auth-config.mjs
```

3. Apply:

```bash
node scripts/supabase-auth-config.mjs --apply
```

## The free-tier template limitation

> Unverified beyond this project's own live run: `docs/decisions/0016-email-otp-account-linking.md`'s Verification section records the exact `PATCH` response. Re-check if the project's plan changes.

The non-template keys apply normally. The three `mailer_templates_*`/`mailer_subjects_*` keys are
rejected with **400 "Email template modification is not available for free tier projects using the
default email provider. Please upgrade your plan or configure a custom SMTP provider."** The script
detects this specific error and degrades to a warning rather than failing the whole run.

Until custom SMTP is configured, the default mailer's built-in templates are used instead — they
contain only a confirmation *link*, not the code, even though the same GoTrue call still generates
and stores a real one under the hood (`verifyOtp` would work if the player somehow had the code).
Practically: **players cannot see the 6-digit code in their email until this is fixed.** The
`docs/decisions/0016-email-otp-account-linking.md` Verification section calls this out again with the
exact error text.

**Fix:** configure custom SMTP (any provider — Resend, Postmark, SES) in **Project Settings → Auth →
SMTP Settings** in the Supabase dashboard, then re-run this script with `--apply`; the mailer default's rate limit
(a few emails per hour) is also lifted once a real SMTP provider is set.

## Manual end-to-end test (requires a real, reachable inbox)

The live-call verification in `docs/decisions/0016-email-otp-account-linking.md` only proves the API
accepts the call; it deliberately uses a non-deliverable address and never reads mail. To actually see
a code arrive:

1. In the running app, open **Settings → Account → Send code** with a real email address you control.
2. Check that inbox. Once custom SMTP is configured, the email's subject is "Confirm your new email
   address" and the body shows a 6-digit code prominently.
3. Type the code into the panel's code field and click **Verify**. Confirm `Settings → Account` now
   shows that email as linked.
4. On a second device (or `CLAUDE_MONS_OFFLINE=0` with a fresh `<userData>` profile, see
   `docs/runbooks/reset-local-state.md`), open onboarding's **"Already have a mon? Sign in"**, enter
   the same email, request a new code, and verify it. Confirm the adopted mon (species/stage/XP)
   matches the first device's.

## Acceptance

- `node scripts/supabase-auth-config.mjs` (no `--apply`) prints "No changes needed" when run twice in a row.
- `GET https://api.supabase.com/v1/projects/<ref>/config/auth` shows `site_url`, `external_email_enabled`,
  `security_manual_linking_enabled`, and `mailer_autoconfirm` matching the table above.
- Either the template `PATCH` succeeds (custom SMTP configured), or the script's warning about the
  free-tier limitation is still accurate — re-verify by re-running with `--apply` after any plan change.
- The manual end-to-end test above has been run at least once by a human with a real inbox.
