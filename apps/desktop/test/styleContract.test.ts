import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Style contract: every class name a renderer writes into the DOM must exist as a selector in a
 * stylesheet that renderer actually loads. The 0.2.0 panel redesign rewrote `panel.css` wholesale
 * and silently dropped rules the TSX still used (the loadout editor lost its overlay), which no
 * test caught. Comment-stripping matters: a dropped class can survive inside a CSS comment.
 */

const ALLOWED_UNSTYLED = new Set([
  // Marker classes deliberately left unstyled (sized by SVG attributes, not CSS).
  'glyph',
]);

const BACKSLASH = String.fromCharCode(92);
const root = resolve(import.meta.dirname, '..');
const ENTRIES = [
  'src/renderer/panel/main.tsx',
  'src/renderer/hovercard/main.tsx',
  'src/renderer/reminder/main.tsx',
];

/** Follows relative imports from an entry and splits them into modules and stylesheets. */
function moduleGraph(entry: string): { modules: string[]; styles: string[] } {
  const modules: string[] = [];
  const styles: string[] = [];
  const seen = new Set<string>();
  const queue = [resolve(root, entry)];
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (file.endsWith('.css')) {
      styles.push(file);
      continue;
    }
    modules.push(file);
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
      queue.push(resolve(dirname(file), m[1]!));
    }
  }
  return { modules, styles };
}

/** Reads a quoted or backticked literal starting at `i`; returns its raw body and the end index. */
function readLiteral(src: string, i: number): { body: string; end: number } {
  const quote = src[i];
  let out = '';
  let j = i + 1;
  while (j < src.length && src[j] !== quote) {
    if (src[j] === BACKSLASH) {
      out += src[j + 1] ?? '';
      j += 2;
      continue;
    }
    out += src[j];
    j++;
  }
  return { body: out, end: j + 1 };
}

/** True for a literal compared against rather than rendered (`scope === 'weekly' ? … : …`). */
function isComparisonOperand(expr: string, start: number, end: number): boolean {
  const before = expr.slice(0, start).trimEnd();
  const after = expr.slice(end).trimStart();
  return /[=!]==?$/.test(before) || /^[=!]==?/.test(after);
}

/**
 * Static class tokens in a `class=` expression. Tokens glued to a `${…}` interpolation (`tint-`,
 * `p` in `` `p${place}` ``) are dynamic and dropped; string literals inside an interpolation
 * (`isActive ? 'active' : ''`) are static and kept.
 */
function classTokens(expr: string): string[] {
  const out: string[] = [];
  const push = (chunk: string) => {
    for (const t of chunk.split(/\s+/)) if (/^[a-z][a-z0-9-]*$/i.test(t)) out.push(t);
  };
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === "'" || c === '"') {
      const { body, end } = readLiteral(expr, i);
      if (!isComparisonOperand(expr, i, end)) push(body);
      i = end - 1;
    } else if (c === '`') {
      let j = i + 1;
      let chunk = '';
      let leadingIsPartial = false;
      while (j < expr.length && expr[j] !== '`') {
        if (expr[j] === BACKSLASH) {
          chunk += expr[j + 1] ?? '';
          j += 2;
          continue;
        }
        if (expr[j] === '$' && expr[j + 1] === '{') {
          // Trailing partial token before the interpolation is dynamic.
          push(trim(chunk, leadingIsPartial, !/\s$/.test(chunk)));
          let depth = 1;
          let inner = '';
          j += 2;
          while (j < expr.length && depth > 0) {
            if (expr[j] === "'" || expr[j] === '"' || expr[j] === '`') {
              const lit = readLiteral(expr, j);
              inner += expr[j] + lit.body + expr[j];
              j = lit.end;
              continue;
            }
            if (expr[j] === '{') depth++;
            if (expr[j] === '}') depth--;
            if (depth > 0) inner += expr[j];
            j++;
          }
          out.push(...classTokens(inner));
          chunk = '';
          leadingIsPartial = j < expr.length && !/\s/.test(expr[j] ?? ' ');
          continue;
        }
        chunk += expr[j];
        j++;
      }
      push(trim(chunk, leadingIsPartial, false));
      i = j;
    }
  }
  return out;
}

/** Drops the first and/or last whitespace-delimited token of a template chunk. */
function trim(chunk: string, dropFirst: boolean, dropLast: boolean): string {
  const parts = chunk.split(/\s+/);
  if (dropFirst) parts.shift();
  if (dropLast) parts.pop();
  return parts.join(' ');
}

/** Every `class="…"` / `class={…}` expression in a TSX source, braces balanced. */
function classExpressions(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/\bclass=/g)) {
    let i = m.index + m[0].length;
    if (src[i] === '"' || src[i] === "'") {
      const { body } = readLiteral(src, i);
      out.push(JSON.stringify(body));
      continue;
    }
    if (src[i] !== '{') continue;
    let depth = 0;
    const start = i;
    while (i < src.length) {
      const c = src[i];
      if (c === "'" || c === '"' || c === '`') {
        i = readLiteral(src, i).end;
        continue;
      }
      if (c === '{') depth++;
      if (c === '}' && --depth === 0) break;
      i++;
    }
    out.push(src.slice(start + 1, i));
  }
  return out;
}

/** Class selectors defined in a stylesheet, comments removed. */
function definedClasses(css: string): Set<string> {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const names = new Set<string>();
  for (const rule of stripped.matchAll(/([^{}]+)\{/g)) {
    const prelude = rule[1]!.trim();
    if (prelude.startsWith('@')) continue; // at-rule prelude; its nested rules match separately
    for (const cls of prelude.matchAll(/\.(-?[a-z_][a-z0-9_-]*)/gi)) names.add(cls[1]!);
  }
  return names;
}

describe.each(ENTRIES)('%s', (entry) => {
  const { modules, styles } = moduleGraph(entry);
  const defined = new Set<string>();
  for (const f of styles) for (const n of definedClasses(readFileSync(f, 'utf8'))) defined.add(n);

  it('loads at least one stylesheet and some components', () => {
    expect(styles.length).toBeGreaterThan(0);
    expect(modules.length).toBeGreaterThan(1);
  });

  it('uses only class names its stylesheets define', () => {
    const missing: string[] = [];
    for (const file of modules) {
      if (!file.endsWith('.tsx')) continue;
      const src = readFileSync(file, 'utf8');
      for (const expr of classExpressions(src)) {
        for (const token of classTokens(expr)) {
          if (!defined.has(token) && !ALLOWED_UNSTYLED.has(token)) missing.push(`${relative(root, file)}: .${token}`);
        }
      }
    }
    expect([...new Set(missing)].sort()).toEqual([]);
  });
});
