/**
 * Headless behavior-engine runner.
 *
 *   node --experimental-strip-types scripts/sim.ts <script.json>
 *
 * Script format:
 * {
 *   "stage": "baby", "seed": 1, "x": 500,
 *   "world": { "minX": 0, "maxX": 1000, "groundY": 500 },
 *   "timeline": [ { "at": 0, "stimulus": { "type": "hook:prompt" } } ],
 *   "expect": [ { "at": 1500, "state": "thinking" } ],       // state may also be a string[]
 *   "durationMs": 20000, "stepMs": 16
 * }
 *
 * Prints the state timeline and exits 1 with a readable diff when an expectation fails.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createModel,
  isPetState,
  isStage,
  stepBehavior,
  type BehaviorModel,
  type Effect,
  type PetState,
  type Stage,
  type Stimulus,
  type World,
} from '../src/index.ts';

interface TimelineEntry {
  at: number;
  stimulus: Stimulus;
}

interface Expectation {
  at: number;
  state: PetState | PetState[];
}

interface SimScript {
  stage?: Stage;
  seed?: number;
  x?: number;
  world?: World;
  timeline?: TimelineEntry[];
  expect?: Expectation[];
  durationMs?: number;
  stepMs?: number;
}

interface Failure {
  at: number;
  checkedAt: number;
  expected: string;
  actual: PetState;
  since: number;
}

const out = (line: string) => process.stdout.write(line + '\n');
const fail = (msg: string): never => {
  process.stderr.write(msg + '\n');
  process.exit(1);
};

function loadScript(path: string): Required<SimScript> {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    return fail(`sim: cannot read ${path}: ${(err as Error).message}`);
  }
  const s = raw as SimScript;
  const stage = s.stage ?? 'baby';
  if (!isStage(stage)) return fail(`sim: unknown stage ${JSON.stringify(stage)}`);
  const world = s.world ?? { minX: 0, maxX: 1000, groundY: 500 };
  const timeline = [...(s.timeline ?? [])].sort((a, b) => a.at - b.at);
  const expectations = [...(s.expect ?? [])].sort((a, b) => a.at - b.at);
  for (const e of expectations) {
    const states = Array.isArray(e.state) ? e.state : [e.state];
    for (const st of states) {
      if (!isPetState(st)) return fail(`sim: expectation at ${e.at} names unknown state ${st}`);
    }
  }
  return {
    stage,
    seed: s.seed ?? 1,
    x: s.x ?? (world.minX + world.maxX) / 2,
    world,
    timeline,
    expect: expectations,
    durationMs: s.durationMs ?? 20000,
    stepMs: s.stepMs ?? 16,
  };
}

function fmtTime(ms: number): string {
  return `${String(Math.round(ms)).padStart(7)} ms`;
}

function describeEffect(e: Effect): string | null {
  switch (e.type) {
    case 'state-changed':
      return null;
    case 'request-battle':
      return 'effect: request-battle';
    case 'landed':
      return 'effect: landed';
    case 'wake':
      return 'effect: wake';
  }
}

function main(): void {
  const arg = process.argv[2];
  if (!arg) fail('usage: sim <script.json>');
  const path = resolve(process.cwd(), arg!);
  const script = loadScript(path);

  let model: BehaviorModel = createModel({
    stage: script.stage,
    world: script.world,
    now: 0,
    seed: script.seed,
    x: script.x,
  });

  out(`sim: ${path}`);
  out(
    `stage=${script.stage} seed=${script.seed} world=[${script.world.minX}..${script.world.maxX}] ` +
      `ground=${script.world.groundY} duration=${script.durationMs}ms step=${script.stepMs}ms`,
  );
  out('');
  out(`${fmtTime(0)}  start           -> ${model.state}`);

  const failures: Failure[] = [];
  const seen = new Set<PetState>([model.state]);
  let ti = 0;
  let ei = 0;
  let t = 0;
  while (t < script.durationMs) {
    t = Math.min(t + script.stepMs, script.durationMs);
    const stimuli: Stimulus[] = [];
    const names: string[] = [];
    while (ti < script.timeline.length && script.timeline[ti]!.at <= t) {
      stimuli.push(script.timeline[ti]!.stimulus);
      names.push(script.timeline[ti]!.stimulus.type);
      ti++;
    }
    const res = stepBehavior(model, stimuli, t);
    model = res.model;
    seen.add(model.state);
    for (const e of res.effects) {
      if (e.type === 'state-changed') {
        const via = names.length > 0 ? `  (${names.join(', ')})` : '';
        out(`${fmtTime(t)}  ${e.from.padEnd(15)} -> ${e.to}${via}`);
      } else {
        const text = describeEffect(e);
        if (text) out(`${fmtTime(t)}  ${text}`);
      }
    }
    while (ei < script.expect.length && script.expect[ei]!.at <= t) {
      const exp = script.expect[ei]!;
      const allowed = Array.isArray(exp.state) ? exp.state : [exp.state];
      if (!allowed.includes(model.state)) {
        failures.push({
          at: exp.at,
          checkedAt: t,
          expected: allowed.join(' | '),
          actual: model.state,
          since: model.stateSince,
        });
      }
      ei++;
    }
  }

  out('');
  out(`final: ${model.state} at x=${model.pos.x.toFixed(1)} y=${model.pos.y.toFixed(1)}`);
  out(`states seen: ${[...seen].join(', ')}`);
  const unchecked = script.expect.length - ei;
  if (unchecked > 0) {
    out(`warning: ${unchecked} expectation(s) lie beyond durationMs and were not checked`);
  }

  if (failures.length > 0) {
    out('');
    out(`FAILED ${failures.length}/${script.expect.length} expectation(s):`);
    for (const f of failures) {
      out(
        `  at ${f.at} ms (checked at ${f.checkedAt} ms): expected ${f.expected}, ` +
          `got ${f.actual} (since ${f.since} ms)`,
      );
    }
    process.exit(1);
  }
  out(`OK ${ei}/${script.expect.length} expectation(s) passed`);
}

main();
