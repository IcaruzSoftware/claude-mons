import { promises as fs, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonStore } from '../src/main/persistence/JsonStore.ts';

interface V1 {
  schemaVersion: number;
  name: string;
  xp?: number;
  progress?: { xp: number };
}

describe('JsonStore', () => {
  let dir: string;
  let path: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'cm-store-'));
    path = join(dir, 'state.json');
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const make = (migrations: Array<(s: Record<string, unknown>) => Record<string, unknown>> = []) =>
    new JsonStore<V1>({
      path,
      defaults: () => ({ schemaVersion: 1, name: 'egg' }),
      migrations,
      debounceMs: 5,
    });

  it('starts from defaults, persists atomically and keeps a backup of the previous file', async () => {
    const store = make();
    const s = await store.load();
    expect(s).toEqual({ schemaVersion: 1, name: 'egg' });
    store.update((st) => (st.name = 'sparkit'));
    await store.flush();
    expect(JSON.parse(await fs.readFile(path, 'utf8')).name).toBe('sparkit');
    store.update((st) => (st.name = 'blazebit'));
    await store.flush();
    expect(JSON.parse(await fs.readFile(`${path}.bak`, 'utf8')).name).toBe('sparkit');
    expect(JSON.parse(await fs.readFile(path, 'utf8')).name).toBe('blazebit');
    await expect(fs.stat(`${path}.tmp`)).rejects.toThrow();
  });

  it('recovers from a corrupt file via the backup and keeps the corrupt copy', async () => {
    await fs.writeFile(`${path}.bak`, JSON.stringify({ schemaVersion: 1, name: 'from-backup' }));
    await fs.writeFile(path, '{ corrupt');
    const s = await make().load();
    expect(s.name).toBe('from-backup');
    const files = await fs.readdir(dir);
    expect(files.some((f) => f.includes('.corrupt-'))).toBe(true);
  });

  it('applies migrations in order and stamps the version', async () => {
    await fs.writeFile(path, JSON.stringify({ schemaVersion: 1, name: 'x', xp: 42 }));
    const store = make([
      (s) => ({ ...s, progress: { xp: s.xp as number } }),
      (s) => {
        const { xp: _drop, ...rest } = s;
        return rest;
      },
    ]);
    const s = await store.load();
    expect(s.schemaVersion).toBe(3);
    expect(s.progress).toEqual({ xp: 42 });
    expect('xp' in s).toBe(false);
  });

  it('debounces writes', async () => {
    const store = make();
    await store.load();
    for (let i = 0; i < 50; i++) store.update((st) => (st.name = `n${i}`));
    await new Promise((r) => setTimeout(r, 30));
    expect(JSON.parse(await fs.readFile(path, 'utf8')).name).toBe('n49');
  });

  it('flushSync persists immediately and synchronously, bypassing the debounce', async () => {
    const store = make();
    await store.load();
    store.update((st) => (st.name = 'rotated-token'));
    store.flushSync();
    // Readable synchronously right after flushSync, without awaiting the debounce or any promise.
    expect(JSON.parse(readFileSync(path, 'utf8')).name).toBe('rotated-token');
  });

  it('flushSync keeps a backup and leaves no temp files behind', async () => {
    const store = make();
    await store.load();
    store.update((st) => (st.name = 'first'));
    store.flushSync();
    store.update((st) => (st.name = 'second'));
    store.flushSync();
    expect(JSON.parse(readFileSync(`${path}.bak`, 'utf8')).name).toBe('first');
    expect(JSON.parse(readFileSync(path, 'utf8')).name).toBe('second');
    await expect(fs.stat(`${path}.tmp-sync`)).rejects.toThrow();
  });

  it('an in-flight async write does not revert a value flushed synchronously afterwards', async () => {
    const store = make(); // 5 ms debounce
    await store.load();
    store.update((st) => (st.name = 'stale'));
    await new Promise((r) => setTimeout(r, 8)); // debounce fires: an async write is now in flight
    store.update((st) => (st.name = 'fresh')); // e.g. a rotated auth session
    store.flushSync();
    await store.flush(); // let the in-flight async write settle
    expect(JSON.parse(readFileSync(path, 'utf8')).name).toBe('fresh');
  });
});
