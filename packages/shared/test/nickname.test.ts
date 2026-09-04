import { describe, expect, it } from 'vitest';
import {
  BLOCKLIST,
  NICKNAME_RE,
  RESERVED,
  generateNickname,
  normalizeForBlocklist,
  validateNickname,
} from '../src/game/nickname.ts';

describe('NICKNAME_RE', () => {
  it('accepts 3-16 word characters and rejects everything else', () => {
    expect(NICKNAME_RE.test('abc')).toBe(true);
    expect(NICKNAME_RE.test('Trainer_4821')).toBe(true);
    expect(NICKNAME_RE.test('a'.repeat(16))).toBe(true);
    expect(NICKNAME_RE.test('ab')).toBe(false);
    expect(NICKNAME_RE.test('a'.repeat(17))).toBe(false);
    expect(NICKNAME_RE.test('with space')).toBe(false);
    expect(NICKNAME_RE.test('dash-name')).toBe(false);
    expect(NICKNAME_RE.test('ümlaut')).toBe(false);
    expect(NICKNAME_RE.test('')).toBe(false);
  });
});

describe('normalizeForBlocklist', () => {
  it('lowercases, undoes leetspeak and strips underscores', () => {
    expect(normalizeForBlocklist('H3ll0_W0r1d')).toBe('helloworid');
    expect(normalizeForBlocklist('Sh1t')).toBe('shit');
    expect(normalizeForBlocklist('A55')).toBe('ass');
    expect(normalizeForBlocklist('__7e5t__')).toBe('test');
    expect(normalizeForBlocklist('plain')).toBe('plain');
  });
});

describe('validateNickname', () => {
  it('accepts ordinary names', () => {
    expect(validateNickname('Trainer_4821')).toEqual({ ok: true });
    expect(validateNickname('gerrit')).toEqual({ ok: true });
    expect(validateNickname('Pixel42')).toEqual({ ok: true });
  });

  it('rejects bad format', () => {
    expect(validateNickname('ab')).toEqual({ ok: false, reason: 'format' });
    expect(validateNickname('has space')).toEqual({ ok: false, reason: 'format' });
    expect(validateNickname('x'.repeat(17))).toEqual({ ok: false, reason: 'format' });
  });

  it('rejects reserved names case-insensitively and through leetspeak', () => {
    for (const r of RESERVED) {
      expect(validateNickname(r).ok).toBe(false);
      expect(validateNickname(r.toUpperCase()).ok).toBe(false);
    }
    expect(validateNickname('Admin')).toEqual({ ok: false, reason: 'reserved' });
    expect(validateNickname('ADM1N')).toEqual({ ok: false, reason: 'reserved' });
    expect(validateNickname('c1aude')).toEqual({ ok: true }); // 1 -> i, not l
    expect(validateNickname('Cl4ude')).toEqual({ ok: false, reason: 'reserved' });
    expect(validateNickname('_system_')).toEqual({ ok: false, reason: 'reserved' });
    // the Wild Mon prefix is reserved for bots
    expect(validateNickname('Wild_Sparkit')).toEqual({ ok: false, reason: 'reserved' });
  });

  it('rejects blocklisted words as whole tokens, including leetspeak and split letters', () => {
    for (const w of BLOCKLIST) {
      expect(validateNickname(`${w}_42`.slice(0, 16)).ok).toBe(false);
      expect(validateNickname(`Big${w[0]!.toUpperCase()}${w.slice(1)}`.slice(0, 16)).ok).toBe(
        false,
      );
    }
    expect(validateNickname('xX_Sh1t_Xx')).toEqual({ ok: false, reason: 'blocked' });
    expect(validateNickname('F_U_C_K')).toEqual({ ok: false, reason: 'blocked' });
    expect(validateNickname('ShitLord')).toEqual({ ok: false, reason: 'blocked' });
    expect(validateNickname('dumbfuck')).toEqual({ ok: false, reason: 'blocked' });
    expect(validateNickname('fucker99')).toEqual({ ok: false, reason: 'blocked' });
  });

  it('does not flag ordinary coder names that merely contain a blocked substring', () => {
    for (const name of ['Classic', 'Scunthorpe', 'Compiler', 'Debugger', 'Essex', 'Cumulus']) {
      expect(validateNickname(name)).toEqual({ ok: true });
    }
  });
});

describe('generateNickname', () => {
  it('is deterministic per seed and differs across seeds', () => {
    expect(generateNickname('uid-1')).toBe(generateNickname('uid-1'));
    expect(generateNickname(42)).toBe(generateNickname(42));
    const names = new Set(Array.from({ length: 200 }, (_, i) => generateNickname(`seed-${i}`)));
    expect(names.size).toBeGreaterThan(190);
  });

  it('matches the Word_1234 shape and always validates', () => {
    for (let i = 0; i < 2000; i++) {
      const name = generateNickname(i);
      expect(name).toMatch(/^[A-Z][a-z]+_\d{4}$/);
      expect(validateNickname(name)).toEqual({ ok: true });
    }
    for (let i = 0; i < 500; i++) {
      const name = generateNickname(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}:${i}`);
      expect(validateNickname(name)).toEqual({ ok: true });
    }
  });
});
