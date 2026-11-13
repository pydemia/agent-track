import { createHash, timingSafeEqual } from "node:crypto";
import { request } from "node:http";

const MAX_BODY = 1024 * 1024;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SESSION = `/api/v1/sessions/${UUID}`;
const RUN = `/api/v1/runs/${UUID}`;
const GET_ROUTE = new RegExp(`^(?:/api/v1/(?:capabilities|me)|${SESSION}|${SESSION}/requests/([^/]+)|${RUN}|${RUN}/artifacts/${UUID}/content)$`);
const POST_ROUTE = new RegExp(`^(?:${SESSION}/runs|${RUN}/cancel)$`);
const METADATA_ROUTE = new RegExp(`^${RUN}/(?:metadata|evidence)(?:\\?after=(0|[1-9][0-9]{0,18})&limit=([1-9][0-9]{0,2}))?$`);
const ENVELOPE = /^DemianWork v1\.[A-Za-z0-9_-]{1,128}\.[A-Za-z0-9_-]{1,16384}\.[A-Za-z0-9_-]{43}$/;
const RESPONSE_HEADERS = ["content-type", "content-length", "content-encoding", "content-disposition", "content-range", "accept-ranges", "etag", "last-modified", "digest", "content-digest", "x-content-sha256", "x-artifact-sha256"];

function rawValues(req, name) {
  const values = [];
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    if (req.rawHeaders[index].toLowerCase() === name) values.push(req.rawHeaders[index + 1]);
  }
  return values;
}

function allowedTarget(method, target) {
  if (typeof target !== "string" || target.length > 2048) return false;
  const metadata = method === "GET" ? METADATA_ROUTE.exec(target) : null;
  if (metadata) return metadata[1] === undefined || BigInt(metadata[1]) <= 9223372036854775807n && Number(metadata[2]) <= 250;
  if (/[?#\\]|\/\/|%2f|%5c/i.test(target)) return false;
  if (method === "POST") return POST_ROUTE.test(target);
  if (method !== "GET") return false;
  const match = GET_ROUTE.exec(target);
  if (!match) return false;
  if (match[1] === undefined) return true;
  try {
    const correlation = decodeURIComponent(match[1]);
    return correlation.length > 0 && correlation.length <= 256
      && correlation !== "." && correlation !== ".."
      && !/[\x00-\x20\x7f/\\?#%]/.test(correlation)
      && encodeURIComponent(correlation) === match[1];
  } catch { return false; }
}

function readBody(req, signal) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const cleanup = () => {
      req.off("data", data); req.off("end", end);
      req.off("error", fail); req.off("aborted", fail);
      signal.removeEventListener("abort", fail);
    };
    const fail = () => { cleanup(); req.pause(); reject(new Error("Request rejected")); };
    const data = chunk => {
      size += chunk.length;
      if (size > MAX_BODY || (req.method === "GET" && size > 0)) { fail(); return; }
      chunks.push(chunk);
    };
    const end = () => { cleanup(); resolve(Buffer.concat(chunks, size)); };
    req.on("data", data); req.once("end", end);
    req.once("error", fail); req.once("aborted", fail);
    signal.addEventListener("abort", fail, { once: true });
    if (signal.aborted) fail();
  });
}

/** Transport gate only. Upstream MUST verify HMAC, current binding and nonce. */
export function createDelegatedProxy(options) {
  const { hostname, organizationId, upstreamPort, resolveBearer, timeoutMs = 15000 } = options ?? {};
  if (typeof hostname !== "string" || hostname.length > 253
    || !hostname.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    || typeof organizationId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(organizationId)
    || !Number.isInteger(upstreamPort) || upstreamPort < 1 || upstreamPort > 65535
    || typeof resolveBearer !== "function" || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
    throw new TypeError("Invalid delegated proxy options");
  }
  return async (req, res) => {
    const auth = rawValues(req, "authorization");
    const delegation = rawValues(req, "x-demian-delegation");
    if (!delegation.length && !auth.some(value => /^Bearer(?:\s|$)/i.test(value))) return false;
    await new Promise(resolve => {
      const controller = new AbortController();
      let upstream;
      let incoming;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        controller.abort();
        upstream?.destroy();
        incoming?.destroy();
        res.off("close", finish);
        res.off("finish", finish);
        res.off("error", finish);
        resolve();
      };
      const deny = status => {
        if (finished) return;
        if (res.headersSent) { res.destroy(); finish(); return; }
        for (const name of res.getHeaderNames()) res.removeHeader(name);
        res.writeHead(status, { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8", connection: "close" });
        // Discard unread bytes without buffering while the close response flushes.
        req.resume();
        res.end(status === 502 ? "Bad gateway" : status === 401 ? "Unauthorized" : "Forbidden");
        finish();
      };
      const timer = setTimeout(() => deny(502), timeoutMs);
      res.once("close", finish); res.once("finish", finish); res.once("error", finish);
      void (async () => {
        const hosts = rawValues(req, "host");
        const org = rawValues(req, "x-demian-organization-id");
        if (hosts.length !== 1 || ![hostname, `${hostname}:443`].includes(hosts[0])
          || org.length !== 1 || org[0] !== organizationId
          || delegation.length !== 1 || !ENVELOPE.test(delegation[0])
          || !allowedTarget(req.method, req.url)) { deny(403); return; }
        if (auth.length !== 1 || !/^Bearer [A-Za-z0-9._~+/-]+=*$/.test(auth[0]) || auth[0].length > 8192) { deny(401); return; }
        let current;
        try { current = await resolveBearer(); } catch { deny(401); return; }
        if (finished) return;
        if (typeof current !== "string" || !current || current.length > 8192
          || !timingSafeEqual(createHash("sha256").update(auth[0].slice(7)).digest(), createHash("sha256").update(current).digest())) { deny(401); return; }
        const nominated = new Set(rawValues(req, "connection").flatMap(value => value.toLowerCase().split(",").map(part => part.trim())));
        const headers = { host: hostname };
        for (const name of ["authorization", "x-demian-delegation", "x-demian-organization-id", "content-type", "idempotency-key"]) {
          const values = rawValues(req, name);
          if (values.length > 1 || (values.length && (nominated.has(name) || values[0].length > 1024 && name !== "x-demian-delegation" && name !== "authorization"))) { deny(403); return; }
          if (name === "idempotency-key" && values.length && !/^[\x21-\x7e]{1,256}$/.test(values[0])) { deny(403); return; }
          if (values.length) headers[name] = values[0];
        }
        const lengths = rawValues(req, "content-length");
        if (lengths.length > 1 || (lengths.length && (!/^\d+$/.test(lengths[0]) || Number(lengths[0]) > MAX_BODY || (req.method === "GET" && Number(lengths[0]) !== 0)))) { deny(403); return; }
        let body;
        try { body = await readBody(req, controller.signal); } catch { deny(403); return; }
        if (finished) return;
        if (req.method === "POST") headers["content-length"] = String(body.length);
        upstream = request({ hostname: "127.0.0.1", port: upstreamPort, method: req.method, path: req.url, headers, agent: false }, response => {
          incoming = response;
          if (finished) { response.destroy(); return; }
          const excluded = new Set(String(response.headers.connection ?? "").toLowerCase().split(",").map(value => value.trim()));
          for (const name of res.getHeaderNames()) res.removeHeader(name);
          res.statusCode = response.statusCode ?? 502;
          res.setHeader("cache-control", "no-store");
          for (const name of RESPONSE_HEADERS) {
            if (!excluded.has(name) && response.headers[name] !== undefined) res.setHeader(name, response.headers[name]);
          }
          response.once("error", () => deny(502));
          response.once("aborted", () => deny(502));
          response.pipe(res);
        });
        upstream.once("error", () => deny(502));
        upstream.end(body);
      })().catch(() => deny(502));
    });
    return true;
  };
}
