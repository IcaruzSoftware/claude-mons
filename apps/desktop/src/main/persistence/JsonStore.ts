import { promises as fs, copyFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type Migration = (state: Record<string, unknown>) => Record<string, unknown>;

export interface JsonStoreOptions<T> {
  path: string;
  /** Produces a fresh state when no file exists (or the file is unrecoverable). */
  defaults: () => T;
  /** migrations[i] upgrades schemaVersion i+1 -> i+2. Length + 1 == current schema version. */
  migrations: readonly Migration[];
  debounceMs?: number;
}

/**
 * Small atomic JSON store: writes go to `<path>.tmp` then rename, the previous good file is kept
 * as `<path>.bak`, loads fall back to `.bak`, then to defaults (keeping the corrupt file aside).
 * Writes are debounced; `flush()` forces one (call it on quit).
 */
export class JsonStore<T extends { schemaVersion: number }> {
  private state: T | null = null;
  private timer: NodeJS.Timeout | null = null;
  private writing: Promise<void> = Promise.resolve();
  private dirty = false;
  /** Monotonic mutation counter; `writtenRev` is the highest already persisted. Together they stop
   * an in-flight async write from renaming a stale snapshot over a newer `flushSync()`. */
  private rev = 0;
  private writtenRev = 0;

  constructor(private readonly opts: JsonStoreOptions<T>) {}

  get currentVersion(): number {
    return this.opts.migrations.length + 1;
  }

  async load(): Promise<T> {
    const loaded =
      (await this.readFile(this.opts.path)) ?? (await this.readFile(`${this.opts.path}.bak`));
    if (loaded === null) {
      this.state = this.opts.defaults();
      this.state.schemaVersion = this.currentVersion;
      return this.state;
    }
    this.state = this.migrate(loaded);
    return this.state;
  }

  get(): T {
    if (!this.state) throw new Error('JsonStore: load() first');
    return this.state;
  }

  /** Mutate the state in place and schedule a write. */
  update(fn: (state: T) => void): T {
    const s = this.get();
    fn(s);
    this.schedule();
    return s;
  }

  set(state: T): void {
    this.state = state;
    this.schedule();
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.dirty) await this.writeNow();
    await this.writing;
  }

  /**
   * Persist immediately and synchronously, bypassing the debounce. Used for state that must survive
   * a crash/kill/OS-shutdown the very next moment — chiefly the supabase-js auth session, whose
   * refresh token is rotated on every refresh: losing an already-rotated token to an un-flushed
   * debounced write is what silently signs the app out (see
   * `docs/architecture/flows/server-reconciliation.md`). Also called on `before-quit` so a normal
   * quit never loses the latest state. Atomic (own `.tmp-sync` so it cannot collide with an
   * in-flight async `writeNow`), and keeps a `.bak` like the async path.
   */
  flushSync(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty) return;
    this.dirty = false;
    const rev = this.rev;
    const { path } = this.opts;
    const snapshot = JSON.stringify(this.get(), null, 2);
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-sync`;
    writeFileSync(tmp, snapshot, 'utf8');
    try {
      copyFileSync(path, `${path}.bak`);
    } catch {
      /* no prior file yet */
    }
    renameSync(tmp, path);
    this.writtenRev = rev;
  }

  private schedule(): void {
    this.dirty = true;
    this.rev++;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.writeNow();
    }, this.opts.debounceMs ?? 500);
  }

  private writeNow(): Promise<void> {
    this.dirty = false;
    this.writing = this.writing.then(async () => {
      // Serialize at execution time, not at schedule time, and skip entirely once a newer write
      // (e.g. a synchronous `flushSync()` of a rotated auth session) has already landed — so a
      // slow async write can never rename a stale snapshot back over fresh state.
      const rev = this.rev;
      if (this.writtenRev >= rev) return;
      const snapshot = JSON.stringify(this.get(), null, 2);
      const { path } = this.opts;
      await fs.mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      await fs.writeFile(tmp, snapshot, 'utf8');
      await fs.copyFile(path, `${path}.bak`).catch(() => {});
      if (this.writtenRev >= rev) {
        await fs.rm(tmp).catch(() => {});
        return;
      }
      await fs.rename(tmp, path);
      this.writtenRev = rev;
    });
    return this.writing;
  }

  private async readFile(path: string): Promise<Record<string, unknown> | null> {
    let text: string;
    try {
      text = await fs.readFile(path, 'utf8');
    } catch {
      return null;
    }
    try {
      const parsed = JSON.parse(text) as unknown;
      if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
      return parsed as Record<string, unknown>;
    } catch {
      await fs.copyFile(path, `${this.opts.path}.corrupt-${Date.now()}.json`).catch(() => {});
      return null;
    }
  }

  private migrate(raw: Record<string, unknown>): T {
    let version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1;
    let state = raw;
    while (version < this.currentVersion) {
      const m = this.opts.migrations[version - 1];
      if (!m) break;
      state = m(state);
      version++;
      state.schemaVersion = version;
    }
    if (version > this.currentVersion) {
      // file from a newer app version: keep as much as possible
      state.schemaVersion = this.currentVersion;
    }
    return { ...this.opts.defaults(), ...state, schemaVersion: this.currentVersion } as T;
  }
}
