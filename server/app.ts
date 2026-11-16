import { createReadStream, statSync } from "node:fs";
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";

import { AnalyzerError, type AnalyzerClient } from "./analyzerClient.ts";
import type { AnalysisStore } from "./db.ts";
import { RateLimiter } from "./rateLimit.ts";
import { createAnalysisSchema, describeZodError } from "./validation.ts";

export interface AppDeps {
  store: AnalysisStore;
  analyzer: AnalyzerClient;
  maxBodyBytes: number;
  rateLimitPerMinute: number;
  /** Folder with the built React app. Omit to run the API only. */
  staticDir?: string;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const STATUS_TEXT: Record<number, string> = {
  400: "Bad Request", 404: "Not Found", 405: "Method Not Allowed", 413: "Payload Too Large",
  415: "Unsupported Media Type", 429: "Too Many Requests", 500: "Internal Server Error",
  502: "Bad Gateway", 503: "Service Unavailable", 504: "Gateway Timeout",
};

// Sent on every response. The CSP only allows scripts, styles and requests from
// this site, which blocks most cross-site scripting even if a bug slipped in.
const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
    "connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
};

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".log": "text/plain; charset=utf-8",
  ".map": "application/json",
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
    "Cache-Control": "no-store",
  });
  res.end(data);
}

function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: STATUS_TEXT[status] ?? "Error", message });
}

/** Read the request body, refusing anything over the limit. */
async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  if (!(req.headers["content-type"] ?? "").includes("application/json")) {
    throw new HttpError(415, "send Content-Type: application/json");
  }
  const declared = Number(req.headers["content-length"]);
  if (declared > maxBytes) {
    throw new HttpError(413, `request body is over the ${Math.round(maxBytes / 1024 / 1024)} MB limit`);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) {
      throw new HttpError(413, `request body is over the ${Math.round(maxBytes / 1024 / 1024)} MB limit`);
    }
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "request body is not valid JSON");
  }
}

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, "analysis id must be a positive integer");
  return id;
}

function clientIp(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? "unknown";
}

/** Serve files from the React build. Unknown paths get index.html so client-side routes work. */
function serveStatic(req: IncomingMessage, res: ServerResponse, staticDir: string, pathname: string): void {
  const root = resolve(staticDir);
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return sendError(res, 400, "malformed URL");
  }
  let filePath = resolve(join(root, decoded));

  // Block path traversal such as /../../etc/passwd
  if (filePath !== root && !filePath.startsWith(root + sep)) {
    return sendError(res, 404, "not found");
  }
  let stats = statSync(filePath, { throwIfNoEntry: false });
  if (!stats || stats.isDirectory()) {
    filePath = join(root, "index.html");
    stats = statSync(filePath, { throwIfNoEntry: false });
    if (!stats) return sendError(res, 404, "frontend not built: run `npm run build`");
  }
  const isHtml = filePath.endsWith(".html");
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    "Content-Type": MIME_TYPES[extname(filePath)] ?? "application/octet-stream",
    "Content-Length": stats.size,
    // Built JS/CSS can be cached; HTML must be revalidated so new builds show up.
    "Cache-Control": isHtml ? "no-cache" : "public, max-age=3600",
  });
  if (req.method === "HEAD") return void res.end();
  createReadStream(filePath).pipe(res);
}

export function createApp(deps: AppDeps): RequestListener {
  const limiter = new RateLimiter(deps.rateLimitPerMinute, 60_000);

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const method = req.method ?? "GET";

    // ---- GET /api/health ------------------------------------------------
    if (path === "/api/health") {
      if (method !== "GET") throw new HttpError(405, "use GET");
      const [dbOk, analyzerOk] = [deps.store.ping(), await deps.analyzer.health()];
      const ok = dbOk && analyzerOk;
      return sendJson(res, ok ? 200 : 503, {
        status: ok ? "ok" : "degraded",
        database: dbOk ? "ok" : "down",
        analyzer: analyzerOk ? "ok" : "unreachable",
      });
    }

    // ---- /api/analyses ----------------------------------------------------
    if (path === "/api/analyses") {
      if (method === "GET") {
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
        return sendJson(res, 200, deps.store.list(limit));
      }
      if (method === "POST") {
        if (!limiter.allow(clientIp(req))) {
          res.setHeader("Retry-After", "60");
          throw new HttpError(429, "too many analyses, try again in a minute");
        }
        const parsed = createAnalysisSchema.safeParse(await readJsonBody(req, deps.maxBodyBytes));
        if (!parsed.success) throw new HttpError(400, describeZodError(parsed.error));
        const { name, ...analyzerInput } = parsed.data;
        const result = await deps.analyzer.analyze(analyzerInput);
        const saved = deps.store.create(name ?? `Analysis ${new Date().toISOString().slice(0, 16)}`, result);
        res.setHeader("Location", `/api/analyses/${saved.id}`);
        return sendJson(res, 201, { ...saved, result });
      }
      throw new HttpError(405, "use GET or POST");
    }

    // ---- /api/analyses/:id -----------------------------------------------
    const match = path.match(/^\/api\/analyses\/([^/]+)$/);
    if (match) {
      const id = parseId(match[1]);
      if (method === "GET") {
        const analysis = deps.store.get(id);
        if (!analysis) throw new HttpError(404, `analysis ${id} not found`);
        return sendJson(res, 200, analysis);
      }
      if (method === "DELETE") {
        if (!deps.store.delete(id)) throw new HttpError(404, `analysis ${id} not found`);
        res.writeHead(204, SECURITY_HEADERS);
        return void res.end();
      }
      throw new HttpError(405, "use GET or DELETE");
    }

    if (path.startsWith("/api/")) throw new HttpError(404, `no API route for ${path}`);

    // ---- everything else: the React app ----------------------------------
    if (deps.staticDir && (method === "GET" || method === "HEAD")) {
      return serveStatic(req, res, deps.staticDir, path);
    }
    throw new HttpError(404, "not found");
  }

  return (req, res) => {
    route(req, res).catch((err: unknown) => {
      if (res.headersSent) return void res.destroy();
      if (err instanceof HttpError || err instanceof AnalyzerError) {
        // If the client sent too much, close the connection rather than reading the rest.
        if (err.status === 413) res.setHeader("Connection", "close");
        return sendError(res, err.status, err.message);
      }
      // Unknown error: log it on the server, but never send a stack trace to the browser.
      console.error(err);
      sendError(res, 500, "unexpected server error");
    });
  };
}
