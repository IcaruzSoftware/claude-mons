import { createServer, type Server } from 'node:http';
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

describe('HookServer /hook (script mode)', () => {
  let home: string;
  beforeEach(async () => {
    home = await fs.mkdtemp(join(tmpdir(), 'cm-srv-hook-'));
  });
  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  it('accepts the token header, replies 204, and delivers a converted envelope', async () => {
    const received: HookEnvelope[] = [];
    const scriptToken = 'x'.repeat(64);
    const server = new HookServer({ home, onEvent: (e) => received.push(e), scriptToken });
    await server.start();
    try {
      const url = `http://127.0.0.1:${server.getPort()}/hook`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'X-Claude-Mons-Token': scriptToken, 'content-type': 'application/json' },
        body: JSON.stringify({
          hook_event_name: 'UserPromptSubmit',
          session_id: 's1',
          cwd: 'C:/x',
          prompt: 'this must never reach the envelope',
        }),
      });
      expect(res.status).toBe(204);
      await new Promise((r) => setTimeout(r, 20));
      expect(received).toHaveLength(1);
      expect(received[0]?.event).toBe('UserPromptSubmit');
      expect(received[0]?.session_id).toBe('s1');
      expect(JSON.stringify(received[0])).not.toContain('prompt');
    } finally {
      await server.stop();
    }
  });

  it('rejects a wrong or missing token with 404, indistinguishable from a bad path', async () => {
    const scriptToken = 'y'.repeat(64);
    const server = new HookServer({ home, onEvent: () => {}, scriptToken });
    await server.start();
    try {
      const url = `http://127.0.0.1:${server.getPort()}/hook`;
      const wrongToken = await fetch(url, {
        method: 'POST',
        headers: { 'X-Claude-Mons-Token': 'nope' },
        body: '{}',
      });
      expect(wrongToken.status).toBe(404);
      const noToken = await fetch(url, { method: 'POST', body: '{}' });
      expect(noToken.status).toBe(404);
    } finally {
      await server.stop();
    }
  });

  it('is always 404 when no scriptToken is configured', async () => {
    const server = new HookServer({ home, onEvent: () => {} });
    await server.start();
    try {
      const res = await fetch(`http://127.0.0.1:${server.getPort()}/hook`, {
        method: 'POST',
        headers: { 'X-Claude-Mons-Token': 'anything' },
        body: '{}',
      });
      expect(res.status).toBe(404);
    } finally {
      await server.stop();
    }
  });

  it('rejects an oversized body', async () => {
    const scriptToken = 'z'.repeat(64);
    const server = new HookServer({ home, onEvent: () => {}, scriptToken });
    await server.start();
    try {
      const big = JSON.stringify({ hook_event_name: 'Stop', reason: 'a'.repeat(70 * 1024) });
      const res = await fetch(`http://127.0.0.1:${server.getPort()}/hook`, {
        method: 'POST',
        headers: { 'X-Claude-Mons-Token': scriptToken, 'content-length': String(big.length) },
        body: big,
      });
      expect(res.status).toBe(413);
    } finally {
      await server.stop();
    }
  });
});

describe('HookServer port persistence', () => {
  let home: string;
  beforeEach(async () => {
    home = await fs.mkdtemp(join(tmpdir(), 'cm-srv-port-'));
  });
  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  it('binds the preferred port when free', async () => {
    const server = new HookServer({ home, onEvent: () => {}, preferredPort: 51900 });
    await server.start();
    try {
      expect(server.getPort()).toBe(51900);
    } finally {
      await server.stop();
    }
  });

  it('falls back to the next free port and reports the change via onPortChosen', async () => {
    const dummy: Server = createServer();
    await new Promise<void>((resolve, reject) => {
      dummy.once('error', reject);
      dummy.listen(51901, '127.0.0.1', () => resolve());
    });
    try {
      let chosen = -1;
      const server = new HookServer({
        home,
        onEvent: () => {},
        preferredPort: 51901,
        onPortChosen: (p) => (chosen = p),
      });
      await server.start();
      try {
        expect(server.getPort()).not.toBe(51901);
        expect(server.getPort()).toBeGreaterThan(51901);
        expect(server.getPort()).toBeLessThanOrEqual(51901 + 20);
        expect(chosen).toBe(server.getPort());
      } finally {
        await server.stop();
      }
    } finally {
      await new Promise<void>((resolve) => dummy.close(() => resolve()));
    }
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
