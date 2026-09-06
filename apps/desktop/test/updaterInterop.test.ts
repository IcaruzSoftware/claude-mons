import { describe, expect, it } from 'vitest';
import { describeUpdateError, pickAutoUpdater } from '../src/main/updater/interop.ts';

const fake = () => ({
  autoDownload: false,
  autoInstallOnAppQuit: false,
  on: () => undefined,
  checkForUpdates: async () => null,
  quitAndInstall: () => undefined,
});

describe('pickAutoUpdater', () => {
  it('accepts the named export shape', () => {
    const u = fake();
    expect(pickAutoUpdater({ autoUpdater: u })).toBe(u);
  });

  it('falls back to the CommonJS default export shape', () => {
    const u = fake();
    expect(pickAutoUpdater({ autoUpdater: undefined, default: { autoUpdater: u } })).toBe(u);
  });

  it('throws a clear error when neither shape is present', () => {
    expect(() => pickAutoUpdater({ default: {} })).toThrow(/did not expose autoUpdater/);
    expect(() => pickAutoUpdater(undefined)).toThrow();
  });
});

describe('describeUpdateError', () => {
  it('explains a missing release', () => {
    const msg = describeUpdateError(
      new Error('HttpError: 404 "method: GET url: https://github.com/.../latest.yml"'),
    );
    expect(msg).toMatch(/No release has been published yet/);
  });

  it('explains a network failure', () => {
    expect(describeUpdateError(new Error('getaddrinfo ENOTFOUND github.com'))).toMatch(
      /Could not reach GitHub/,
    );
  });

  it('keeps unknown errors to one short line', () => {
    const msg = describeUpdateError(new Error(`${'x'.repeat(300)}\nsecond line`));
    expect(msg.length).toBeLessThanOrEqual(160);
    expect(msg).not.toMatch(/second line/);
  });
});
