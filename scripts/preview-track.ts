import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { readConfig } from "../apps/api/config.ts";

// Explicit loopback-only, read-only QA BFF. Operator credentials remain server-side.
// Production/public access keeps its independent Entra authorization path.
const path = process.env.TRACK_CONFIG;
const user = process.env.TRACK_PREVIEW_USER;
if (!path || !user) throw new Error("TRACK_CONFIG and explicit TRACK_PREVIEW_USER are required");
const original = readConfig(path);
if (original.auth.mode !== "proxy" || !original.auth.users.includes(user)) throw new Error("Preview user must be a configured owner");
const server = createServer(async (request, response) => {
  try {
    const config = readConfig(path);
    if (request.method !== "GET" || !request.url?.startsWith("/") || request.headers.host !== "127.0.0.1:14347" ||
        config.auth.mode !== "proxy" || !config.auth.users.includes(user) || request.headers["x-forwarded-host"]) {
      response.writeHead(401); response.end(); return;
    }
    const local = new URL(request.url, "http://127.0.0.1:14347");
    const controller = new AbortController();
    response.on("close", () => controller.abort());
    const upstream = await fetch(`http://127.0.0.1:${config.port}${local.pathname}${local.search}`, {
      headers: { "x-track-proxy-key": readFileSync(config.auth.secretFile, "utf8").trim(), "x-forwarded-email": user },
      redirect: "error", signal: controller.signal,
    });
    for (const name of ["content-type", "cache-control", "content-security-policy", "x-content-type-options", "referrer-policy"]) {
      const value = upstream.headers.get(name); if (value) response.setHeader(name, value);
    }
    response.writeHead(upstream.status);
    if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), response);
    else response.end();
  } catch { if (!response.headersSent) response.writeHead(503); response.end(); }
});
server.listen(14347, "127.0.0.1", () => console.log("Local read-only QA BFF on port 14347; operator identity stays server-side"));
process.once("SIGTERM", () => { server.closeAllConnections(); server.close(); });
