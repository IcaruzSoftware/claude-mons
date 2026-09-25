import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import type { HookMode } from './HookInstaller.ts';

/** Result of trying to actually run the installed hook binary. */
export type ProbeResult = 'ok' | 'blocked' | 'missing';

/** Configured hook mode preference, stored in `LocalState.hooks.mode`. */
export type HookModeSetting = 'auto' | 'binary' | 'script';

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: { stdio: ['pipe', 'ignore', 'ignore'] },
) => ChildProcess;

const DEFAULT_TIMEOUT_MS = 3000;

function classifySpawnError(err: unknown): ProbeResult {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT') return 'missing';
  // EACCES, EPERM, UNKNOWN (Windows Smart App Control) and anything else: treat as blocked.
  return 'blocked';
}

/**
 * Spawns the installed hook binary with `--event SessionStart --home <homeDir>` and empty stdin
 * to find out whether it can actually run (Windows Smart App Control blocks unsigned binaries at
 * exec time, not at file-copy time). Never throws.
 *
 * - `ENOENT` (spawn error): binary missing -> 'missing'
 * - `EACCES`/`EPERM`/other spawn errors, or exit code 126: blocked by OS policy -> 'blocked'
 * - exit code 0 (the binary's contract: always exits 0): 'ok'
 * - anything else, including a timeout: 'blocked' (conservative: fall back to script mode)
 */
export async function probeBinary(
  path: string,
  homeDir: string,
  spawnFn: SpawnFn = nodeSpawn as unknown as SpawnFn,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ProbeResult> {
  return new Promise<ProbeResult>((resolve) => {
    let settled = false;
    const finish = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let child: ChildProcess;
    try {
      child = spawnFn(path, ['--event', 'SessionStart', '--home', homeDir], {
        stdio: ['pipe', 'ignore', 'ignore'],
      });
    } catch (err) {
      finish(classifySpawnError(err));
      return;
    }

    const timer = setTimeout(() => {
      child.kill();
      finish('blocked');
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      finish(classifySpawnError(err));
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (signal || code !== 0) {
        finish('blocked');
        return;
      }
      finish('ok');
    });

    child.stdin?.end();
  });
}

/**
 * Resolves the mode hooks should actually be installed in. An explicit `binary`/`script`
 * preference always wins; `auto` uses the probe result (blocked or missing binary -> script).
 */
export function computeEffectiveMode(
  configured: HookModeSetting,
  probe: ProbeResult | null,
): 'binary' | 'script' {
  if (configured === 'binary' || configured === 'script') return configured;
  return probe === 'ok' ? 'binary' : 'script';
}

export interface NeedsReinstallArgs {
  /** Mode actually found on disk right now (from `statusOf`), or null if nothing/partial/unreadable. */
  installedMode: HookMode | null;
  /** Mode hooks should be installed in right now (`computeEffectiveMode`'s result). */
  effectiveMode: 'binary' | 'script';
  /** Whether we ourselves installed hooks before (`LocalState.hooks.installedAt`/`codexInstalledAt`). */
  wasInstalled: boolean;
  /** Whether the hook server picked a different port than last run (script mode only). */
  portChanged: boolean;
}

/**
 * Whether an agent's on-disk hooks need to be rewritten in place, without the user re-clicking
 * Connect: either the installed mode no longer matches the effective one (a binary <-> script
 * switch, e.g. the probe result changed), or the effective mode is script and the hook server's
 * port rotated since the last install (the port is embedded in the curl command, so a stale port
 * silently stops delivering events). Pure -- used by `App.applyHookModeForAgent` for both Claude
 * Code and Codex (see Review Focus 4 in the final whole-branch review: this was previously inline
 * and untested for the Codex path).
 *
 * `modeMismatch` is gated on `wasInstalled` so a mode we merely detect on disk (e.g. hooks someone
 * else's tool wrote in the same file, or a status still resolving from a fresh install we haven't
 * recorded yet) never triggers an unsolicited reinstall. `stalePort` has no such gate: a script-mode
 * command embeds the port directly, so any agent whose installed command still points at the old
 * port needs fixing regardless of whether *we* were the one who last wrote it.
 */
export function needsReinstall({
  installedMode,
  effectiveMode,
  wasInstalled,
  portChanged,
}: NeedsReinstallArgs): boolean {
  const modeMismatch = wasInstalled && installedMode !== null && installedMode !== effectiveMode;
  const stalePort = portChanged && installedMode === 'script';
  return modeMismatch || stalePort;
}
