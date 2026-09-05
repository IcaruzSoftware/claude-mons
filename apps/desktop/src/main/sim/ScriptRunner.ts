import { readFileSync } from 'node:fs';
import { isNation, type Nation, type Stimulus } from '@claude-mons/shared';

export interface SimScript {
  timeline: Array<{ at: number; stimulus: Stimulus }>;
  /** Repeat the timeline every N ms (optional). */
  loopMs?: number;
}

/**
 * Drives the pet through a scripted timeline of stimuli, so animations can be reviewed without
 * running Claude Code. Started with `claude-mons --simulate <script.json>`.
 * The script format is shared with `pnpm sim` (packages/shared/scripts/sim.ts); only `timeline`
 * and `loopMs` are used here.
 */
export class ScriptRunner {
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly script: SimScript,
    private readonly send: (s: Stimulus) => void,
  ) {}

  static fromFile(path: string): ScriptRunner | null {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as SimScript;
      if (!Array.isArray(parsed.timeline)) throw new Error('script has no timeline');
      return new ScriptRunner(parsed, () => {});
    } catch (err) {
      console.error(`--simulate: cannot load ${path}:`, err);
      return null;
    }
  }

  withSender(send: (s: Stimulus) => void): ScriptRunner {
    return new ScriptRunner(this.script, send);
  }

  start(): void {
    const run = () => {
      for (const entry of this.script.timeline) {
        this.timers.push(setTimeout(() => this.send(entry.stimulus), entry.at));
      }
    };
    run();
    if (this.script.loopMs && this.script.loopMs > 0) {
      const loop = setInterval(run, this.script.loopMs);
      this.timers.push(loop as unknown as NodeJS.Timeout);
    }
    console.info(`--simulate: scheduled ${this.script.timeline.length} stimuli`);
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}

export function parseSimulateArg(argv: readonly string[]): string | null {
  return parseArg(argv, '--simulate');
}

/** `--capture <path>`: save a PNG of the pet window a few seconds after start (dev/CI aid). */
export function parseCaptureArg(argv: readonly string[]): string | null {
  return parseArg(argv, '--capture');
}

/** `--dev-nation <water|fire|earth|air>`: pick a nation on start (development only). */
export function parseDevNationArg(argv: readonly string[]): Nation | null {
  const v = parseArg(argv, '--dev-nation');
  return isNation(v) ? v : null;
}

/** `--dev-xp <n>`: grant XP shortly after start (development only). */
export function parseDevXpArg(argv: readonly string[]): number | null {
  const v = Number(parseArg(argv, '--dev-xp'));
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * `--dev-onboarding-step <n>`: open the onboarding wizard on step n instead of step 0 (development
 * only). Used to capture a screenshot of a specific step without driving the UI. Ignored once a
 * nation is chosen; the renderer clamps n to a valid step.
 */
export function parseDevOnboardingStepArg(argv: readonly string[]): number | null {
  const v = Number(parseArg(argv, '--dev-onboarding-step'));
  return Number.isFinite(v) && v >= 0 ? v : null;
}

function parseArg(argv: readonly string[], flag: string): string | null {
  const i = argv.indexOf(flag);
  if (i >= 0 && argv[i + 1]) return argv[i + 1]!;
  const eq = argv.find((a) => a.startsWith(`${flag}=`));
  return eq ? eq.slice(flag.length + 1) : null;
}
