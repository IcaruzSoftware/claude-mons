import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';

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
