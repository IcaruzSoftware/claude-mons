import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HookEnvelope } from '@claude-mons/shared';
import { ActivityTracker } from '../src/main/hooks/ActivityTracker.ts';
import { ENDPOINT_FILE, HookServer } from '../src/main/hooks/HookServer.ts';
import { SPOOL_FILE, SpoolDrainer } from '../src/main/hooks/SpoolDrainer.ts';

function env(partial: Partial<HookEnvelope> & { event: HookEnvelope['event'] }): HookEnvelope {
  return {
    v: 1,
    id: Math.random().toString(16).slice(2),
    ts: Date.now(),
    spooled: false,
    ...partial,
  };
}

describe('HookServer', () => {
  let home: string;
  beforeEach(async () => {
    home = await fs.mkdtemp(join(tmpdir(), 'cm-srv-'));
  });
  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  it('accepts authenticated events and rejects everything else', async () => {
    const received: HookEnvelope[] = [];
    const server = new HookServer({ home, onEvent: (e) => received.push(e) });
    await server.start();
    try {
      const ep = JSON.parse(await fs.readFile(join(home, ENDPOINT_FILE), 'utf8'));
      expect(ep.port).toBe(server.getPort());
      const url = `http://127.0.0.1:${ep.port}/event`;
      const body = JSON.stringify(env({ event: 'Stop', session_id: 's1' }));

      const ok = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${ep.token}`, 'content-type': 'application/json' },
        body,
      });
      expect(ok.status).toBe(204);

      const badToken = await fetch(url, {
        method: 'POST',
        headers: { authorization: 'Bearer nope' },
        body,
      });
      expect(badToken.status).toBe(404);
      const wrongPath = await fetch(`http://127.0.0.1:${ep.port}/other`, { method: 'POST', body });
      expect(wrongPath.status).toBe(404);
      const get = await fetch(url);
      expect(get.status).toBe(404);
      const malformed = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${ep.token}` },
        body: '{ nope',
      });
      expect(malformed.status).toBe(204);
      const invalidEnvelope = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${ep.token}` },
        body: JSON.stringify({ v: 1, id: 'x', ts: 1, event: 'NotAnEvent' }),
      });
      expect(invalidEnvelope.status).toBe(204);

      await new Promise((r) => setTimeout(r, 20));
      expect(received).toHaveLength(1);
      expect(received[0]?.event).toBe('Stop');
    } finally {
      await server.stop();
    }
    await expect(fs.stat(join(home, ENDPOINT_FILE))).rejects.toThrow();
  });
});

describe('SpoolDrainer', () => {
  it('drains valid lines, skips junk, marks events spooled and deletes the file', async () => {
    const home = await fs.mkdtemp(join(tmpdir(), 'cm-spool-'));
    const lines = [
      JSON.stringify(env({ event: 'UserPromptSubmit', session_id: 'a' })),
      'garbage',
      JSON.stringify({ v: 1, id: 'x', ts: 1, event: 'Bogus' }),
      JSON.stringify(env({ event: 'Stop', session_id: 'a' })),
      '',
    ];
    await fs.writeFile(join(home, SPOOL_FILE), lines.join('\n'));
    const got: HookEnvelope[] = [];
    const drainer = new SpoolDrainer(home, (e) => got.push(e));
    expect(await drainer.drain()).toBe(2);
    expect(got.map((e) => e.event)).toEqual(['UserPromptSubmit', 'Stop']);
    expect(got.every((e) => e.spooled)).toBe(true);
    expect((await fs.readdir(home)).filter((f) => f.startsWith(SPOOL_FILE))).toEqual([]);
    expect(await drainer.drain()).toBe(0);
    await fs.rm(home, { recursive: true, force: true });
  });
});

describe('ActivityTracker', () => {
  it('collapses two interleaved sessions into one snapshot', () => {
    const t = new ActivityTracker();
    let now = 1000;
    t.ingest(env({ event: 'UserPromptSubmit', session_id: 'A' }), now);
    t.ingest(env({ event: 'PreToolUse', session_id: 'A', tool_use_id: 'a1' }), (now += 10));
    t.ingest(env({ event: 'UserPromptSubmit', session_id: 'B' }), (now += 10));
    let snap = t.snapshot(now);
    expect(snap).toMatchObject({ inFlightTools: 1, midTurnSessions: 2, sessions: 2 });

    t.ingest(env({ event: 'PostToolUse', session_id: 'A', tool_use_id: 'a1' }), (now += 10));
    t.ingest(env({ event: 'Stop', session_id: 'A' }), (now += 10));
    snap = t.snapshot(now);
    expect(snap).toMatchObject({ inFlightTools: 0, midTurnSessions: 1 });

    const stimuli = t.ingest(env({ event: 'SessionEnd', session_id: 'B' }), (now += 10));
    expect(stimuli[0]).toEqual({ type: 'hook:session_end' });
    expect(t.snapshot(now)).toMatchObject({ sessions: 1, midTurnSessions: 0 }); // A remains, idle
  });

  it('forgets stale sessions and stuck tools', () => {
    const t = new ActivityTracker();
    t.ingest(env({ event: 'PreToolUse', session_id: 'A', tool_use_id: 'a1' }), 0);
    expect(t.snapshot(11 * 60 * 1000).inFlightTools).toBe(0); // tool TTL 10 min
    t.ingest(env({ event: 'UserPromptSubmit', session_id: 'A' }), 0);
    expect(t.snapshot(31 * 60 * 1000).sessions).toBe(0); // session TTL 30 min
  });

  it('translates events into behavior stimuli with a trailing activity snapshot', () => {
    const t = new ActivityTracker();
    const s = t.ingest(env({ event: 'PreToolUse', session_id: 'A', tool_use_id: 'x' }), 5);
    expect(s[0]).toEqual({ type: 'hook:tool_start' });
    expect(s[1]).toMatchObject({
      type: 'activity:update',
      inFlightTools: 1,
      midTurnSessions: 1,
      lastEventAt: 5,
    });
  });
});
