import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { parseHookEnvelope, type HookEnvelope } from '@claude-mons/shared';
import { rawHookToEnvelope } from './rawHook.ts';

export const ENDPOINT_FILE = 'hook-endpoint.json';
const MAX_BODY = 64 * 1024;
/** How many ports above the preferred one to try before giving up and binding a random port. */
const PORT_FALLBACK_RANGE = 20;

export interface HookServerOptions {
  /** Directory the hook binary is pointed at (`--home`). Usually app.getPath('userData'). */
  home: string;
  onEvent: (env: HookEnvelope) => void;
  pid?: number;
  /**
   * Preferred bind port (persisted in `LocalState.hooks.port`). If taken, the next ports up to
   * +20 are tried, then a random port. Omit to always bind a random port (used by tests).
   */
  preferredPort?: number;
  /** Stable token for `POST /hook` (script mode), read from `LocalState.hooks.token`. */
  scriptToken?: string;
  /** Called once the server is listening, with the port actually bound (may differ from preferred). */
  onPortChosen?: (port: number) => void;
}

function isAddrInUse(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
  );
}

/**
 * Localhost HTTP endpoint that receives hook events two ways:
 * - `POST /event`: envelopes already built by the Go hook binary, authenticated with a bearer
 *   token that is minted fresh each start and announced (with the port) in
 *   `<home>/hook-endpoint.json`.
 * - `POST /hook`: raw Claude Code hook JSON posted directly by a `curl` command (script mode,
 *   used when the Go binary is blocked), authenticated via the `X-Claude-Mons-Token` header with
 *   a token that is stable across restarts (`LocalState.hooks.token`) so the installed hook
 *   command keeps working.
 * Both routes reply `204` before parsing the body so the caller returns as fast as possible;
 * everything else is `404`.
 */
export class HookServer {
  private server: Server | null = null;
  private port = 0;
  private readonly token = randomBytes(32).toString('hex');

  constructor(private readonly opts: HookServerOptions) {}

  getPort(): number {
    return this.port;
  }

  /** The bearer token for `/event` (Go binary), minted fresh each start. */
  getEventToken(): string {
    return this.token;
  }

  async start(): Promise<void> {
    if (this.server) return;
    this.server = createServer((req, res) => this.handle(req, res));
    this.port = await this.bind(this.opts.preferredPort ?? 0);
    await this.writeEndpointFile();
    this.opts.onPortChosen?.(this.port);
  }

  async stop(): Promise<void> {
    const s = this.server;
    this.server = null;
    if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
    await fs.rm(join(this.opts.home, ENDPOINT_FILE), { force: true }).catch(() => {});
  }

  /** Binds `preferred` if free, otherwise tries preferred+1..+20, otherwise a random port. */
  private async bind(preferred: number): Promise<number> {
    if (preferred <= 0) return this.listenOnce(0);
    for (let p = preferred; p <= preferred + PORT_FALLBACK_RANGE; p++) {
      try {
        return await this.listenOnce(p);
      } catch (err) {
        if (!isAddrInUse(err)) throw err;
      }
    }
    return this.listenOnce(0);
  }

  private listenOnce(port: number): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const onError = (err: Error) => reject(err);
      this.server!.once('error', onError);
      this.server!.listen(port, '127.0.0.1', () => {
        this.server!.removeListener('error', onError);
        const addr = this.server!.address();
        if (!addr || typeof addr === 'string') {
          reject(new Error('hook server: no address'));
          return;
        }
        resolve(addr.port);
      });
    });
  }

  private async writeEndpointFile(): Promise<void> {
    await fs.mkdir(this.opts.home, { recursive: true });
    const path = join(this.opts.home, ENDPOINT_FILE);
    const body = JSON.stringify({
      v: 1,
      port: this.port,
      token: this.token,
      pid: this.opts.pid ?? process.pid,
      startedAt: Date.now(),
    });
    const tmp = `${path}.tmp`;
    await fs.writeFile(tmp, body, { mode: 0o600 });
    await fs.rename(tmp, path);
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    if (req.method === 'POST' && req.url === '/event') {
      this.handleEvent(req, res);
      return;
    }
    if (req.method === 'POST' && req.url === '/hook') {
      this.handleRawHook(req, res);
      return;
    }
    res.writeHead(404).end();
  }

  private handleEvent(req: IncomingMessage, res: ServerResponse): void {
    if (req.headers.authorization !== `Bearer ${this.token}`) {
      res.writeHead(404).end();
      return;
    }
    this.readBody(req, res, (buf) => {
      try {
        const env = parseHookEnvelope(JSON.parse(buf.toString('utf8')));
        if (env) this.opts.onEvent(env);
      } catch {
        /* malformed body: ignore */
      }
    });
  }

  private handleRawHook(req: IncomingMessage, res: ServerResponse): void {
    const header = req.headers['x-claude-mons-token'];
    const token = Array.isArray(header) ? header[0] : header;
    if (!this.opts.scriptToken || token !== this.opts.scriptToken) {
      res.writeHead(404).end();
      return;
    }
    this.readBody(req, res, (buf) => {
      try {
        const raw = JSON.parse(buf.toString('utf8'));
        const built = rawHookToEnvelope(raw, Date.now(), () => randomBytes(8).toString('hex'));
        const env = built ? parseHookEnvelope(built) : null;
        if (env) this.opts.onEvent(env);
      } catch {
        /* malformed body: ignore */
      }
    });
  }

  /** Answers 204 before the body is fully parsed, then invokes `onBody` with the collected bytes. */
  private readBody(req: IncomingMessage, res: ServerResponse, onBody: (buf: Buffer) => void): void {
    const len = Number(req.headers['content-length'] ?? 0);
    if (len > MAX_BODY) {
      res.writeHead(413).end();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let rejected = false;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        rejected = true;
        res.writeHead(413).end();
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (rejected) return;
      // Answer before processing so the caller (Go binary or curl) returns as fast as possible.
      res.writeHead(204).end();
      onBody(Buffer.concat(chunks));
    });
    req.on('error', () => {
      /* client went away */
    });
  }
}
