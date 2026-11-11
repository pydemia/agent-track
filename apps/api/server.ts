import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { authenticate, validMutationOrigin } from "./auth.ts";
import { CommandError, CommandService } from "../../packages/commands/index.ts";
import { commandPorts } from "./commands.ts";
import { artifactEvidence } from "./evidence.ts";
import type { Config } from "./config.ts";
import { Sources } from "./runner.ts";
import type { Store } from "../../packages/storage/store.ts";

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
};
function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}
async function jsonBody(request: IncomingMessage): Promise<unknown> {
  if (!request.headers["content-type"]?.startsWith("application/json")) throw new CommandError(415, "json_required", "JSON body required.");
  const parts: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > 16_384) throw new CommandError(413, "body_too_large", "Command body is too large.");
    parts.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(parts).toString("utf8")); }
  catch { throw new CommandError(400, "invalid_json", "Invalid JSON body."); }
}
export function createTrackServer(store: Store, config: () => Config, webRoot: string, sources = new Sources(store, config)) {
  const root = resolve(webRoot);
  const snapshot = (user: string) => store.snapshot(user, sources.views(user));
  const commands = new CommandService(store);
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "same-origin");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const current = config();
      const user = authenticate(request, current);
      if (!user) { json(response, 401, { error: "authentication_required" }); return; }
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "POST" && url.pathname === "/api/commands/cancel") {
        if (!validMutationOrigin(request, current)) { json(response, 403, { error: "invalid_origin" }); return; }
        const input = await jsonBody(request);
        const runKey = input && typeof input === "object" && "runKey" in input && typeof input.runKey === "string" ? input.runKey : "";
        const receipt = await commands.execute(user, input, commandPorts(store, config, snapshot, user, runKey, true));
        if (authenticate(request, config()) !== user) { json(response, 401, { error: "authentication_required" }); return; }
        json(response, 200, { receipt }); return;
      }
      if (request.method !== "GET") { json(response, 405, { error: "unsupported_method" }); return; }
      if (url.pathname === "/api/commands") {
        const key = url.searchParams.get("run") ?? "";
        if (!snapshot(user).runs.some((run) => run.key === key)) { json(response, 404, { error: "run_not_found" }); return; }
        const receipts = commands.list(user, key);
        const ports = commandPorts(store, config, snapshot, user, key, false);
        for (let i = 0; i < receipts.length; i++) {
          const receipt = receipts[i]!;
          if (["requested", "dispatching", "accepted", "unknown"].includes(receipt.state)) receipts[i] = await commands.reconcile(user, receipt.id, ports);
        }
        if (authenticate(request, config()) !== user) { json(response, 401, { error: "authentication_required" }); return; }
        json(response, 200, { receipts }); return;
      }
      if (url.pathname === "/api/health") {
        json(response, 200, { status: "ok", schema: 2, version: "0.1.0", integrity: store.integrity() }); return;
      }
      if (url.pathname === "/api/snapshot") { json(response, 200, snapshot(user)); return; }
      if (url.pathname === "/api/stream") {
        response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "X-Accel-Buffering": "no" });
        const send = () => {
          try {
            if (authenticate(request, config()) !== user) {
              response.write("event: authorization_revoked\ndata: {}\n\n");
              response.end(); return;
            }
            response.write(`event: snapshot\ndata: ${JSON.stringify(snapshot(user))}\n\n`);
          } catch { response.end(); }
        };
        send();
        const interval = setInterval(send, 3000);
        response.on("close", () => clearInterval(interval));
        return;
      }
      const runEvents = /^\/api\/runs\/([A-Za-z0-9_-]+)\/events$/.exec(url.pathname);
      if (runEvents) {
        const key = runEvents[1]!;
        if (!snapshot(user).runs.some((run) => run.key === key)) { json(response, 404, { error: "run_not_found" }); return; }
        try { json(response, 200, store.events(key, url.searchParams.get("after") ?? "0")); }
        catch { json(response, 400, { error: "invalid_page_cursor" }); }
        return;
      }
      const artifacts = /^\/api\/runs\/([A-Za-z0-9_-]+)\/artifacts$/.exec(url.pathname);
      if (artifacts) {
        const evidence = await artifactEvidence(config, snapshot, user, artifacts[1]!);
        if (authenticate(request, config()) !== user) { json(response, 401, { error: "authentication_required" }); return; }
        json(response, 200, evidence); return;
      }
      if (url.pathname.startsWith("/api/")) { json(response, 404, { error: "not_found" }); return; }
      if (url.pathname === "/oauth2/sign_out" && current.auth.mode === "local") {
        json(response, 200, { detail: "로컬 개발 모드입니다. 공개 배포는 Entra proxy만 허용합니다." }); return;
      }
      const pathname = decodeURIComponent(url.pathname);
      const target = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
      if (!target.startsWith(root + sep)) { json(response, 404, { error: "not_found" }); return; }
      const type = contentTypes[extname(target)];
      if (!type) { json(response, 404, { error: "not_found" }); return; }
      try {
        const contents = await readFile(target);
        response.writeHead(200, { "Content-Type": type }); response.end(contents);
      } catch { json(response, 404, { error: "asset_not_found" }); }
    } catch (error) {
      if (response.headersSent) response.end();
      else if (error instanceof CommandError) json(response, error.status, { error: error.code, detail: error.message });
      else json(response, 503, { error: "configuration_or_storage_unavailable" });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return { server, sources };
}
