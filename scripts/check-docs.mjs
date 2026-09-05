#!/usr/bin/env node
// Documentation checker / index generator for claude-mons.
//
// Usage:
//   node scripts/check-docs.mjs            check every doc in the doc set
//   node scripts/check-docs.mjs --write     regenerate docs/README.md, then check
//   node scripts/check-docs.mjs --file <p>  check only <p> (repeatable); skips
//                                            index freshness and ADR-set checks
//
// Zero npm dependencies: only node:fs, node:path, node:child_process, node:process, node:url.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ALLOWED_KEYS = new Set([
  'doc_type',
  'purpose',
  'audience',
  'last_verified',
  'last_verified_commit',
  'related_files',
  'adr_status',
  'supersedes',
  'superseded_by',
]);

const DOC_TYPES = [
  'root',
  'index',
  'design',
  'architecture',
  'decision',
  'runbook',
  'policy',
  'reference',
  'history',
];

const AUDIENCES = ['agent', 'human', 'both'];
const ADR_STATUSES = ['accepted', 'superseded', 'deprecated'];

const PATH_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.go',
  '.sql',
  '.yml',
  '.yaml',
  '.mjs',
  '.json',
  '.md',
  '.toml',
  '.css',
  '.html',
  '.ps1',
];

const MERMAID_KEYWORDS = [
  'sequenceDiagram',
  'flowchart',
  'graph',
  'stateDiagram',
  'classDiagram',
  'erDiagram',
];

// Index section order and titles.
const TYPE_ORDER = [
  'root',
  'architecture',
  'design',
  'decision',
  'runbook',
  'policy',
  'reference',
  'history',
];
const TYPE_TITLES = {
  root: 'Root',
  architecture: 'Architecture',
  design: 'Design',
  decision: 'Decisions',
  runbook: 'Runbooks',
  policy: 'Policies',
  reference: 'Reference',
  history: 'History',
};

const STATIC_DOC_CANDIDATES = [
  'README.md',
  'CONTRIBUTING.md',
  'CLAUDE.md',
  'PRIVACY.md',
  'CHANGELOG.md',
  'apps/desktop/README.md',
  'apps/desktop/IPC.md',
  'supabase/README.md',
];

function toPosix(p) {
  return p.split(path.sep).join('/');
}

// ---------------------------------------------------------------------------
// Repo root discovery
// ---------------------------------------------------------------------------

function findRepoRoot() {
  if (process.env.CHECK_DOCS_ROOT) {
    return path.resolve(process.env.CHECK_DOCS_ROOT);
  }
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, 'package.json'))) {
    return cwd;
  }
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new UsageError(
        'could not locate repo root (no package.json found walking up from script)',
      );
    }
    dir = parent;
  }
}

class UsageError extends Error {}

// ---------------------------------------------------------------------------
// git helpers
// ---------------------------------------------------------------------------

let gitAvailableCache;
function isGitAvailable(root) {
  if (gitAvailableCache !== undefined) return gitAvailableCache;
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    gitAvailableCache = true;
  } catch {
    gitAvailableCache = false;
  }
  return gitAvailableCache;
}

function commitExists(root, sha) {
  try {
    const out = execFileSync('git', ['cat-file', '-t', sha], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    return out === 'commit';
  } catch {
    return false;
  }
}

function shortHead(root) {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return '0000000';
  }
}

// ---------------------------------------------------------------------------
// Frontmatter parsing (flat hand-rolled YAML subset)
// ---------------------------------------------------------------------------

function stripQuotes(s) {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1);
  }
  return s;
}

function parseFrontmatter(content) {
  const lines = content.split('\n');
  if (lines[0] !== '---') {
    return { present: false, error: null, data: null, unknownKeys: [], bodyStartIndex: 0 };
  }
  const data = {};
  const unknownKeys = [];
  let i = 1;
  let closed = false;
  while (i < lines.length) {
    const line = lines[i];
    if (line === '---') {
      closed = true;
      i++;
      break;
    }
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*):(.*)$/);
    if (!m) {
      return {
        present: true,
        error: `line ${i + 1}: cannot parse frontmatter line: ${JSON.stringify(line)}`,
        data: null,
        unknownKeys,
        bodyStartIndex: i,
      };
    }
    const key = m[1];
    const rest = m[2];
    if (rest.trim() === '') {
      const items = [];
      i++;
      const itemRe = /^ {2}- (.*)$/;
      while (i < lines.length && itemRe.test(lines[i])) {
        const item = stripQuotes(lines[i].match(itemRe)[1].trim());
        items.push(item);
        i++;
      }
      data[key] = items;
    } else {
      let val = rest.trim();
      if (/^[[{]/.test(val) || /^[|>][+-]?\d*$/.test(val)) {
        return {
          present: true,
          error: `line ${i + 1}: unsupported YAML value (nested map, flow list, or block scalar): ${val}`,
          data: null,
          unknownKeys,
          bodyStartIndex: i,
        };
      }
      val = stripQuotes(val);
      data[key] = val === 'null' ? null : val;
      i++;
    }
    if (!ALLOWED_KEYS.has(key)) unknownKeys.push(key);
  }
  if (!closed) {
    return {
      present: true,
      error: 'unterminated frontmatter (no closing "---")',
      data: null,
      unknownKeys,
      bodyStartIndex: lines.length,
    };
  }
  return { present: true, error: null, data, unknownKeys, bodyStartIndex: i };
}

// ---------------------------------------------------------------------------
// Doc set discovery
// ---------------------------------------------------------------------------

function listDocSet(root) {
  const files = new Set();
  for (const c of STATIC_DOC_CANDIDATES) {
    if (fs.existsSync(path.join(root, c))) files.add(c);
  }
  for (const g of fs.globSync('docs/**/*.md', { cwd: root })) {
    files.add(toPosix(g));
  }
  for (const g of fs.globSync('packages/*/README.md', { cwd: root })) {
    files.add(toPosix(g));
  }
  return [...files].sort();
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function todayLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isValidCalendarDate(str) {
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}

// ---------------------------------------------------------------------------
// Path-candidate extraction from doc bodies
// ---------------------------------------------------------------------------

function extractPathCandidate(raw) {
  // URLs, anchors, home-relative and absolute filesystem paths are never repo paths.
  if (/^(https?:\/\/|mailto:|#|~\/|\/)/.test(raw)) return null;
  let s = raw;
  const hashIdx = s.indexOf('#');
  if (hashIdx !== -1) s = s.slice(0, hashIdx);
  const suffixMatch = s.match(/^(.+):[A-Za-z_][A-Za-z0-9_]*$/);
  if (suffixMatch) s = suffixMatch[1];
  if (!s) return null;
  if (/\s/.test(s)) return null;
  if (s.startsWith('-')) return null;
  if (/[<>{}$%|]/.test(s)) return null;
  const hasSlash = s.includes('/');
  // A bare extension on its own (e.g. ".ts") is not a filename reference.
  const hasExt = PATH_EXTENSIONS.some((ext) => s.endsWith(ext) && s.length > ext.length);
  if (!hasSlash && !hasExt) return null;
  return s;
}

function findCandidatesInLine(line) {
  const out = [];
  const codeRe = /`([^`]+)`/g;
  let m;
  while ((m = codeRe.exec(line))) {
    const c = extractPathCandidate(m[1]);
    if (c) out.push(c);
  }
  const linkRe = /]\(([^)]+)\)/g;
  while ((m = linkRe.exec(line))) {
    const c = extractPathCandidate(m[1]);
    if (c) out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

function loadAllowlist(root) {
  const p = path.join(root, 'docs', '.check-docs-allow.json');
  if (!fs.existsSync(p)) return { literals: new Set(), patterns: [] };
  let json;
  try {
    json = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    throw new UsageError(`docs/.check-docs-allow.json: invalid JSON (${e.message})`);
  }
  const literals = new Set();
  const patterns = [];
  for (const entry of json) {
    if (typeof entry === 'string') literals.add(entry);
    else if (entry && typeof entry === 'object' && typeof entry.pattern === 'string') {
      patterns.push(new RegExp(entry.pattern));
    }
  }
  return { literals, patterns };
}

function isAllowlisted(allowlist, candidate) {
  if (allowlist.literals.has(candidate)) return true;
  return allowlist.patterns.some((re) => re.test(candidate));
}

// ---------------------------------------------------------------------------
// Fence checks
// ---------------------------------------------------------------------------

function checkFences(bodyLines, addIssue) {
  let fenceCount = 0;
  let inFence = false;
  let awaitingMermaid = false;
  for (const line of bodyLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      fenceCount++;
      if (!inFence) {
        inFence = true;
        const lang = trimmed.slice(3).trim().toLowerCase();
        awaitingMermaid = lang === 'mermaid';
      } else {
        inFence = false;
        awaitingMermaid = false;
      }
      continue;
    }
    if (inFence && awaitingMermaid && trimmed !== '') {
      const ok = MERMAID_KEYWORDS.some((k) => trimmed.startsWith(k));
      if (!ok) {
        addIssue(
          'error',
          `mermaid code fence does not start with a recognized diagram keyword (${MERMAID_KEYWORDS.join(', ')})`,
        );
      }
      awaitingMermaid = false;
    }
  }
  if (fenceCount % 2 !== 0) {
    addIssue('error', 'unbalanced code fences (odd number of ``` lines)');
  }
}

// ---------------------------------------------------------------------------
// Per-file checking
// ---------------------------------------------------------------------------

function checkDoc(root, relPath, opts, ctx) {
  const absPath = path.join(root, relPath);
  const docDir = path.dirname(absPath);
  const rawContent = fs.readFileSync(absPath, 'utf8');
  const content = rawContent.replace(/\r\n/g, '\n');
  const lines = content.split('\n');

  const addIssue = (level, message) => ctx.addIssue(relPath, level, message);

  const fm = parseFrontmatter(content);
  let docType = null;
  let bodyLines;

  if (fm.error) {
    addIssue('error', `frontmatter parse error: ${fm.error}`);
    bodyLines = lines;
  } else if (!fm.present) {
    addIssue('error', 'missing frontmatter');
    bodyLines = lines;
  } else {
    const data = fm.data;
    bodyLines = lines.slice(fm.bodyStartIndex);

    // unknown keys are aggregated globally; record occurrences for later.
    for (const key of fm.unknownKeys) {
      ctx.recordUnknownKey(key, relPath);
    }

    // doc_type / audience / purpose
    docType = data.doc_type ?? null;
    if (!data.doc_type) {
      addIssue('error', 'doc_type is required');
    } else if (!DOC_TYPES.includes(data.doc_type)) {
      addIssue('error', `invalid doc_type: "${data.doc_type}"`);
    }

    if (!data.audience) {
      addIssue('error', 'audience is required');
    } else if (!AUDIENCES.includes(data.audience)) {
      addIssue('error', `invalid audience: "${data.audience}"`);
    }

    if (!data.purpose || typeof data.purpose !== 'string' || data.purpose.trim() === '') {
      addIssue('error', 'purpose is required and must be a non-empty string');
    }

    if (data.doc_type === 'decision') {
      if (!data.adr_status || !ADR_STATUSES.includes(data.adr_status)) {
        addIssue(
          'error',
          `decision docs require adr_status to be one of ${ADR_STATUSES.join('|')}`,
        );
      }
    }

    // last_verified
    if (data.last_verified === undefined) {
      addIssue('error', 'last_verified is required');
    } else if (
      typeof data.last_verified !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(data.last_verified)
    ) {
      addIssue('error', `last_verified must match YYYY-MM-DD: "${data.last_verified}"`);
    } else if (!isValidCalendarDate(data.last_verified)) {
      addIssue('error', `last_verified is not a real calendar date: "${data.last_verified}"`);
    } else if (data.last_verified > ctx.maxDate) {
      addIssue('error', `last_verified is in the future: "${data.last_verified}"`);
    }

    // last_verified_commit
    if (data.last_verified_commit === undefined) {
      addIssue('error', 'last_verified_commit is required');
    } else if (
      typeof data.last_verified_commit !== 'string' ||
      !/^[0-9a-f]{7,40}$/.test(data.last_verified_commit)
    ) {
      addIssue(
        'error',
        `last_verified_commit must be a lowercase hex sha (7-40 chars): "${data.last_verified_commit}"`,
      );
    } else if (!ctx.gitAvailable) {
      addIssue('warn', 'git is unavailable; skipped last_verified_commit existence check');
    } else if (!commitExists(root, data.last_verified_commit)) {
      addIssue(
        'error',
        `last_verified_commit does not exist in git history: "${data.last_verified_commit}"`,
      );
    }

    // related_files
    if (data.related_files !== undefined) {
      if (!Array.isArray(data.related_files)) {
        addIssue('error', 'related_files must be a list');
      } else {
        for (const entry of data.related_files) {
          if (typeof entry !== 'string' || entry === '') continue;
          if (entry.endsWith('*')) {
            const matches = fs.globSync(entry, { cwd: root });
            if (matches.length === 0) {
              addIssue('error', `related_files glob matched nothing: "${entry}"`);
            }
          } else if (!fs.existsSync(path.join(root, entry))) {
            addIssue('error', `related_files entry does not exist: "${entry}"`);
          }
        }
      }
    }
  }

  // Body path references (check 6) -- skipped for history docs.
  if (docType !== 'history') {
    for (const line of bodyLinesOutsideFences(bodyLines)) {
      for (const candidate of findCandidatesInLine(line)) {
        if (isAllowlisted(ctx.allowlist, candidate)) continue;
        if (candidate.includes('*')) {
          const inDocDir = fs.globSync(candidate, { cwd: docDir });
          const inRoot = inDocDir.length > 0 ? inDocDir : fs.globSync(candidate, { cwd: root });
          if (inRoot.length === 0) {
            addIssue('error', `broken path reference (glob matched nothing): "${candidate}"`);
          }
          continue;
        }
        const existsInDocDir = fs.existsSync(path.join(docDir, candidate));
        const existsInRoot = fs.existsSync(path.join(root, candidate));
        if (!existsInDocDir && !existsInRoot) {
          addIssue('error', `broken path reference: "${candidate}"`);
        }
      }
    }
  }

  // Fences (check 9)
  checkFences(bodyLines, addIssue);

  // Length warning (check 10)
  const nonBlankBodyLen = bodyLines.length;
  if (nonBlankBodyLen > 260) {
    addIssue('warn', `body is long (${nonBlankBodyLen} lines); consider splitting`);
  }

  return { docType, frontmatter: fm.present && !fm.error ? fm.data : null };
}

// Yields lines that are outside fenced code blocks.
function* bodyLinesOutsideFences(lines) {
  let inFence = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) yield line;
  }
}

// ---------------------------------------------------------------------------
// ADR set check
// ---------------------------------------------------------------------------

function kebabCase(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function checkAdrSet(root, ctx) {
  const dir = path.join(root, 'docs', 'decisions');
  if (!fs.existsSync(dir)) return;
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}-.+\.md$/.test(f))
    .sort();
  const seen = new Map();
  for (const f of files) {
    const m = f.match(/^(\d{4})-(.+)\.md$/);
    const num = Number(m[1]);
    const slug = m[2];
    const relPath = toPosix(path.join('docs', 'decisions', f));
    if (seen.has(num)) {
      ctx.addIssue(
        relPath,
        'error',
        `duplicate ADR number ${m[1]} (also used by ${seen.get(num)})`,
      );
    } else {
      seen.set(num, f);
    }
    const content = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n');
    const fm = parseFrontmatter(content);
    const bodyLines =
      fm.present && !fm.error ? content.split('\n').slice(fm.bodyStartIndex) : content.split('\n');
    const titleLine = bodyLines.find((l) => l.trim().startsWith('# '));
    if (!titleLine) {
      ctx.addIssue(relPath, 'error', 'ADR file has no "# " title heading');
      continue;
    }
    const title = titleLine.trim().replace(/^# /, '');
    const expectedSlug = kebabCase(title);
    if (expectedSlug !== slug) {
      ctx.addIssue(
        relPath,
        'error',
        `ADR slug "${slug}" does not match kebab-cased title "${expectedSlug}" (from "${title}")`,
      );
    }
  }
  const numbers = [...seen.keys()].sort((a, b) => a - b);
  for (let i = 0; i < numbers.length; i++) {
    const expected = i + 1;
    if (numbers[i] !== expected) {
      const relPath = 'docs/decisions';
      ctx.addIssue(
        relPath,
        'error',
        `ADR numbering is not contiguous starting at 0001 (expected ${String(expected).padStart(4, '0')}, got ${String(numbers[i]).padStart(4, '0')})`,
      );
      break;
    }
  }
}

function adrNumber(relPath) {
  const m = path.basename(relPath).match(/^(\d{4})-/);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}

// ---------------------------------------------------------------------------
// Index generation
// ---------------------------------------------------------------------------

function linkFromDocsDir(root, relPath) {
  const docsDir = path.join(root, 'docs');
  const abs = path.join(root, relPath);
  return toPosix(path.relative(docsDir, abs));
}

function buildIndexFrontmatter(root, today) {
  const sha = shortHead(root);
  return [
    '---',
    'doc_type: index',
    'purpose: "Index of every documentation file; regenerate with pnpm docs:index."',
    'audience: both',
    `last_verified: ${today}`,
    `last_verified_commit: ${sha}`,
    'related_files:',
    '---',
    '',
  ].join('\n');
}

function buildIndexBody(root, docs) {
  const lines = [];
  lines.push('# Documentation index');
  lines.push('');
  lines.push(
    'Every documentation file in the repo, grouped by type. Generated by `pnpm docs:index`; do not edit by hand.',
  );
  lines.push('');
  for (const type of TYPE_ORDER) {
    const list = docs.filter((d) => d.doc_type === type);
    if (list.length === 0) continue;
    if (type === 'decision') {
      list.sort((a, b) => adrNumber(a.relPath) - adrNumber(b.relPath));
    } else {
      list.sort((a, b) => a.relPath.localeCompare(b.relPath));
    }
    lines.push(`## ${TYPE_TITLES[type]}`);
    lines.push('');
    if (type === 'decision') {
      lines.push('| Doc | Purpose | Last verified | Status |');
      lines.push('|---|---|---|---|');
      for (const d of list) {
        lines.push(
          `| [${d.relPath}](${linkFromDocsDir(root, d.relPath)}) | ${d.purpose} | ${d.last_verified} | ${d.adr_status ?? ''} |`,
        );
      }
    } else {
      lines.push('| Doc | Purpose | Last verified |');
      lines.push('|---|---|---|');
      for (const d of list) {
        lines.push(
          `| [${d.relPath}](${linkFromDocsDir(root, d.relPath)}) | ${d.purpose} | ${d.last_verified} |`,
        );
      }
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd() + '\n';
}

function collectIndexableDocs(root, docSet) {
  const docs = [];
  for (const relPath of docSet) {
    if (relPath === 'CHANGELOG.md' || relPath === 'docs/README.md') continue;
    const abs = path.join(root, relPath);
    const content = fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
    const fm = parseFrontmatter(content);
    if (!fm.present || fm.error || !fm.data) continue;
    const { doc_type, purpose, last_verified, adr_status } = fm.data;
    if (!doc_type || !DOC_TYPES.includes(doc_type) || doc_type === 'index') continue;
    if (!purpose || !last_verified) continue;
    docs.push({ relPath, doc_type, purpose, last_verified, adr_status });
  }
  return docs;
}

function generateIndexContent(root, docSet, today) {
  const docs = collectIndexableDocs(root, docSet);
  return buildIndexFrontmatter(root, today) + '\n' + buildIndexBody(root, docs);
}

function stripVolatileLines(content) {
  return content
    .split('\n')
    .map((l) => {
      if (/^last_verified: \d{4}-\d{2}-\d{2}$/.test(l)) return 'last_verified: <ignored>';
      if (/^last_verified_commit: [0-9a-f]{7,40}$/.test(l))
        return 'last_verified_commit: <ignored>';
      return l;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  let write = false;
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--write') {
      write = true;
    } else if (a === '--file') {
      i++;
      if (i >= argv.length) throw new UsageError('--file requires a path argument');
      files.push(argv[i]);
    } else {
      throw new UsageError(`unknown argument: ${a}`);
    }
  }
  return { write, files };
}

function main() {
  const { write, files } = parseArgs(process.argv.slice(2));
  const root = findRepoRoot();
  const today = todayLocal();
  // CI runners and contributors sit in different time zones; allow one day of slack.
  const maxDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10) > today ? d.toISOString().slice(0, 10) : today;
  })();
  const gitAvailable = isGitAvailable(root);
  const allowlist = loadAllowlist(root);

  const issuesByFile = new Map();
  const unknownKeyOccurrences = new Map(); // key -> Set<relPath>

  const ctx = {
    today,
    maxDate,
    gitAvailable,
    allowlist,
    addIssue(relPath, level, message) {
      if (!issuesByFile.has(relPath)) issuesByFile.set(relPath, { errors: [], warnings: [] });
      issuesByFile.get(relPath)[level === 'error' ? 'errors' : 'warnings'].push(message);
    },
    recordUnknownKey(key, relPath) {
      if (!unknownKeyOccurrences.has(key)) unknownKeyOccurrences.set(key, new Set());
      unknownKeyOccurrences.get(key).add(relPath);
    },
  };

  const fileMode = files.length > 0;

  if (fileMode) {
    for (const f of files) {
      const relPath = toPosix(path.isAbsolute(f) ? path.relative(root, f) : f);
      const abs = path.join(root, relPath);
      if (!fs.existsSync(abs)) {
        throw new UsageError(`--file target does not exist: ${f}`);
      }
      checkDoc(root, relPath, {}, ctx);
    }
  } else {
    if (write) {
      const docSetBefore = listDocSet(root);
      const content = generateIndexContent(root, docSetBefore, today);
      fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(root, 'docs', 'README.md'), content, 'utf8');
    }

    const docSet = listDocSet(root);
    const indexPath = 'docs/README.md';
    const indexExists = fs.existsSync(path.join(root, indexPath));

    if (!indexExists) {
      ctx.addIssue(indexPath, 'error', 'index missing, run --write');
    }

    for (const relPath of docSet) {
      checkDoc(root, relPath, {}, ctx);
    }

    if (indexExists) {
      const expected = generateIndexContent(root, docSet, today);
      const actual = fs.readFileSync(path.join(root, indexPath), 'utf8').replace(/\r\n/g, '\n');
      if (stripVolatileLines(expected) !== stripVolatileLines(actual)) {
        ctx.addIssue(indexPath, 'error', 'index out of date, run `pnpm docs:index`');
      }
    }

    checkAdrSet(root, ctx);
  }

  // Finalize unknown-key severities.
  const distinctUnknownKeys = unknownKeyOccurrences.size;
  for (const [key, files_] of unknownKeyOccurrences) {
    const severity = files_.size >= 2 || distinctUnknownKeys >= 2 ? 'error' : 'warn';
    for (const relPath of files_) {
      ctx.addIssue(relPath, severity, `unknown frontmatter key: "${key}"`);
    }
  }

  // Report
  let errorCount = 0;
  let warningCount = 0;
  const sortedFiles = [...issuesByFile.keys()].sort();
  for (const relPath of sortedFiles) {
    const { errors, warnings } = issuesByFile.get(relPath);
    for (const e of errors) {
      console.info(`${relPath}: ${e}`);
      errorCount++;
    }
    for (const w of warnings) {
      console.info(`${relPath}: ${w}`);
      warningCount++;
    }
  }
  const fileCount = fileMode ? files.length : listDocSet(root).length;
  console.info(`check-docs: ${errorCount} errors, ${warningCount} warnings, ${fileCount} files`);

  process.exit(errorCount > 0 ? 1 : 0);
}

try {
  main();
} catch (e) {
  if (e instanceof UsageError) {
    console.error(`check-docs: ${e.message}`);
    process.exit(2);
  }
  console.error(e.stack || String(e));
  process.exit(2);
}
