import { promises as fs } from 'node:fs';
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

  private schedule(): void {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.writeNow();
    }, this.opts.debounceMs ?? 500);
  }

  private writeNow(): Promise<void> {
    this.dirty = false;
    const snapshot = JSON.stringify(this.get(), null, 2);
    this.writing = this.writing.then(async () => {
      const { path } = this.opts;
      await fs.mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      await fs.writeFile(tmp, snapshot, 'utf8');
      await fs.copyFile(path, `${path}.bak`).catch(() => {});
      await fs.rename(tmp, path);
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
