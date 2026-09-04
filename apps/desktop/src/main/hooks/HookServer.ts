import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { parseHookEnvelope, type HookEnvelope } from '@claude-mons/shared';

export const ENDPOINT_FILE = 'hook-endpoint.json';
const MAX_BODY = 64 * 1024;

export interface HookServerOptions {
  /** Directory the hook binary is pointed at (`--home`). Usually app.getPath('userData'). */
  home: string;
  onEvent: (env: HookEnvelope) => void;
  pid?: number;
}

/**
 * Localhost HTTP endpoint that receives envelopes from the hook binary.
 * Binds 127.0.0.1 on a random port and announces {port, token, pid} in `<home>/hook-endpoint.json`.
 * Only `POST /event` with the bearer token is accepted; everything else is 404.
 */
export class HookServer {
  private server: Server | null = null;
  private port = 0;
  private readonly token = randomBytes(32).toString('hex');

  constructor(private readonly opts: HookServerOptions) {}

  getPort(): number {
    return this.port;
  }

  async start(): Promise<void> {
    if (this.server) return;
    this.server = createServer((req, res) => this.handle(req, res));
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = this.server.address();
    if (!addr || typeof addr === 'string') throw new Error('hook server: no address');
    this.port = addr.port;
    await this.writeEndpointFile();
  }

  async stop(): Promise<void> {
    const s = this.server;
    this.server = null;
    if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
    await fs.rm(join(this.opts.home, ENDPOINT_FILE), { force: true }).catch(() => {});
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
    if (req.method !== 'POST' || req.url !== '/event') {
      res.writeHead(404).end();
      return;
    }
    if (req.headers.authorization !== `Bearer ${this.token}`) {
      res.writeHead(404).end();
      return;
    }
    const len = Number(req.headers['content-length'] ?? 0);
    if (len > MAX_BODY) {
      res.writeHead(413).end();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        res.writeHead(413).end();
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      // Answer before processing so the hook binary returns as fast as possible.
      res.writeHead(204).end();
      try {
        const env = parseHookEnvelope(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        if (env) this.opts.onEvent(env);
      } catch {
        /* malformed body: ignore */
      }
    });
    req.on('error', () => {
      /* client went away */
    });
  }
}
