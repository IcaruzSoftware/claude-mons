/**
 * Nickname rules shared by the desktop app (instant feedback in Settings) and the Edge Function
 * `create-profile` (authoritative). Pure, Deno-compatible, no I/O.
 */

/** 3-16 chars, ASCII letters, digits and underscore. Mirrors the CHECK constraint on players.nickname. */
export const NICKNAME_RE = /^[A-Za-z0-9_]{3,16}$/;

/** Names that would impersonate the game, staff or the Wild Mon bot. Matched after normalization. */
export const RESERVED: readonly string[] = [
  'admin',
  'claude',
  'anthropic',
  'wild',
  'system',
  'mod',
  'staff',
  'moderator',
  'support',
];

/**
 * Small English profanity / slur blocklist. Matched as a substring of the normalized name, so
 * `xX_Sh1t_Xx` is caught. Deliberately short: false positives are worse than a missed word in a
 * game where nicknames are only ever shown on a leaderboard.
 */
export const BLOCKLIST: readonly string[] = [
  'anal',
  'anus',
  'arse',
  'ass',
  'ballsack',
  'bastard',
  'bitch',
  'blowjob',
  'boner',
  'boob',
  'clit',
  'cock',
  'coon',
  'cum',
  'cunt',
  'dick',
  'dildo',
  'douche',
  'dyke',
  'fag',
  'fuck',
  'handjob',
  'hitler',
  'jerkoff',
  'jizz',
  'kike',
  'nazi',
  'nigg',
  'penis',
  'piss',
  'porn',
  'prick',
  'pussy',
  'rape',
  'retard',
  'scrotum',
  'sex',
  'shit',
  'slut',
  'spic',
  'tits',
  'twat',
  'wank',
  'whore',
];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't' };

/** Lowercase, undo common leetspeak substitutions and strip underscores. */
export function normalizeForBlocklist(s: string): string {
  let out = '';
  for (const ch of s.toLowerCase()) {
    if (ch === '_') continue;
    out += LEET[ch] ?? ch;
  }
  return out;
}

export type NicknameValidation =
  { ok: true } | { ok: false; reason: 'format' | 'reserved' | 'blocked' };

/**
 * Tokens a nickname is checked as: the whole name, each `_`-separated part and each camelCase
 * part (`ShitLord_42` -> `shitlord42`, `shitlord`, `shit`, `lord`, `ai`), all leet-normalized.
 * Whole-token matching (not substring) so `Classic`, `Scunthorpe` and `Debugger` pass.
 */
export function nicknameTokens(s: string): string[] {
  const parts = s
    .split('_')
    .flatMap((p) => p.split(/(?<=[a-z])(?=[A-Z])/))
    .filter((p) => p.length > 0);
  const tokens = new Set<string>([normalizeForBlocklist(s)]);
  for (const p of s.split('_')) if (p) tokens.add(normalizeForBlocklist(p));
  for (const p of parts) tokens.add(normalizeForBlocklist(p));
  return [...tokens];
}

function tokenBlocked(token: string, word: string): boolean {
  if (token === word) return true;
  // longer words also match as prefix/suffix (`fucker`, `dumbfuck`); 3-letter words only exactly
  // (`ass`/`sex`/`cum` would otherwise hit `classic`, `essex`, `cumulus`).
  if (word.length >= 4 && (token.startsWith(word) || token.endsWith(word))) return true;
  return false;
}

export function validateNickname(s: string): NicknameValidation {
  if (typeof s !== 'string' || !NICKNAME_RE.test(s)) return { ok: false, reason: 'format' };
  const tokens = nicknameTokens(s);
  const whole = tokens[0]!;
  if (RESERVED.includes(whole)) return { ok: false, reason: 'reserved' };
  // "Wild <Species>" is how bots are shown; keep the prefix for them.
  if (whole.startsWith('wild')) return { ok: false, reason: 'reserved' };
  for (const word of BLOCKLIST) {
    for (const token of tokens) {
      if (tokenBlocked(token, word)) return { ok: false, reason: 'blocked' };
    }
  }
  return { ok: true };
}

const ADJECTIVES = [
  'Trainer',
  'Coder',
  'Hacker',
  'Builder',
  'Debugger',
  'Shipper',
  'Refactor',
  'Compiler',
  'Linter',
  'Deployer',
  'Prompter',
  'Tinkerer',
  'Pixel',
  'Byte',
  'Stack',
  'Kernel',
  'Merge',
  'Commit',
  'Branch',
  'Rebase',
  'Async',
  'Lambda',
  'Cursor',
  'Syntax',
  'Vector',
  'Turbo',
  'Nimble',
  'Quiet',
  'Brave',
  'Swift',
  'Lucky',
  'Cosmic',
] as const;

/** FNV-1a 32-bit over the UTF-16 code units. Deterministic and Deno/Node identical. */
function hashSeed(seed: number | string): number {
  const str = typeof seed === 'number' ? seed.toString(36) : seed;
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic auto nickname such as `Trainer_4821` or `Coder_0042`. The same seed always yields
 * the same name; pass `${uid}:${attempt}` to get a fresh candidate after a uniqueness conflict.
 * Every produced name passes `validateNickname`.
 */
export function generateNickname(seed: number | string): string {
  const base = typeof seed === 'number' ? seed.toString(36) : seed;
  // Leet normalization can turn digit runs into blocked words (`_4551` -> `assi`); rehash until
  // the candidate is clean. Still deterministic for a given seed.
  for (let attempt = 0; ; attempt++) {
    const h = hashSeed(attempt === 0 ? base : `${base}#${attempt}`);
    const word = ADJECTIVES[h % ADJECTIVES.length]!;
    const digits = ((h >>> 5) % 10000).toString().padStart(4, '0');
    const candidate = `${word}_${digits}`;
    if (validateNickname(candidate).ok) return candidate;
  }
}
