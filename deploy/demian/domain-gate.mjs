import http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";

const digest = value => createHash("sha256").update(value).digest();
const hop = new Set(["connection", "proxy-connection", "keep-alive", "te", "trailer", "transfer-encoding", "upgrade", "proxy-authenticate", "proxy-authorization"]);
const cleanHeaders = headers => {
  const nominated = new Set(String(headers.connection ?? "").split(",").map(value => value.trim().toLowerCase()));
  return Object.fromEntries(Object.entries(headers).filter(([key, value]) => value !== undefined && !hop.has(key.toLowerCase()) && !nominated.has(key.toLowerCase())));
};

/** Existing browser gate plus an independently authenticated service route. */
export function createDomainGate({ hostname, webPort, login, delegated }) {
  if (typeof hostname !== "string" || !/^[a-z0-9.-]+$/.test(hostname) || !Number.isInteger(webPort) || webPort < 1 || webPort > 65535
      || typeof login?.username !== "string" || !login.username || typeof login?.password !== "string" || !login.password
      || (delegated !== undefined && typeof delegated !== "function")) throw new Error("Invalid domain gate configuration");
  const expected = digest(`${login.username}:${login.password}`);
  return async (req, res) => {
    const deny = (status, message) => {
      res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store, no-cache, no-transform",
        ...(status === 401 ? { "www-authenticate": 'Basic realm="Demian", charset="UTF-8"' } : {}) });
      res.end(message);
    };
    try {
      if (req.headers.host !== hostname && req.headers.host !== hostname + ":443") return deny(404, "Not found");
      if (!req.url?.startsWith("/") || req.url.startsWith("//")) return deny(400, "Invalid request");
      if (delegated && await delegated(req, res)) return;
      const authCount = req.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === "authorization").length;
      const match = typeof req.headers.authorization === "string" ? req.headers.authorization.match(/^Basic ([A-Za-z0-9+/]+={0,2})$/i) : null;
      if (authCount !== 1 || !match) return deny(401, "Authentication required");
      const supplied = Buffer.from(match[1], "base64");
      if (supplied.toString("base64").replace(/=+$/u, "") !== match[1].replace(/=+$/u, "") || !timingSafeEqual(digest(supplied), expected)) return deny(401, "Authentication required");
      const headers = cleanHeaders(req.headers);
      for (const key of Object.keys(headers)) if (key === "authorization" || key.startsWith("cf-access-") || key.startsWith("x-forwarded-") || key === "forwarded") delete headers[key];
      headers.host = hostname;
      headers["x-forwarded-proto"] = "https";
      headers["x-forwarded-host"] = hostname;
      const upstream = http.request({ hostname: "127.0.0.1", port: webPort, path: req.url, method: req.method, headers, timeout: 0 }, remote => {
        const responseHeaders = cleanHeaders(remote.headers);
        responseHeaders["cache-control"] = "private, no-store, no-cache, no-transform";
        const vary = String(remote.headers.vary ?? "");
        responseHeaders.vary = vary === "*" ? "*" : [vary, "Authorization"].filter(Boolean).join(", ");
        responseHeaders["referrer-policy"] = "same-origin";
        responseHeaders["x-content-type-options"] = "nosniff";
        responseHeaders["strict-transport-security"] = "max-age=31536000";
        res.writeHead(remote.statusCode ?? 502, responseHeaders);
        remote.on("error", () => res.destroy());
        remote.pipe(res);
      });
      upstream.on("error", () => { if (!res.headersSent) deny(502, "Origin unavailable"); else res.destroy(); });
      req.on("aborted", () => upstream.destroy());
      res.on("close", () => { if (!res.writableEnded) upstream.destroy(); });
      req.pipe(upstream);
    } catch { if (!res.headersSent) deny(502, "Origin unavailable"); else res.destroy(); }
  };
}
