// HTTP helpers shared by all Edge Functions: JSON responses, the ApiError envelope and CORS.
import type { ApiError, ApiErrorCode } from './game/api.ts';

export const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers':
    'authorization, apikey, content-type, x-client-info, x-supabase-client-platform',
  'access-control-max-age': '86400',
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS_HEADERS, ...extra },
  });
}

export function error(
  code: ApiErrorCode | string,
  message: string,
  status: number,
  details?: Record<string, unknown>,
): Response {
  const body: ApiError = { error: details ? { code, message, details } : { code, message } };
  return json(body, status);
}

/** Thrown by helpers that want to short-circuit a handler with a ready-made Response. */
export class HttpError extends Error {
  constructor(public readonly response: Response) {
    super(`http ${response.status}`);
  }
}

export function preflight(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
  return null;
}

/**
 * Reads and parses a JSON body with a size limit. Returns 413 PAYLOAD_TOO_LARGE / 400 BAD_REQUEST
 * responses via HttpError. An empty body parses as `{}` so `POST {}` endpoints stay lenient.
 */
export async function readJson<T = unknown>(req: Request, maxBytes: number): Promise<T> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > maxBytes) {
    throw new HttpError(error('PAYLOAD_TOO_LARGE', `body exceeds ${maxBytes} bytes`, 413));
  }
  const buf = new Uint8Array(await req.arrayBuffer());
  if (buf.byteLength > maxBytes) {
    throw new HttpError(error('PAYLOAD_TOO_LARGE', `body exceeds ${maxBytes} bytes`, 413));
  }
  if (buf.byteLength === 0) return {} as T;
  try {
    return JSON.parse(new TextDecoder().decode(buf)) as T;
  } catch {
    throw new HttpError(error('BAD_REQUEST', 'body is not valid JSON', 400));
  }
}

/** Wraps a handler: OPTIONS preflight, HttpError passthrough, everything else => 500 INTERNAL. */
export function serve(handler: (req: Request) => Promise<Response>): void {
  Deno.serve(async (req) => {
    const pre = preflight(req);
    if (pre) return pre;
    try {
      return await handler(req);
    } catch (e) {
      if (e instanceof HttpError) return e.response;
      console.error('unhandled error', e);
      return error('INTERNAL', 'internal error', 500);
    }
  });
}
