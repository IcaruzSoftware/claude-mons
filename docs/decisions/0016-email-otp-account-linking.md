---
doc_type: decision
purpose: "Read this when you need to know why claude-mons links an email to the anonymous account with a typed 6-digit code instead of a password, magic-link deep link, or OAuth provider."
audience: both
last_verified: 2026-09-23
last_verified_commit: 274f3fe
related_files:
  - apps/desktop/src/main/net/SupabaseClient.ts
  - apps/desktop/src/main/net/account.ts
  - apps/desktop/src/main/App.ts
  - scripts/supabase-auth-config.mjs
  - docs/runbooks/auth-email-config.md
  - docs/architecture/flows/account-linking.md
adr_status: accepted
---

# Email OTP account linking

## Context

claude-mons signs every player in anonymously (`supabase.auth.signInAnonymously()`,
[ADR 0011](0011-server-authoritative-xp-with-provisional-client-xp.md) and
`docs/architecture/flows/onboarding.md`); there is no way to use the same mon on a second machine.
The owner runs Windows now and plans to add Ubuntu next, so a device needs a way to say "this is the
same player" without the app owning a password or running a local HTTP server to catch a deep link
(Electron on Linux has no reliable OS-level URL-scheme registration story yet, and a magic-link
`https://` redirect would need a hosted landing page this project doesn't have).

Researched via https://supabase.com/docs/guides/auth/auth-anonymous, the auth-email-passwordless
guide, and the @supabase/auth-js source vendored in `node_modules` (more precise than the docs, which
don't enumerate `verifyOtp`'s `type` values): converting an anonymous user to a permanent one is
`supabase.auth.updateUser({ email })` — the auth id is unchanged, so the existing `players`/`mons`
rows survive with no schema change. The correct `verifyOtp` type for that code is `email_change`
("Used when verifying an OTP sent to a new email address during an email update process" — GoTrue's
own client docstring); `signup`/`email` are kept as a fallback only. A second device signs back in with
`signInWithOtp({ email, options: { shouldCreateUser: false } })` + `verifyOtp({ type: 'email' })`,
which never creates a second account. Two non-obvious project-specific findings from `scripts/supabase-auth-config.mjs`'s
live run (`docs/runbooks/auth-email-config.md`): `security_manual_linking_enabled` must be `true` for
`updateUser({ email })` to work on an anonymous user at all, and this project's `mailer_autoconfirm`
was `true`, which GoTrue special-cases to silently auto-verify an anonymous user's first email with
**no code sent** — both had to change for the code-entry flow to exist at all.

Alternatives considered:

- **GitHub OAuth.** Rejected for v1: needs a registered OAuth app, a callback URL, and (per Supabase)
  a hosted redirect target Electron would have to intercept — more moving parts than a typed code,
  for a single-player cosmetic pet with no social features yet. Left as a `docs/ROADMAP.md` "Later" item.
- **Magic link, clicked instead of typed.** Rejected: clicking a `https://` link from an email client
  has to either open a browser that redirects into the app (unregistered custom scheme, unreliable
  on Linux) or land on a hosted page this project doesn't run. A 6-digit code typed into the panel
  needs neither.
- **A real password.** Rejected: the brief is explicit ("no password ever"); a code is one less
  secret to store, reset, or leak, and this app's only account action is "prove you own this email."

## Decision

`SupabaseClient` (`apps/desktop/src/main/net/SupabaseClient.ts`) gains `linkEmail`/`verifyLinkCode`
(anonymous → permanent, `email_change`), `requestSignInCode`/`verifySignInCode` (existing account on
a new device, `email`), `linkedEmail`, and `signOutToAnonymous`. `apps/desktop/src/main/net/account.ts`
holds the pure pieces (email format check, the local-state transforms for adopting a profile or
resetting to anonymous) so they are unit-testable without Electron or a network call. No new Edge
Function: adopting a profile on a new device reuses `create-profile` with an empty body, which
already returns `{ player, mon }` for the caller's own (now-authenticated) session.
`scripts/supabase-auth-config.mjs` makes the required project config repeatable and documents the
email-template limitation of the free-tier default mailer.

## Consequences

- No schema or RLS change: linking never changes `auth.users.id`, so `players`/`mons` rows attach
  automatically. `LocalState.profile.email` (migration v3 → v4) is purely a local cache of what the
  session already knows.
- Signing in on a second device is destructive to that device's *local* state by design: replacing a
  different local anonymous player's mon is only allowed after an explicit confirm in the UI, and the
  old anonymous player's row is left orphaned server-side (undeletable from the client; see
  `docs/runbooks/delete-a-player.md` for owner-side cleanup) — this is accepted because the reward is
  a single-player cosmetic pet with no economy to protect.
- The project's free-tier default mailer cannot have its email templates edited via the Management
  API (`docs/runbooks/auth-email-config.md`), so the code is generated and verifiable server-side
  today, but is not yet visible in the actual email the player receives; custom SMTP is the documented
  fix, tracked as a follow-up rather than blocking this change. Resolved 2026-09-23 by configuring
  custom SMTP and applying the templates (`docs/runbooks/auth-email-config.md`).
