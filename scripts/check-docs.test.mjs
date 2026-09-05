import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';

const SCRIPT = path.join(import.meta.dirname, 'check-docs.mjs');

function mkRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-docs-test-'));
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'fake-repo', version: '0.0.0', private: true }, null, 2),
  );
  return root;
}

// Probed once: several tests need a real git repo (so `last_verified_commit`
// checks have a real sha to point at). Per the task spec, if git init fails
// those assertions are skipped rather than failing the suite.
const GIT_OK = (() => {
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'check-docs-gitprobe-'));
  try {
    execFileSync('git', ['init'], { cwd: probe, stdio: 'ignore' });
    execFileSync(
      'git',
      [
        '-c',
        'user.email=test@example.com',
        '-c',
        'user.name=Test',
        'commit',
        '-m',
        'init',
        '--allow-empty',
      ],
      { cwd: probe, stdio: 'ignore' },
    );
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync(probe, { recursive: true, force: true });
  }
})();

function initGit(root) {
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'add', '-A'], {
    cwd: root,
    stdio: 'ignore',
  });
  execFileSync(
    'git',
    [
      '-c',
      'user.email=test@example.com',
      '-c',
      'user.name=Test',
      'commit',
      '-m',
      'init',
      '--allow-empty',
    ],
    { cwd: root, stdio: 'ignore' },
  );
  return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }).toString().trim();
}

function todayLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function tomorrowLocal() {
  const d = new Date();
  d.setDate(d.getDate() + 3); // beyond the one-day timezone slack the checker allows
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function frontmatter({
  doc_type = 'reference',
  purpose = 'Test purpose.',
  audience = 'both',
  last_verified,
  last_verified_commit,
  related_files = [],
  adr_status,
} = {}) {
  let s = '---\n';
  s += `doc_type: ${doc_type}\n`;
  s += `purpose: "${purpose}"\n`;
  s += `audience: ${audience}\n`;
  s += `last_verified: ${last_verified}\n`;
  s += `last_verified_commit: ${last_verified_commit}\n`;
  if (adr_status) s += `adr_status: ${adr_status}\n`;
  s += 'related_files:\n';
  for (const r of related_files) s += `  - ${r}\n`;
  s += '---\n';
  return s;
}

function run(root, args) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8' });
  return res;
}

test('valid minimal doc set passes (--write then check)', { skip: !GIT_OK }, () => {
  const root = mkRepo();
  const sha = initGit(root);
  const today = todayLocal();
  fs.writeFileSync(
    path.join(root, 'README.md'),
    frontmatter({
      doc_type: 'root',
      purpose: 'Root readme.',
      last_verified: today,
      last_verified_commit: sha,
    }) + '\n# claude-mons\n\nHello.\n',
  );

  const writeRes = run(root, ['--write']);
  assert.equal(writeRes.status, 0, writeRes.stdout + writeRes.stderr);
  assert.ok(fs.existsSync(path.join(root, 'docs', 'README.md')));

  const checkRes = run(root, []);
  assert.equal(checkRes.status, 0, checkRes.stdout + checkRes.stderr);
  assert.match(checkRes.stdout, /check-docs: 0 errors/);
});

test('missing frontmatter is an error', () => {
  const root = mkRepo();
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# No frontmatter here\n\nJust text.\n');

  const res = run(root, ['--file', 'CLAUDE.md']);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /CLAUDE\.md: missing frontmatter/);
});

test('unknown doc_type is an error', { skip: !GIT_OK }, () => {
  const root = mkRepo();
  const sha = initGit(root);
  const today = todayLocal();
  fs.writeFileSync(
    path.join(root, 'CLAUDE.md'),
    frontmatter({ doc_type: 'bogus', last_verified: today, last_verified_commit: sha }) +
      '\nBody.\n',
  );

  const res = run(root, ['--file', 'CLAUDE.md']);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /invalid doc_type: "bogus"/);
});

test('bad path reference in body is an error naming the path', { skip: !GIT_OK }, () => {
  const root = mkRepo();
  const sha = initGit(root);
  const today = todayLocal();
  fs.writeFileSync(
    path.join(root, 'CLAUDE.md'),
    frontmatter({ doc_type: 'reference', last_verified: today, last_verified_commit: sha }) +
      '\nSee `docs/DOES_NOT_EXIST.md` for details.\n',
  );

  const res = run(root, ['--file', 'CLAUDE.md']);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /docs\/DOES_NOT_EXIST\.md/);
});

test('allowlisted path reference is ok', { skip: !GIT_OK }, () => {
  const root = mkRepo();
  const sha = initGit(root);
  const today = todayLocal();
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'docs', '.check-docs-allow.json'),
    JSON.stringify(['docs/DOES_NOT_EXIST.md']),
  );
  fs.writeFileSync(
    path.join(root, 'CLAUDE.md'),
    frontmatter({ doc_type: 'reference', last_verified: today, last_verified_commit: sha }) +
      '\nSee `docs/DOES_NOT_EXIST.md` for details.\n',
  );

  const res = run(root, ['--file', 'CLAUDE.md']);
  assert.equal(res.status, 0, res.stdout + res.stderr);
});

test('history doc with bad paths is ok (path check skipped)', { skip: !GIT_OK }, () => {
  const root = mkRepo();
  const sha = initGit(root);
  const today = todayLocal();
  fs.mkdirSync(path.join(root, 'docs', 'history'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'docs', 'history', 'v1-old.md'),
    frontmatter({ doc_type: 'history', last_verified: today, last_verified_commit: sha }) +
      '\nSee `docs/TOTALLY_MISSING.md` and [gone](nope/gone.md).\n',
  );

  const res = run(root, ['--file', 'docs/history/v1-old.md']);
  assert.equal(res.status, 0, res.stdout + res.stderr);
});

test('future last_verified is an error', { skip: !GIT_OK }, () => {
  const root = mkRepo();
  const sha = initGit(root);
  fs.writeFileSync(
    path.join(root, 'CLAUDE.md'),
    frontmatter({
      doc_type: 'reference',
      last_verified: tomorrowLocal(),
      last_verified_commit: sha,
    }) + '\nBody.\n',
  );

  const res = run(root, ['--file', 'CLAUDE.md']);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /future/);
});

test('gapped ADR numbering is an error', { skip: !GIT_OK }, () => {
  const root = mkRepo();
  const sha = initGit(root);
  const today = todayLocal();
  fs.mkdirSync(path.join(root, 'docs', 'decisions'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'docs', 'decisions', '0001-foo.md'),
    frontmatter({
      doc_type: 'decision',
      last_verified: today,
      last_verified_commit: sha,
      adr_status: 'accepted',
    }) + '\n# Foo\n\nBody.\n',
  );
  fs.writeFileSync(
    path.join(root, 'docs', 'decisions', '0003-bar.md'),
    frontmatter({
      doc_type: 'decision',
      last_verified: today,
      last_verified_commit: sha,
      adr_status: 'accepted',
    }) + '\n# Bar\n\nBody.\n',
  );

  const res = run(root, []);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /not contiguous/);
});

test('ADR slug mismatch is an error', { skip: !GIT_OK }, () => {
  const root = mkRepo();
  const sha = initGit(root);
  const today = todayLocal();
  fs.mkdirSync(path.join(root, 'docs', 'decisions'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'docs', 'decisions', '0001-foo.md'),
    frontmatter({
      doc_type: 'decision',
      last_verified: today,
      last_verified_commit: sha,
      adr_status: 'accepted',
    }) + '\n# Something Else Entirely\n\nBody.\n',
  );

  const res = run(root, []);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /does not match kebab-cased title/);
});

test('stale index is an error, --write fixes it', { skip: !GIT_OK }, () => {
  const root = mkRepo();
  const sha = initGit(root);
  const today = todayLocal();
  fs.writeFileSync(
    path.join(root, 'README.md'),
    frontmatter({
      doc_type: 'root',
      purpose: 'Root readme v1.',
      last_verified: today,
      last_verified_commit: sha,
    }) + '\n# claude-mons\n',
  );

  const writeRes = run(root, ['--write']);
  assert.equal(writeRes.status, 0, writeRes.stdout + writeRes.stderr);

  // Change the purpose without regenerating the index -> index is now stale.
  fs.writeFileSync(
    path.join(root, 'README.md'),
    frontmatter({
      doc_type: 'root',
      purpose: 'Root readme v2, changed.',
      last_verified: today,
      last_verified_commit: sha,
    }) + '\n# claude-mons\n',
  );

  const staleRes = run(root, []);
  assert.equal(staleRes.status, 1);
  assert.match(staleRes.stdout, /index out of date, run `pnpm docs:index`/);

  const fixRes = run(root, ['--write']);
  assert.equal(fixRes.status, 0, fixRes.stdout + fixRes.stderr);
  assert.match(fixRes.stdout, /check-docs: 0 errors/);
});

test('unbalanced code fence is an error', { skip: !GIT_OK }, () => {
  const root = mkRepo();
  const sha = initGit(root);
  const today = todayLocal();
  fs.writeFileSync(
    path.join(root, 'CLAUDE.md'),
    frontmatter({ doc_type: 'reference', last_verified: today, last_verified_commit: sha }) +
      '\n```\ncode\n```\n```\nunterminated\n',
  );

  const res = run(root, ['--file', 'CLAUDE.md']);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /unbalanced code fences/);
});

test('mermaid fence without diagram keyword is an error', { skip: !GIT_OK }, () => {
  const root = mkRepo();
  const sha = initGit(root);
  const today = todayLocal();
  fs.writeFileSync(
    path.join(root, 'CLAUDE.md'),
    frontmatter({ doc_type: 'reference', last_verified: today, last_verified_commit: sha }) +
      '\n```mermaid\nnot a real diagram type\n```\n',
  );

  const res = run(root, ['--file', 'CLAUDE.md']);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /mermaid code fence does not start with a recognized diagram keyword/);
});

test('--file mode skips the index check', { skip: !GIT_OK }, () => {
  const root = mkRepo();
  const sha = initGit(root);
  const today = todayLocal();
  fs.writeFileSync(
    path.join(root, 'CLAUDE.md'),
    frontmatter({ doc_type: 'reference', last_verified: today, last_verified_commit: sha }) +
      '\nBody.\n',
  );

  const res = run(root, ['--file', 'CLAUDE.md']);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.doesNotMatch(res.stdout, /index missing/);
});
