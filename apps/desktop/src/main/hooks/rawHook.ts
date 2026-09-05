import { createHash } from 'node:crypto';
import { isHookEventName, type HookEnvelope } from '@claude-mons/shared';

const DEBUG = process.env.CLAUDE_MONS_DEBUG === '1';

/**
 * Converts the raw Claude Code hook JSON (as posted to `/hook` by the script-mode curl command)
 * into a `HookEnvelope`. Mirrors `packages/hook-cli/main.go:buildEnvelope` field-for-field: keeps
 * only the same metadata whitelist, hashes `cwd` the same way, and never touches prompt text, tool
 * input/output or transcript paths. Returns null for an unrecognized shape or event name.
 */
export function rawHookToEnvelope(
  raw: unknown,
  now: number,
  randomId: () => string,
): HookEnvelope | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;

  const str = (k: string): string | undefined => {
    const v = o[k];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  };

  const eventName = str('hook_event_name');
  if (!isHookEventName(eventName)) {
    if (DEBUG) console.info(`rawHookToEnvelope: unknown event ${JSON.stringify(eventName)}`);
    return null;
  }

  const env: HookEnvelope = {
    v: 1,
    id: randomId(),
    ts: now,
    event: eventName,
    spooled: false,
  };
  const sessionId = str('session_id');
  if (sessionId !== undefined) env.session_id = sessionId;
  const toolName = str('tool_name');
  if (toolName !== undefined) env.tool_name = toolName;
  const toolUseId = str('tool_use_id');
  if (toolUseId !== undefined) env.tool_use_id = toolUseId;
  const notificationType = str('notification_type');
  if (notificationType !== undefined) env.notification_type = notificationType;
  const source = str('source');
  if (source !== undefined) env.source = source;
  const reason = str('reason');
  if (reason !== undefined) env.reason = reason;
  if (typeof o.stop_hook_active === 'boolean') env.stop_hook_active = o.stop_hook_active;

  const cwd = str('cwd');
  if (cwd !== undefined) {
    env.project = createHash('sha1').update(cwd).digest('hex').slice(0, 12);
  }

  return env;
}
