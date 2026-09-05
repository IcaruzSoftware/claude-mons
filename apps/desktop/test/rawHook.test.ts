import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { rawHookToEnvelope } from '../src/main/hooks/rawHook.ts';

const randomId = () => 'fixed-id';

describe('rawHookToEnvelope', () => {
  it('mirrors main.go:buildEnvelope\u2019s whitelist and drops everything else', () => {
    const env = rawHookToEnvelope(
      {
        hook_event_name: 'PostToolUse',
        session_id: 's1',
        tool_name: 'Bash',
        tool_use_id: 'tu1',
        notification_type: 'nt',
        source: 'startup',
        reason: 'because',
        stop_hook_active: true,
        cwd: '/home/user/project',
        // must all be discarded:
        prompt: 'do not leak this',
        tool_input: { command: 'rm -rf /' },
        tool_response: { output: 'secret output' },
        transcript_path: '/home/user/.claude/projects/x/transcript.jsonl',
        user_input: 'also secret',
      },
      1234,
      randomId,
    );
    expect(env).not.toBeNull();
    const expectedProject = createHash('sha1')
      .update('/home/user/project')
      .digest('hex')
      .slice(0, 12);
    expect(env).toEqual({
      v: 1,
      id: 'fixed-id',
      ts: 1234,
      event: 'PostToolUse',
      session_id: 's1',
      tool_name: 'Bash',
      tool_use_id: 'tu1',
      notification_type: 'nt',
      source: 'startup',
      reason: 'because',
      stop_hook_active: true,
      project: expectedProject,
      spooled: false,
    });
    expect(expectedProject).toHaveLength(12);
    const json = JSON.stringify(env);
    expect(json).not.toContain('do not leak this');
    expect(json).not.toContain('rm -rf');
    expect(json).not.toContain('secret output');
    expect(json).not.toContain('transcript');
    expect(json).not.toContain('project'.repeat(0) + '/home/user/project'); // raw cwd never appears
    expect(json).not.toContain('/home/user/project');
  });

  it('hashes cwd to the same 12-char sha1 prefix as the Go binary', () => {
    const env = rawHookToEnvelope({ hook_event_name: 'SessionStart', cwd: 'C:/x' }, 0, randomId);
    expect(env?.project).toBe(createHash('sha1').update('C:/x').digest('hex').slice(0, 12));
  });

  it('returns null for an unknown or missing event name', () => {
    expect(rawHookToEnvelope({ hook_event_name: 'Bogus' }, 0, randomId)).toBeNull();
    expect(rawHookToEnvelope({}, 0, randomId)).toBeNull();
    expect(rawHookToEnvelope(null, 0, randomId)).toBeNull();
    expect(rawHookToEnvelope('not an object', 0, randomId)).toBeNull();
  });

  it('keeps stop_hook_active as a real boolean, including false', () => {
    const env = rawHookToEnvelope(
      { hook_event_name: 'Stop', stop_hook_active: false },
      0,
      randomId,
    );
    expect(env?.stop_hook_active).toBe(false);
  });

  it('omits optional fields entirely when absent, rather than sending empty strings', () => {
    const env = rawHookToEnvelope({ hook_event_name: 'SessionStart' }, 0, randomId);
    expect(env).toEqual({ v: 1, id: 'fixed-id', ts: 0, event: 'SessionStart', spooled: false });
    expect(Object.hasOwn(env ?? {}, 'session_id')).toBe(false);
    expect(Object.hasOwn(env ?? {}, 'project')).toBe(false);
  });
});
