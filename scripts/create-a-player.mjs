#!/usr/bin/env node
// Creates a server-side claude-mons player for a given email so that signing in with that email in
// the app adopts it (docs/runbooks/create-a-player.md), optionally with a pre-destined egg.
//
// The auth user is created email-confirmed (mailer_autoconfirm is false, so an unconfirmed user
// could never sign in), then players + mons rows are inserted through the Management API SQL query
// endpoint. A pre-set species_id makes a "pre-destined egg": recompute_mon only rolls a species when
// species_id is null, so the egg hatches into exactly that species instead of a random one.
//
// Zero npm dependencies: only node:fs, node:path, node:process, node:url. Reads .env.local itself
// (dotenv-style parse) and never logs secret values (SUPABASE_ACCESS_TOKEN, the service-role key).
//
// Usage:
//   node scripts/create-a-player.mjs --email <addr> --nation <water|fire|earth|air> \
//        [--nickname <3-16 [A-Za-z0-9_]>] [--species <species_id>] [--apply]
//   node scripts/create-a-player.mjs --email <addr> --verify
//
// Without --apply nothing is created: the plan (auth user + exact SQL) is printed and the run stops.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const NATIONS = ['water', 'fire', 'earth', 'air'];
export const NICKNAME_RE = /^[A-Za-z0-9_]{3,16}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An expected, user-facing failure. Thrown instead of calling process.exit(): exiting mid-await
 *  while a fetch socket is still closing aborts the process on Windows (libuv assertion). */
class CliError extends Error {
  constructor(message, { help = false } = {}) {
    super(message);
    this.help = help;
  }
}

// --- pure helpers (unit-tested in scripts/create-a-player.test.mjs) ------------------------------

export function parseEnvLocal(file) {
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

/** SQL literal: a single-quoted, escaped string, or the bare keyword `null`. */
export function sqlLit(value) {
  if (value === null || value === undefined) return 'null';
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Parse argv (after `node script.mjs`) into an options object; throws on bad input. */
export function parseArgs(argv) {
  const opts = { email: null, nation: null, nickname: null, species: null, apply: false, verify: false };
  const takesValue = { '--email': 'email', '--nation': 'nation', '--nickname': 'nickname', '--species': 'species' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') { opts.apply = true; continue; }
    if (arg === '--verify') { opts.verify = true; continue; }
    if (arg === '--help' || arg === '-h') { opts.help = true; continue; }
    const key = takesValue[arg];
    if (!key) throw new Error(`unknown argument: ${arg}`);
    const value = argv[++i];
    if (value === undefined) throw new Error(`${arg} needs a value`);
    opts[key] = value;
  }
  return opts;
}

/** Validate options for a create run; returns a normalized object or throws with a clear message. */
export function validateCreateOpts(opts) {
  if (!opts.email) throw new Error('--email is required');
  if (!NATIONS.includes(opts.nation)) {
    throw new Error(`--nation must be one of ${NATIONS.join(', ')}`);
  }
  if (opts.nickname !== null && !NICKNAME_RE.test(opts.nickname)) {
    throw new Error('--nickname must match ^[A-Za-z0-9_]{3,16}$');
  }
  return opts;
}

/** Message when a species belongs to a different nation than requested, else null. */
export function speciesNationMismatch(species, speciesNation, nation) {
  if (speciesNation === nation) return null;
  return `species '${species}' belongs to nation '${speciesNation}', not '${nation}'`;
}

/** The two idempotent inserts this script runs (also printed verbatim in dry-run mode). */
export function buildInsertSql(uid, nickname, nation, species) {
  return [
    `insert into public.players (id, nickname, nation) values (${sqlLit(uid)}, ${sqlLit(nickname)}, ${sqlLit(nation)}) on conflict (id) do nothing;`,
    `insert into public.mons (player_id, species_id) values (${sqlLit(uid)}, ${sqlLit(species)}) on conflict (player_id) do nothing;`,
  ].join('\n');
}

// --- runtime (Management API + Auth Admin API) --------------------------------------------------

function loadEnv() {
  const envFile = parseEnvLocal(path.join(root, '.env.local'));
  const env = { ...envFile, ...process.env }; // real environment (already sourced) wins
  const token = env.SUPABASE_ACCESS_TOKEN;
  const ref = env.SUPABASE_PROJECT_REF;
  if (!token || !ref) {
    throw new CliError('missing SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF (.env.local or environment)');
  }
  return { token, ref, url: `https://${ref}.supabase.co` };
}

/** Run SQL through the Management API query endpoint; returns the rows array. */
async function runSql(token, ref, query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL query failed: ${res.status} ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : [];
}

/** Reveal the service-role key at runtime. Kept in memory only; never logged or persisted. */
async function getServiceRoleKey(token, ref) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`api-keys fetch failed: ${res.status} ${text.slice(0, 300)}`);
  const entry = JSON.parse(text).find((k) => k.name === 'service_role');
  if (!entry || !entry.api_key) throw new Error('service_role key not found in api-keys response');
  return entry.api_key;
}

/** Create the auth user email-confirmed, or reuse an existing one. Returns { uid, created }. */
async function ensureAuthUser(url, serviceKey, email) {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' };
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, email_confirm: true }),
  });
  const text = await res.text();
  if (res.ok) {
    const uid = JSON.parse(text).id;
    if (!UUID_RE.test(uid)) throw new Error(`auth returned a non-uuid id: ${uid}`);
    return { uid, created: true };
  }
  // Duplicate email: look the existing user up and reuse its uid.
  if (res.status === 422 || res.status === 409) {
    const existing = await findUserByEmail(url, serviceKey, email);
    if (existing) return { uid: existing, created: false };
  }
  throw new Error(`create auth user failed: ${res.status} ${text.slice(0, 300)}`);
}

async function findUserByEmail(url, serviceKey, email) {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const wanted = email.toLowerCase();
  for (let page = 1; page <= 50; page++) {
    const res = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=200`, { headers });
    if (!res.ok) throw new Error(`list users failed: ${res.status}`);
    const users = JSON.parse(await res.text()).users ?? [];
    const hit = users.find((u) => (u.email ?? '').toLowerCase() === wanted);
    if (hit) return hit.id;
    if (users.length < 200) break;
  }
  return null;
}

/** The species' row from the deployed table, or null if it does not exist. */
async function speciesRow(token, ref, species) {
  const rows = await runSql(
    token,
    ref,
    `select nation from public.species_base_stats where species_id = ${sqlLit(species)} limit 1;`,
  );
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

const HELP = `Usage:
  node scripts/create-a-player.mjs --email <addr> --nation <water|fire|earth|air> \\
       [--nickname <3-16 [A-Za-z0-9_]>] [--species <species_id>] [--apply]
  node scripts/create-a-player.mjs --email <addr> --verify

Without --apply the plan is printed and nothing is created.`;

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    throw new CliError(err.message, { help: true });
  }
  if (opts.help) {
    console.info(HELP);
    return;
  }

  const { token, ref, url } = loadEnv();

  if (opts.verify) {
    if (!opts.email) throw new CliError('--verify needs --email');
    const rows = await runSql(
      token,
      ref,
      `select p.id, p.nickname, p.nation, m.species_id, m.stage, m.level, m.total_xp
         from auth.users u
         join public.players p on p.id = u.id
         left join public.mons m on m.player_id = p.id
        where u.email = ${sqlLit(opts.email)};`,
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      console.info(`create-a-player: no player found for ${opts.email}`);
      return;
    }
    console.info(`create-a-player: player for ${opts.email}:`);
    console.info(JSON.stringify(rows[0], null, 2));
    return;
  }

  try {
    validateCreateOpts(opts);
  } catch (err) {
    throw new CliError(err.message);
  }

  // Validate the species against the deployed table (also proves the migration is applied) and
  // check its nation matches, so the mon is reachable in the chosen nation.
  if (opts.species !== null) {
    const row = await speciesRow(token, ref, opts.species);
    if (!row) {
      throw new CliError(
        `unknown species '${opts.species}' (not in public.species_base_stats). ` +
          'Check the spelling or deploy its migration first.',
      );
    }
    const mismatch = speciesNationMismatch(opts.species, row.nation, opts.nation);
    if (mismatch) throw new CliError(mismatch);
  }

  const nickname = opts.nickname ?? (await defaultNickname(opts.email));

  console.info('create-a-player: plan');
  console.info(`  email:    ${opts.email} (created email-confirmed)`);
  console.info(`  nation:   ${opts.nation}`);
  console.info(`  nickname: ${nickname}${opts.nickname ? '' : ' (generated)'}`);
  console.info(`  species:  ${opts.species ?? '(none — random on hatch)'}`);

  if (!opts.apply) {
    console.info('\nSQL that would run (after the auth user is created):');
    console.info(buildInsertSql('<uid-from-auth>', nickname, opts.nation, opts.species));
    console.info('\nDry run only (no --apply flag). Re-run with --apply to create the player.');
    return;
  }

  const serviceKey = await getServiceRoleKey(token, ref);
  const { uid, created } = await ensureAuthUser(url, serviceKey, opts.email);
  if (!UUID_RE.test(uid)) throw new Error(`refusing to run SQL with a non-uuid id: ${uid}`);
  console.info(
    created ? `create-a-player: created auth user ${uid}` : `create-a-player: reusing existing auth user ${uid}`,
  );

  await runSql(token, ref, buildInsertSql(uid, nickname, opts.nation, opts.species));

  const rows = await runSql(
    token,
    ref,
    `select p.id, p.nickname, p.nation, m.species_id, m.stage
       from public.players p left join public.mons m on m.player_id = p.id
      where p.id = ${sqlLit(uid)};`,
  );
  console.info('create-a-player: player is ready:');
  console.info(JSON.stringify(rows[0] ?? { id: uid }, null, 2));
}

/** Auto nickname, generated the same way create-profile does. Lazy TS import keeps the module's
 *  top level free of a .ts dependency so the pure-helper tests never need TS support. */
async function defaultNickname(seed) {
  const { generateNickname } = await import('../packages/shared/src/game/nickname.ts');
  return generateNickname(seed);
}

// Run only when executed directly, so the test file can import the pure helpers above.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`create-a-player: ${err.message}`);
    if (err instanceof CliError && err.help) console.error(HELP);
    process.exitCode = 1;
  });
}
