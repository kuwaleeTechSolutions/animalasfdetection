// =====================================================================================
// Minimal, dependency-free HTTP router (an Express-like surface built on node:http).
//
// [DECIDE] `express` is not installable in this sandbox (no npm registry access).
// This ~150-line router implements the small subset of Express we actually use
// (app.get/post/put/patch/delete, middleware chains via `use`, path params, JSON
// body parsing, req.query, res.json/res.status). Route handler signatures are
// intentionally Express-compatible ((req, res, next) => void) so migrating to real
// Express in production is a mechanical, low-risk change (add express to
// package.json, delete this file, keep every route file as-is).
// =====================================================================================
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';

export interface Req extends IncomingMessage {
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
  user?: { id: string; role: string; district: string | null; name: string };
}

export interface Res extends ServerResponse {
  status(code: number): Res;
  json(data: any): void;
  send(data: string): void;
}

export type Handler = (req: Req, res: Res, next: (err?: any) => void) => void | Promise<void>;

interface Route {
  method: string;
  segments: string[];
  handlers: Handler[];
}

export class App {
  private routes: Route[] = [];
  private globalMiddleware: Handler[] = [];
  private notFoundHandler: Handler | null = null;

  use(mw: Handler) {
    this.globalMiddleware.push(mw);
  }

  /** Fallback handler invoked when no API route matches (used to serve the static frontend SPA). */
  setNotFoundHandler(handler: Handler) {
    this.notFoundHandler = handler;
  }

  private register(method: string, path: string, handlers: Handler[]) {
    const segments = path.split('/').filter(Boolean);
    this.routes.push({ method, segments, handlers });
  }

  get(path: string, ...handlers: Handler[]) { this.register('GET', path, handlers); }
  post(path: string, ...handlers: Handler[]) { this.register('POST', path, handlers); }
  put(path: string, ...handlers: Handler[]) { this.register('PUT', path, handlers); }
  patch(path: string, ...handlers: Handler[]) { this.register('PATCH', path, handlers); }
  delete(path: string, ...handlers: Handler[]) { this.register('DELETE', path, handlers); }

  private match(method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
    const pathSegments = pathname.split('/').filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== pathSegments.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < route.segments.length; i++) {
        const rs = route.segments[i];
        const ps = pathSegments[i];
        if (rs.startsWith(':')) {
          params[rs.slice(1)] = decodeURIComponent(ps);
        } else if (rs !== ps) {
          ok = false;
          break;
        }
      }
      if (ok) return { route, params };
    }
    return null;
  }

  listen(port: number, cb?: () => void) {
    const server = createServer(async (rawReq, rawRes) => {
      const req = rawReq as Req;
      const res = rawRes as Res;
      res.status = function (code: number) { this.statusCode = code; return res; };
      res.json = function (data: any) {
        const body = JSON.stringify(data);
        if (!this.getHeader('Content-Type')) this.setHeader('Content-Type', 'application/json');
        this.end(body);
      };
      res.send = function (data: string) { this.end(data); };

      // CORS (pilot: allow all origins for local dev demo)
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }

      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      req.query = url.searchParams;
      req.params = {};

      // Parse JSON body for methods that may carry one
      req.body = {};
      if (['POST', 'PUT', 'PATCH'].includes(req.method || '')) {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const raw = Buffer.concat(chunks).toString('utf-8');
        if (raw) {
          try { req.body = JSON.parse(raw); } catch { req.body = {}; }
        }
      }

      const found = this.match(req.method || 'GET', url.pathname);
      if (!found) {
        if (this.notFoundHandler && (req.method === 'GET' || req.method === 'HEAD')) {
          await this.notFoundHandler(req, res, () => { res.status(404).json({ error: 'Not found', path: url.pathname }); });
        } else {
          res.status(404).json({ error: 'Not found', path: url.pathname });
        }
        return;
      }
      req.params = found.params;

      const chain = [...this.globalMiddleware, ...found.route.handlers];
      let idx = 0;
      const next = async (err?: any) => {
        if (err) {
          console.error(err);
          if (!res.writableEnded) res.status(err.status || 500).json({ error: err.message || 'Internal error' });
          return;
        }
        const handler = chain[idx++];
        if (!handler) return;
        try {
          await handler(req, res, next);
        } catch (e) {
          next(e);
        }
      };
      await next();
    });
    server.listen(port, cb);
    return server;
  }
}
