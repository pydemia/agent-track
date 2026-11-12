import { request } from "node:http";
import { Readable } from "node:stream";

const failure = () => new Error("Public gate verification failed");

/** A loopback-only, non-redirecting read with an explicit public Host header. */
export function requestPublicGate(path, headers, { port = 3100, timeoutMs = 15000 } = {}) {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || /[\x00-\x20\x7f]/.test(path) ||
      !Number.isInteger(port) || port < 1 || port > 65535 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw failure();
  return new Promise((resolve, reject) => {
    let timer;
    const clear = () => { if (timer) clearTimeout(timer); };
    let req;
    try {
      req = request({ hostname: "127.0.0.1", port, path, method: "GET", headers: { ...headers, Host: "demian.pydemia.ai", "Accept-Encoding": "identity" } }, res => {
        res.once("end", clear); res.once("close", clear);
        try {
          const status = res.statusCode ?? 502;
          if ([204, 205, 304].includes(status)) { res.resume(); resolve(new Response(null, { status })); return; }
          resolve(new Response(Readable.toWeb(res), { status, headers: { "Content-Type": String(res.headers["content-type"] ?? "application/octet-stream") } }));
        } catch { res.destroy(); reject(failure()); }
      });
    } catch { reject(failure()); return; }
    req.once("error", () => { clear(); reject(failure()); });
    timer = setTimeout(() => req.destroy(failure()), timeoutMs); timer.unref();
    req.end();
  });
}
