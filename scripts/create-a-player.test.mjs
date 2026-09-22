import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildInsertSql,
  NICKNAME_RE,
  parseArgs,
  speciesNationMismatch,
  sqlLit,
  validateCreateOpts,
} from './create-a-player.mjs';

test('nickname regex accepts 3-16 [A-Za-z0-9_] and rejects the rest', () => {
  assert.ok(NICKNAME_RE.test('abc'));
  assert.ok(NICKNAME_RE.test('Coder_0042'));
  assert.ok(NICKNAME_RE.test('A_1234567890_bc'));
  assert.ok(!NICKNAME_RE.test('ab')); // too short
  assert.ok(!NICKNAME_RE.test('a'.repeat(17))); // too long
  assert.ok(!NICKNAME_RE.test('has space'));
  assert.ok(!NICKNAME_RE.test('dash-no'));
  assert.ok(!NICKNAME_RE.test('emoji😀x'));
});

test('validateCreateOpts enforces email, nation and nickname format', () => {
  assert.throws(() => validateCreateOpts({ email: null, nation: 'water', nickname: null }), /--email/);
  assert.throws(() => validateCreateOpts({ email: 'a@b.c', nation: 'lava', nickname: null }), /--nation/);
  assert.throws(() => validateCreateOpts({ email: 'a@b.c', nation: 'water', nickname: 'no' }), /--nickname/);
  assert.deepEqual(
    validateCreateOpts({ email: 'a@b.c', nation: 'fire', nickname: 'Coder_1', species: null }),
    { email: 'a@b.c', nation: 'fire', nickname: 'Coder_1', species: null },
  );
});

test('sqlLit escapes single quotes and renders null as a bare keyword', () => {
  assert.equal(sqlLit('bubblit'), "'bubblit'");
  assert.equal(sqlLit("O'Brien"), "'O''Brien'");
  assert.equal(sqlLit("a'b'c"), "'a''b''c'");
  assert.equal(sqlLit(null), 'null');
  assert.equal(sqlLit(undefined), 'null');
});

test('buildInsertSql wires the values into idempotent inserts', () => {
  const sql = buildInsertSql(
    '11111111-2222-3333-4444-555555555555',
    'Coder_0042',
    'water',
    'bubblit',
  );
  assert.match(
    sql,
    /insert into public\.players \(id, nickname, nation\) values \('11111111-2222-3333-4444-555555555555', 'Coder_0042', 'water'\) on conflict \(id\) do nothing;/,
  );
  assert.match(
    sql,
    /insert into public\.mons \(player_id, species_id\) values \('11111111-2222-3333-4444-555555555555', 'bubblit'\) on conflict \(player_id\) do nothing;/,
  );
});

test('buildInsertSql leaves species null for a plain egg', () => {
  const sql = buildInsertSql('11111111-2222-3333-4444-555555555555', 'Coder_0042', 'air', null);
  assert.match(sql, /values \('11111111-2222-3333-4444-555555555555', null\) on conflict/);
});

test('speciesNationMismatch flags a nation mismatch and passes a match', () => {
  assert.equal(speciesNationMismatch('bubblit', 'water', 'water'), null);
  assert.equal(
    speciesNationMismatch('bubblit', 'water', 'fire'),
    "species 'bubblit' belongs to nation 'water', not 'fire'",
  );
});

test('parseArgs reads flags and values, and rejects unknown or valueless flags', () => {
  assert.deepEqual(
    parseArgs(['--email', 'a@b.c', '--nation', 'water', '--species', 'bubblit', '--apply']),
    { email: 'a@b.c', nation: 'water', nickname: null, species: 'bubblit', apply: true, verify: false },
  );
  assert.deepEqual(
    parseArgs(['--email', 'a@b.c', '--verify']),
    { email: 'a@b.c', nation: null, nickname: null, species: null, apply: false, verify: true },
  );
  assert.throws(() => parseArgs(['--bogus']), /unknown argument/);
  assert.throws(() => parseArgs(['--email']), /needs a value/);
});
