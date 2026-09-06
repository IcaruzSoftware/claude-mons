/**
 * electron-updater is a CommonJS package whose `autoUpdater` export is defined through a lazy
 * getter. Node's CJS→ESM named-export detection cannot see getters, so in the packaged (ESM) main
 * bundle `import('electron-updater')` yields a namespace whose `autoUpdater` is undefined while the
 * `default` export (module.exports) still carries it. This helper resolves either shape.
 */
/** The subset of update-event payloads the app reads. */
export interface UpdatePayload {
  version?: string;
  message?: string;
}

export interface AutoUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: string, listener: (payload: UpdatePayload) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(): void;
}

export function pickAutoUpdater(mod: unknown): AutoUpdaterLike {
  const candidates: unknown[] = [];
  if (mod && typeof mod === 'object') {
    const m = mod as Record<string, unknown>;
    candidates.push(m.autoUpdater);
    const def = m.default;
    if (def && typeof def === 'object')
      candidates.push((def as Record<string, unknown>).autoUpdater);
  }
  for (const c of candidates) {
    if (c && typeof (c as AutoUpdaterLike).checkForUpdates === 'function')
      return c as AutoUpdaterLike;
  }
  throw new Error('electron-updater did not expose autoUpdater (module shape not recognised)');
}

/** Turns electron-updater failures into one short line a user can act on. */
export function describeUpdateError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/404|latest\.yml|Cannot find|No published versions/i.test(raw)) {
    return 'No release has been published yet, so there is nothing to update to.';
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::ERR_/i.test(raw)) {
    return 'Could not reach GitHub to check for updates. Check your connection and try again.';
  }
  const firstLine = raw.split('\n')[0] ?? raw;
  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}...` : firstLine;
}
