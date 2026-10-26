import * as http from 'node:http';
import * as path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import type { AddDownloadRequest, BulkAction, EngineEvent, EngineState, Settings, ToolName } from '../../../shared/protocol';
import { CATEGORIES } from '../core/categories';
import type { DownloadManager } from '../core/DownloadManager';
import { openPath } from '../core/shell';
import { errorMessage, TEMP_EXT } from '../core/util';

export const ENGINE_VERSION = '1.1.1';

type Handler = (ctx: { body: any; params: Record<string, string>; query: URLSearchParams }) => Promise<unknown> | unknown;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

class HttpFailure extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const BULK: BulkAction[] = ['start', 'pause', 'remove', 'delete', 'redownload', 'moveToQueue', 'moveUp', 'moveDown'];
const TOOLS: ToolName[] = ['7zip', 'yt-dlp', 'ffmpeg'];

/**
 * Local API: REST under /api (bearer token), live events on /ws?token=..., and /capture for the browser extension
 * (no token, but only from extension origins and only with the X-Grabbit-Capture header, which a web page cannot send
 * without a CORS preflight that we refuse).
 */
export function createServer(manager: DownloadManager, token: string): http.Server {
  const routes: Route[] = [];
  const route = (method: string, p: string, handler: Handler) => {
    const keys: string[] = [];
    const pattern = new RegExp(`^${p.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}$`);
    routes.push({ method, pattern, keys, handler });
  };

  route('GET', '/api/state', (): EngineState => ({
    ...manager.state(),
    categories: CATEGORIES,
    version: ENGINE_VERSION,
    whenDone: manager.whenDoneState(),
    tools: manager.tools.list(),
  }));
  route('POST', '/api/probe', ({ body }) => manager.probe(String(body?.url ?? ''), body?.headers, body?.referer));
  route('POST', '/api/downloads', ({ body }) => manager.add(body as AddDownloadRequest));
  route('POST', '/api/downloads/batch', ({ body }) => {
    const urls = Array.isArray(body?.urls) ? body.urls.filter((u: unknown) => typeof u === 'string') : [];
    if (urls.length === 0) throw new HttpFailure(400, 'No addresses');
    if (urls.length > 5000) throw new HttpFailure(400, 'At most 5000 addresses at once');
    return manager.addBatch(urls, body as AddDownloadRequest);
  });
  route('POST', '/api/downloads/actions', async ({ body }) => {
    const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === 'string') : [];
    if (!BULK.includes(body?.action)) throw new HttpFailure(400, 'Unknown action');
    await manager.bulk(ids, body.action, typeof body.arg === 'string' ? body.arg : undefined);
    return { ok: true };
  });
  route('POST', '/api/downloads/pause-all', async () => (await manager.pauseAll(), { ok: true }));
  route('POST', '/api/downloads/remove-completed', async () => (await manager.removeCompleted(), { ok: true }));
  route('PATCH', '/api/downloads/:id', ({ params, body }) => manager.update(params.id, body ?? {}));
  route('POST', '/api/downloads/:id/checksum', ({ params, body }) => manager.computeChecksum(params.id, body?.algo, typeof body?.expected === 'string' ? body.expected : undefined));
  route('GET', '/api/logins', () => manager.secrets.list());
  route('POST', '/api/logins', ({ body }) => manager.secrets.add(String(body?.site ?? ''), String(body?.username ?? ''), String(body?.password ?? '')));
  route('DELETE', '/api/logins/:id', ({ params }) => (manager.secrets.remove(params.id), { ok: true }));
  route('GET', '/api/archive-passwords', () => ({ count: manager.secrets.archivePasswordCount() }));
  route('POST', '/api/archive-passwords', ({ body }) => (manager.secrets.addArchivePassword(String(body?.password ?? '')), { count: manager.secrets.archivePasswordCount() }));
  route('DELETE', '/api/archive-passwords', () => (manager.secrets.clearArchivePasswords(), { count: 0 }));
  route('POST', '/api/when-done/cancel', () => (manager.cancelWhenDone(), { ok: true }));
  route('POST', '/api/downloads/:id/extract', ({ params, body }) => manager.extractNow(params.id, typeof body?.password === 'string' ? body.password : undefined));
  route('GET', '/api/tools', () => manager.tools.list());
  route('POST', '/api/grab', ({ body }) => manager.grab(body ?? {}));
  route('POST', '/api/video/probe', ({ body }) => manager.probeVideo(String(body?.url ?? '')));
  route('POST', '/api/grab/:id/stop', ({ params }) => (manager.stopGrab(params.id), { ok: true }));
  // Installing takes a while: answer at once, progress and the outcome arrive as "tools" events.
  route('POST', '/api/tools/:name/install', ({ params }) => {
    if (!TOOLS.includes(params.name as ToolName)) throw new HttpFailure(404, 'No such tool');
    void manager.installTool(params.name as ToolName).catch(() => undefined);
    return manager.tools.list();
  });
  route('DELETE', '/api/tools/:name', ({ params }) => {
    if (!TOOLS.includes(params.name as ToolName)) throw new HttpFailure(404, 'No such tool');
    manager.tools.remove(params.name as ToolName);
    return manager.tools.list();
  });
  route('POST', '/api/downloads/:id/open', ({ params, body }) => {
    const d = manager.get(params.id);
    if (!d) throw new HttpFailure(404, 'No such download');
    const full = path.join(d.dir, d.fileName);
    const reveal = body?.reveal === true;
    openPath(d.status === 'completed' || !reveal ? full : full + TEMP_EXT, reveal);
    return { ok: true };
  });
  route('POST', '/api/open-folder', ({ body }) => {
    const dir = typeof body?.dir === 'string' && body.dir ? body.dir : manager.getSettings().downloadDir;
    openPath(dir, false);
    return { ok: true };
  });
  route('GET', '/api/settings', () => manager.getSettings());
  route('PUT', '/api/settings', ({ body }) => manager.updateSettings((body ?? {}) as Partial<Settings>));
  route('POST', '/api/queues', ({ body }) => manager.createQueue(String(body?.name ?? '')));
  route('PATCH', '/api/queues/:id', ({ params, body }) => manager.updateQueue(params.id, body ?? {}));
  route('DELETE', '/api/queues/:id', async ({ params }) => (await manager.deleteQueue(params.id), { ok: true }));
  route('POST', '/api/queues/:id/start', ({ params }) => (manager.startQueue(params.id), { ok: true }));
  route('POST', '/api/queues/:id/stop', async ({ params }) => (await manager.stopQueue(params.id), { ok: true }));

  const tokenBuf = Buffer.from(token);
  const authorized = (value: string | null | undefined) => {
    if (!value) return false;
    const b = Buffer.from(value);
    return b.length === tokenBuf.length && timingSafeEqual(b, tokenBuf);
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const origin = req.headers.origin;

    // Browser extension capture endpoint.
    if (url.pathname === '/capture') {
      const extOrigin = typeof origin === 'string' && /^(chrome|moz|edge)-extension:\/\//.test(origin);
      if (extOrigin) {
        res.setHeader('Access-Control-Allow-Origin', origin!);
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Grabbit-Capture');
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      }
      if (req.method === 'OPTIONS') return void res.writeHead(extOrigin ? 204 : 403).end();
      // Extensions only: a web page must not learn that Grabbit runs, nor hand it links. Every request needs the
      // X-Grabbit-Capture header, which a page cannot add without a CORS preflight (refused above), and any Origin it
      // carries must be an extension's. Chromium sends no Origin on an extension's GET when it has host permissions.
      if (req.headers['x-grabbit-capture'] !== '1' || (origin && !extOrigin)) return send(res, 403, { error: 'Forbidden' });
      if (req.method === 'GET') {
        return send(res, 200, { app: 'grabbit', version: ENGINE_VERSION, extensions: manager.getSettings().captureExtensions });
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
      try {
        const body = await readBody(req);
        const referer = typeof body?.referer === 'string' ? body.referer : undefined;
        if (Array.isArray(body?.urls)) {
          const urls = body.urls.filter((u: unknown): u is string => typeof u === 'string').slice(0, 5000);
          const result = manager.captureLinks(urls, referer, pickHeaders(body?.headers));
          return send(res, 200, { ok: true, count: Array.isArray(result) ? result.length : result.urls?.length });
        }
        const fileName = typeof body?.fileName === 'string' ? body.fileName : undefined;
        const result = manager.capture({ url: String(body?.url ?? ''), fileName, referer, headers: pickHeaders(body?.headers), source: 'browser', video: body?.video === true || undefined });
        return send(res, 200, { ok: true, id: result.id });
      } catch (e) {
        return send(res, 400, { error: errorMessage(e) });
      }
    }

    // CORS for the Vite dev server (the UI runs on another origin in development); the token still guards everything.
    if (origin && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    }
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();
    if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
    const auth = req.headers.authorization;
    if (!authorized(auth?.startsWith('Bearer ') ? auth.slice(7) : null)) return send(res, 401, { error: 'Unauthorized' });

    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.pattern.exec(url.pathname);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      try {
        const body = req.method === 'GET' || req.method === 'DELETE' ? null : await readBody(req);
        const result = await r.handler({ body, params, query: url.searchParams });
        return send(res, 200, result ?? { ok: true });
      } catch (e) {
        const status = e instanceof HttpFailure ? e.status : 400;
        return send(res, status, { error: errorMessage(e) });
      }
    }
    return send(res, 404, { error: 'Not found' });
  });

  // ---- WebSocket: one broadcast stream of EngineEvents
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws' || !authorized(url.searchParams.get('token'))) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      clients.add(ws);
      ws.on('close', () => clients.delete(ws));
      ws.on('error', () => clients.delete(ws));
    });
  });
  manager.on('event', (e: EngineEvent) => {
    const msg = JSON.stringify(e);
    for (const ws of clients) if (ws.readyState === ws.OPEN) ws.send(msg);
  });
  // Captures need a window to answer them: with none connected, the manager adds them directly.
  manager.uiConnected = () => clients.size > 0;

  return server;
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}

function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 4 * 1024 * 1024) {
        reject(new HttpFailure(413, 'Request too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (size === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpFailure(400, 'Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** Only the headers a captured request needs to be replayed (cookies, auth) are kept. */
function pickHeaders(h: unknown): Record<string, string> | undefined {
  if (!h || typeof h !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h as Record<string, unknown>)) {
    if (typeof v === 'string' && ['cookie', 'authorization', 'user-agent'].includes(k.toLowerCase())) out[k] = v;
  }
  return out;
}
