/**
 * The envelope the Go hook binary sends to the desktop app (and appends to the spool file).
 * Keep in sync with packages/hook-cli/main.go.
 */
export type HookEventName =
  | 'SessionStart'
  | 'UserPromptSubmit'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'Notification'
  | 'Stop'
  | 'SessionEnd';

export const HOOK_EVENTS: readonly HookEventName[] = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'Stop',
  'SessionEnd',
] as const;

export interface HookEnvelope {
  v: 1;
  id: string;
  /** epoch ms */
  ts: number;
  event: HookEventName;
  session_id?: string;
  /** 12-char hash of the working directory (never the path itself). */
  project?: string;
  tool_name?: string;
  tool_use_id?: string;
  notification_type?: string;
  source?: string;
  reason?: string;
  stop_hook_active?: boolean;
  /** true when the event was buffered while the app was not running. */
  spooled: boolean;
}

export function isHookEventName(value: unknown): value is HookEventName {
  return typeof value === 'string' && (HOOK_EVENTS as readonly string[]).includes(value);
}

/** Validates an untrusted object into a HookEnvelope, or returns null. */
export function parseHookEnvelope(input: unknown): HookEnvelope | null {
  if (typeof input !== 'object' || input === null) return null;
  const o = input as Record<string, unknown>;
  if (o.v !== 1) return null;
  if (typeof o.id !== 'string' || o.id.length === 0 || o.id.length > 64) return null;
  if (typeof o.ts !== 'number' || !Number.isFinite(o.ts)) return null;
  if (!isHookEventName(o.event)) return null;
  const str = (k: string): string | undefined => {
    const v = o[k];
    return typeof v === 'string' && v.length <= 256 ? v : undefined;
  };
  const env: HookEnvelope = {
    v: 1,
    id: o.id,
    ts: o.ts,
    event: o.event,
    spooled: o.spooled === true,
  };
  const sessionId = str('session_id');
  if (sessionId !== undefined) env.session_id = sessionId;
  const project = str('project');
  if (project !== undefined) env.project = project;
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
  return env;
}
