import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { computeEffectiveMode, probeBinary, type SpawnFn } from '../src/main/hooks/mode.ts';

class FakeChild extends EventEmitter {
  killed = false;
  stdin = { end: () => {} };
  kill(): void {
    this.killed = true;
  }
}

function fakeSpawn(behavior: (child: FakeChild) => void): SpawnFn {
  return (() => {
    const child = new FakeChild();
    setTimeout(() => behavior(child), 0);
    return child as unknown as ReturnType<SpawnFn>;
  }) as SpawnFn;
}

function throwingSpawn(err: NodeJS.ErrnoException): SpawnFn {
  return (() => {
    throw err;
  }) as unknown as SpawnFn;
}

describe('probeBinary', () => {
  it('resolves ok on exit code 0', async () => {
    const spawn = fakeSpawn((c) => c.emit('exit', 0, null));
    expect(await probeBinary('bin', 'home', spawn)).toBe('ok');
  });

  it('resolves blocked on exit code 126', async () => {
    const spawn = fakeSpawn((c) => c.emit('exit', 126, null));
    expect(await probeBinary('bin', 'home', spawn)).toBe('blocked');
  });

  it('resolves blocked on a signal or other nonzero exit', async () => {
    const bySignal = fakeSpawn((c) => c.emit('exit', null, 'SIGKILL'));
    expect(await probeBinary('bin', 'home', bySignal)).toBe('blocked');
    const byCode = fakeSpawn((c) => c.emit('exit', 1, null));
    expect(await probeBinary('bin', 'home', byCode)).toBe('blocked');
  });

  it('resolves missing on ENOENT spawn error', async () => {
    const err = Object.assign(new Error('nope'), { code: 'ENOENT' });
    const spawn = fakeSpawn((c) => c.emit('error', err));
    expect(await probeBinary('bin', 'home', spawn)).toBe('missing');
  });

  it('resolves blocked on EACCES/EPERM/UNKNOWN spawn errors, sync or async', async () => {
    const eacces = fakeSpawn((c) =>
      c.emit('error', Object.assign(new Error('x'), { code: 'EACCES' })),
    );
    expect(await probeBinary('bin', 'home', eacces)).toBe('blocked');
    const eperm = fakeSpawn((c) =>
      c.emit('error', Object.assign(new Error('x'), { code: 'EPERM' })),
    );
    expect(await probeBinary('bin', 'home', eperm)).toBe('blocked');
    const unknown = fakeSpawn((c) =>
      c.emit('error', Object.assign(new Error('x'), { code: 'UNKNOWN' })),
    );
    expect(await probeBinary('bin', 'home', unknown)).toBe('blocked');
    // spawnSync-style synchronous throw (e.g. Windows Smart App Control rejecting exec immediately)
    expect(
      await probeBinary(
        'bin',
        'home',
        throwingSpawn(Object.assign(new Error('x'), { code: 'UNKNOWN' })),
      ),
    ).toBe('blocked');
  });

  it('resolves blocked when the process never exits before the timeout', async () => {
    const spawn = fakeSpawn(() => {
      /* never emits exit or error */
    });
    expect(await probeBinary('bin', 'home', spawn, 20)).toBe('blocked');
  });

  it('passes --event SessionStart --home <homeDir> and empty stdin', async () => {
    let seenArgs: readonly string[] = [];
    const spawn: SpawnFn = ((path: string, args: readonly string[]) => {
      seenArgs = args;
      const child = new FakeChild();
      setTimeout(() => child.emit('exit', 0, null), 0);
      return child as unknown as ReturnType<SpawnFn>;
    }) as SpawnFn;
    await probeBinary('/bin/claude-mons-hook', '/home/user/.claude-mons', spawn);
    expect(seenArgs).toEqual(['--event', 'SessionStart', '--home', '/home/user/.claude-mons']);
  });
});

describe('computeEffectiveMode', () => {
  it('an explicit binary/script preference always wins over the probe', () => {
    expect(computeEffectiveMode('binary', 'blocked')).toBe('binary');
    expect(computeEffectiveMode('binary', 'missing')).toBe('binary');
    expect(computeEffectiveMode('script', 'ok')).toBe('script');
  });

  it('auto follows the probe: ok -> binary, otherwise script', () => {
    expect(computeEffectiveMode('auto', 'ok')).toBe('binary');
    expect(computeEffectiveMode('auto', 'blocked')).toBe('script');
    expect(computeEffectiveMode('auto', 'missing')).toBe('script');
    expect(computeEffectiveMode('auto', null)).toBe('script');
  });
});
