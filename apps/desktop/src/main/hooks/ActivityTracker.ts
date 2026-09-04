import type { HookEnvelope, Stimulus } from '@claude-mons/shared';

export interface SessionActivity {
  inFlight: Set<string>;
  /** a turn is in progress between UserPromptSubmit and Stop */
  midTurn: boolean;
  lastEventAt: number;
}

export interface ActivitySnapshot {
  inFlightTools: number;
  midTurnSessions: number;
  lastEventAt: number;
  sessions: number;
}

/** Sessions silent for this long are forgotten (Claude Code crashed, terminal closed, ...). */
const SESSION_TTL_MS = 30 * 60 * 1000;
/** A tool that never reports PostToolUse is considered finished after this long. */
const TOOL_TTL_MS = 10 * 60 * 1000;

/**
 * Collapses hook events from any number of concurrent Claude Code sessions into one activity
 * snapshot for the pet: working if any session has a tool in flight, thinking if any is mid-turn.
 * Also translates envelopes into behavior stimuli.
 */
export class ActivityTracker {
  private readonly sessions = new Map<string, SessionActivity>();
  private readonly toolStarted = new Map<string, number>();

  ingest(env: HookEnvelope, now = Date.now()): Stimulus[] {
    const key = env.session_id ?? 'unknown';
    const s = this.sessions.get(key) ?? {
      inFlight: new Set<string>(),
      midTurn: false,
      lastEventAt: now,
    };
    s.lastEventAt = now;
    this.sessions.set(key, s);
    const out: Stimulus[] = [];

    switch (env.event) {
      case 'SessionStart':
        out.push({ type: 'hook:session_start' });
        break;
      case 'UserPromptSubmit':
        s.midTurn = true;
        out.push({ type: 'hook:prompt' });
        break;
      case 'PreToolUse': {
        const id = env.tool_use_id ?? `${key}:${env.tool_name ?? 'tool'}:${now}`;
        s.inFlight.add(id);
        this.toolStarted.set(id, now);
        s.midTurn = true;
        out.push({ type: 'hook:tool_start' });
        break;
      }
      case 'PostToolUse': {
        if (env.tool_use_id) {
          s.inFlight.delete(env.tool_use_id);
          this.toolStarted.delete(env.tool_use_id);
        } else if (s.inFlight.size > 0) {
          // no id: assume the oldest in-flight tool finished
          const first = s.inFlight.values().next().value;
          if (first) {
            s.inFlight.delete(first);
            this.toolStarted.delete(first);
          }
        }
        out.push({ type: 'hook:tool_end' });
        break;
      }
      case 'Notification':
        out.push({ type: 'hook:notification' });
        break;
      case 'Stop':
        s.midTurn = false;
        s.inFlight.clear();
        out.push({ type: 'hook:stop' });
        break;
      case 'SessionEnd':
        this.sessions.delete(key);
        out.push({ type: 'hook:session_end' });
        break;
    }

    this.prune(now);
    out.push(this.snapshotStimulus(now));
    return out;
  }

  snapshot(now = Date.now()): ActivitySnapshot {
    this.prune(now);
    let inFlightTools = 0;
    let midTurnSessions = 0;
    let lastEventAt = 0;
    for (const s of this.sessions.values()) {
      inFlightTools += s.inFlight.size;
      if (s.midTurn) midTurnSessions++;
      lastEventAt = Math.max(lastEventAt, s.lastEventAt);
    }
    return { inFlightTools, midTurnSessions, lastEventAt, sessions: this.sessions.size };
  }

  snapshotStimulus(now = Date.now()): Stimulus {
    const snap = this.snapshot(now);
    return {
      type: 'activity:update',
      inFlightTools: snap.inFlightTools,
      midTurnSessions: snap.midTurnSessions,
      lastEventAt: snap.lastEventAt,
    };
  }

  private prune(now: number): void {
    for (const [key, s] of this.sessions) {
      if (now - s.lastEventAt > SESSION_TTL_MS) {
        for (const id of s.inFlight) this.toolStarted.delete(id);
        this.sessions.delete(key);
        continue;
      }
      for (const id of s.inFlight) {
        const started = this.toolStarted.get(id) ?? now;
        if (now - started > TOOL_TTL_MS) {
          s.inFlight.delete(id);
          this.toolStarted.delete(id);
        }
      }
    }
  }
}
