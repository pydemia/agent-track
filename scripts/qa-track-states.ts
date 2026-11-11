import { createServer, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { readConfig } from "../apps/api/config.ts";
import type { Snapshot } from "../packages/contracts/index.ts";

// Explicit ephemeral loopback QA. Faults affect this proxy only, never the product.
// Uses actual authorized metadata, no synthetic Runs and no runtime writes.
const configPath = process.env.TRACK_CONFIG;
const user = process.env.TRACK_PREVIEW_USER;
const modePath = process.env.TRACK_QA_MODE_FILE;
if (!configPath || !user || !modePath || !isAbsolute(modePath)) throw new Error("Explicit private QA paths/user required");
type Mode = "live" | "empty" | "unavailable" | "revoked" | "expired" | "disconnected";
function mode(): Mode {
  const value = readFileSync(modePath!, "utf8").replace(/^\uFEFF/, "").trim();
  if (!["live", "empty", "unavailable", "revoked", "expired", "disconnected"].includes(value)) throw new Error("Invalid QA mode");
  return value as Mode;
}
function upstream(path: string, signal: AbortSignal) {
  const config = readConfig(configPath!);
  if (config.auth.mode !== "proxy" || !config.auth.users.includes(user!)) throw new Error("Configured owner required");
  return fetch(`http://127.0.0.1:${config.port}${path}`, { redirect: "error", signal,
    headers: { "x-track-proxy-key": readFileSync(config.auth.secretFile, "utf8").trim(), "x-forwarded-email": user! } });
}
function project(snapshot: Snapshot, state: Mode): Snapshot {
  return { ...snapshot, runs: state === "empty" ? [] : snapshot.runs.map((run) => ({ ...run,
    capabilities: run.capabilities.filter((item) => item !== "run.cancel"),
    ...(state === "disconnected" ? { sourceState: "disconnected" as const, stale: true } : {}) })),
    relations: state === "empty" ? [] : snapshot.relations,
    sources: snapshot.sources.map((source) => ({ ...source, capabilities: source.capabilities.filter((item) => item !== "run.cancel"),
      ...(state === "disconnected" && source.state === "connected" ? { state: "disconnected" as const, detail: "Loopback QA: controlled connection loss" } : {}) })) };
}
function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(body));
}
const server = createServer(async (request, response) => {
  const controller = new AbortController();
  response.on("close", () => controller.abort());
  try {
    if (request.method !== "GET" || request.headers.host !== "127.0.0.1:14348" || request.headers["x-forwarded-host"] || !request.url?.startsWith("/")) {
      json(response, 401, { error: "qa_loopback_only" }); return;
    }
    const path = request.url;
    const state = mode();
    if (path.startsWith("/api/") && (state === "unavailable" || state === "revoked" || state === "expired")) {
      json(response, state === "unavailable" ? 503 : 401, { error: "controlled_qa_fault" }); return;
    }
    if (path === "/api/stream") {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
      let sending = false;
      const send = async () => {
        if (sending || controller.signal.aborted) return;
        sending = true;
        try {
          const current = mode();
          if (current === "revoked") { response.write("event: authorization_revoked\ndata: {}\n\n"); response.end(); return; }
          if (current === "unavailable" || current === "expired") { response.end(); return; }
          const source = await upstream("/api/snapshot", controller.signal);
          if (!source.ok) { await source.body?.cancel(); response.end(); return; }
          const snapshot = await source.json() as Snapshot;
          if (!controller.signal.aborted) response.write(`event: snapshot\ndata: ${JSON.stringify(project(snapshot, current))}\n\n`);
        } catch { response.end(); }
        finally { sending = false; }
      };
      const timer = setInterval(() => void send(), 500);
      response.on("close", () => clearInterval(timer));
      void send(); return;
    }
    const source = await upstream(path, controller.signal);
    for (const header of ["content-type", "cache-control", "content-security-policy", "x-content-type-options", "referrer-policy"]) {
      const value = source.headers.get(header); if (value) response.setHeader(header, value);
    }
    if (path === "/api/snapshot" && source.ok) {
      const snapshot = await source.json() as Snapshot;
      response.writeHead(200); response.end(JSON.stringify(project(snapshot, state))); return;
    }
    response.writeHead(source.status);
    if (source.body) await pipeline(Readable.fromWeb(source.body), response); else response.end();
  } catch { if (!response.headersSent) json(response, 503, { error: "qa_unavailable" }); else response.end(); }
});
server.listen(14348, "127.0.0.1", () => console.log("Ephemeral Track state QA on loopback14348; no runtime commands"));
process.once("SIGTERM", () => { server.closeAllConnections(); server.close(); });
