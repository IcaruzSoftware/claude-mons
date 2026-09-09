#!/usr/bin/env node
// Configures the Supabase project's auth settings for email OTP account linking
// (docs/runbooks/auth-email-config.md). Repeatable: fetches the current config first, computes a
// diff against the desired values below, prints only the keys that will change, then PATCHes.
// Running it again with nothing to change is a no-op that prints "No changes needed."
//
// Zero npm dependencies: only node:fs, node:path, node:process, node:url. Reads .env.local itself
// (dotenv-style parse) and never logs secret values (SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD).
//
// Usage:
//   node scripts/supabase-auth-config.mjs           dry run: show the diff, do not patch
//   node scripts/supabase-auth-config.mjs --apply   apply the diff

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET_KEYS = new Set(['SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD']);

function parseEnvLocal(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const rawLine of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const withoutExport = line.startsWith('export ') ? line.slice('export '.length) : line;
    const eq = withoutExport.indexOf('=');
    if (eq === -1) continue;
    const key = withoutExport.slice(0, eq).trim();
    let value = withoutExport.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const envFile = parseEnvLocal(path.join(root, '.env.local'));
const env = { ...envFile, ...process.env }; // real environment (already sourced) wins
const ACCESS_TOKEN = env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = env.SUPABASE_PROJECT_REF;

if (!ACCESS_TOKEN || !PROJECT_REF) {
  console.error(
    'supabase-auth-config: missing SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF (.env.local or environment)',
  );
  process.exit(1);
}

const CONFIG_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`;

const TOKEN_SENTENCE =
  'This code is for your claude-mons account — use it to link your mon so you can play it on another computer.';

// The Magic Link template is what signInWithOtp() uses to deliver the sign-in code (see
// docs/runbooks/auth-email-config.md). Keeps the original ConfirmationURL link as a fallback.
const MAGIC_LINK_TEMPLATE = `<h2>Your claude-mons sign-in code</h2>

<p>${TOKEN_SENTENCE}</p>
<h1 style="font-size: 32px; letter-spacing: 4px;">{{ .Token }}</h1>
<p>Or follow the link below to sign in. This link expires shortly and can only be used once.</p>
<p><a href="{{ .ConfirmationURL }}">Sign in</a></p>`;

// The Email Change template is what GoTrue sends for updateUser({ email }) — including linking an
// anonymous user's first email, once security_manual_linking_enabled + mailer_autoconfirm=false
// force that call through the normal email-change confirmation path instead of auto-verifying it.
const EMAIL_CHANGE_TEMPLATE = `<h2>Confirm your new email address</h2>

<p>${TOKEN_SENTENCE}</p>
<h1 style="font-size: 32px; letter-spacing: 4px;">{{ .Token }}</h1>
<p>Or follow the link below to confirm {{ .NewEmail }} as your new email address.</p>
<p><a href="{{ .ConfirmationURL }}">Confirm new email address</a></p>

<p>If you didn't request this change, you can safely ignore this email.</p>`;

// Not currently reached by the anonymous-linking flow (see the runbook), but kept in sync in case
// a future path signs up a brand-new (non-anonymous) permanent user directly.
const CONFIRMATION_TEMPLATE = `<h2>Confirm your claude-mons email</h2>

<p>${TOKEN_SENTENCE}</p>
<h1 style="font-size: 32px; letter-spacing: 4px;">{{ .Token }}</h1>
<p>Or follow the link below to confirm this email address and finish signing up.</p>
<p><a href="{{ .ConfirmationURL }}">Confirm email address</a></p>`;

const DESIRED = {
  site_url: 'https://github.com/IcaruzSoftware/claude-mons',
  external_email_enabled: true,
  // Anonymous conversion (updateUser({ email })) requires manual linking to be enabled; see
  // https://supabase.com/docs/guides/auth/auth-identity-linking#manual-linking-beta
  security_manual_linking_enabled: true,
  // Critical: GoTrue special-cases `is_anonymous && Mailer.Autoconfirm` to auto-verify an
  // anonymous user's first email with NO code sent at all, which would silently skip our OTP
  // step entirely. Must be false so linking always goes through the email-change confirmation
  // (code required). See docs/runbooks/auth-email-config.md for how this was found.
  mailer_autoconfirm: false,
  // Keep secure email change on: consistent with never letting a linked email be silently
  // replaced without confirming both the OTP code and (for a second change) the old address.
  mailer_secure_email_change_enabled: true,
  mailer_templates_magic_link_content: MAGIC_LINK_TEMPLATE,
  mailer_templates_email_change_content: EMAIL_CHANGE_TEMPLATE,
  mailer_templates_confirmation_content: CONFIRMATION_TEMPLATE,
};

function summarize(key, value) {
  if (typeof value === 'string' && value.length > 80) {
    return `<${value.length} chars, contains {{ .Token }}: ${/\{\{\s*\.Token\s*\}\}/.test(value)}>`;
  }
  return JSON.stringify(value);
}

async function main() {
  const res = await fetch(CONFIG_URL, { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } });
  if (!res.ok) {
    console.error(`GET config/auth failed: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const current = await res.json();

  const changes = {};
  for (const [key, desired] of Object.entries(DESIRED)) {
    if (current[key] !== desired) changes[key] = desired;
  }

  if (Object.keys(changes).length === 0) {
    console.info('supabase-auth-config: No changes needed. All managed keys already match.');
    return;
  }

  console.info('supabase-auth-config: keys that will change:');
  for (const [key, desired] of Object.entries(changes)) {
    console.info(`  ${key}: ${summarize(key, current[key])} -> ${summarize(key, desired)}`);
  }

  if (!process.argv.includes('--apply')) {
    console.info('\nDry run only (no --apply flag). Re-run with --apply to patch.');
    return;
  }

  // Free-tier projects on the default email provider reject template/subject edits (400,
  // "Email template modification is not available for free tier projects ... configure a custom
  // SMTP provider"). Patch the non-template keys first so those still apply, then attempt the
  // template keys separately and degrade to a clear warning instead of failing the whole run.
  const isTemplateKey = (k) =>
    k.startsWith('mailer_templates_') || k.startsWith('mailer_subjects_');
  const nonTemplateChanges = Object.fromEntries(
    Object.entries(changes).filter(([k]) => !isTemplateKey(k)),
  );
  const templateChanges = Object.fromEntries(
    Object.entries(changes).filter(([k]) => isTemplateKey(k)),
  );

  async function patch(body) {
    const res = await fetch(CONFIG_URL, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  }

  if (Object.keys(nonTemplateChanges).length > 0) {
    const r = await patch(nonTemplateChanges);
    if (!r.ok) {
      console.error(
        `PATCH config/auth (non-template keys) failed: ${r.status} ${r.text.slice(0, 500)}`,
      );
      process.exit(1);
    }
    console.info(
      `supabase-auth-config: applied ${Object.keys(nonTemplateChanges).length} non-template key(s).`,
    );
  }

  if (Object.keys(templateChanges).length > 0) {
    const r = await patch(templateChanges);
    if (!r.ok) {
      console.warn(
        `supabase-auth-config: template keys NOT applied (${r.status}): ${r.text.slice(0, 300)}`,
      );
      console.warn(
        'This project is on the free tier with the default mailer. Templates cannot be edited via ' +
          'the Management API until custom SMTP is configured (docs/runbooks/auth-email-config.md).',
      );
    } else {
      console.info(
        `supabase-auth-config: applied ${Object.keys(templateChanges).length} template key(s).`,
      );
    }
  }
}

// Guard against SECRET_KEYS ever accidentally ending up in DESIRED/logged output.
for (const k of Object.keys(DESIRED)) {
  if (SECRET_KEYS.has(k)) throw new Error(`refusing to manage secret key ${k}`);
}

await main();
