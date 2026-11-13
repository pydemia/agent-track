import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import test from "node:test";
import { createDomainGate } from "../deploy/demian/domain-gate.mjs";

test("browser gate preserves existing login, strips spoofed identities and delegates service requests independently", async t => {
  const received: { url: string | undefined; headers: http.IncomingHttpHeaders }[] = [];
  const web = http.createServer((req, res) => { received.push({ url: req.url, headers: req.headers }); res.setHeader("vary", "Accept-Encoding"); res.end("browser"); });
  web.listen(0, "127.0.0.1"); await once(web, "listening");
  t.after(async () => { web.closeAllConnections(); await new Promise<void>(resolve => web.close(() => resolve())); });
  const address = web.address(); assert.ok(address && typeof address !== "string");
  const handler = createDomainGate({ hostname: "demian.synthetic.invalid", webPort: address.port, login: { username: "synthetic", password: "synthetic-password" },
    delegated: async (req, res) => { if (!req.headers["x-demian-delegation"]) return false; res.writeHead(403, { "cache-control": "no-store" }); res.end("Denied service"); return true; } });
  const gate = http.createServer((req, res) => { void handler(req, res); });
  gate.listen(0, "127.0.0.1"); await once(gate, "listening");
  t.after(async () => { gate.closeAllConnections(); await new Promise<void>(resolve => gate.close(() => resolve())); });
  const endpoint = gate.address(); assert.ok(endpoint && typeof endpoint !== "string");
  const request = (headers: Record<string, string>) => new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    http.get({ hostname: "127.0.0.1", port: endpoint.port, path: "/sessions/selected", headers: { host: "demian.synthetic.invalid", ...headers } }, response => {
      let body = ""; response.setEncoding("utf8"); response.on("data", chunk => { body += chunk; }); response.on("end", () => resolve({ status: response.statusCode!, headers: response.headers, body }));
    }).on("error", reject);
  });
  assert.equal((await request({})).status, 401);
  assert.equal((await request({ authorization: "Basic " + Buffer.from("synthetic:wrong").toString("base64") })).status, 401);
  const authorization = "Basic " + Buffer.from("synthetic:synthetic-password").toString("base64");
  const response = await request({ authorization, "cf-access-authenticated-user-email": "spoofed", "x-forwarded-email": "spoofed", forwarded: "spoofed", cookie: "browser-session=synthetic" });
  assert.equal(response.status, 200); assert.equal(response.body, "browser");
  assert.match(String(response.headers["cache-control"]), /no-store/); assert.match(String(response.headers.vary), /Authorization/);
  assert.equal(received[0]!.url, "/sessions/selected");
  assert.equal(received[0]!.headers.authorization, undefined); assert.equal(received[0]!.headers["x-forwarded-email"], undefined);
  assert.equal(received[0]!.headers["cf-access-authenticated-user-email"], undefined); assert.equal(received[0]!.headers.forwarded, undefined);
  assert.equal(received[0]!.headers.cookie, "browser-session=synthetic"); assert.equal(received[0]!.headers["x-forwarded-proto"], "https");
  assert.equal((await request({ authorization, "x-demian-delegation": "invalid" })).status, 403);
  assert.equal(received.length, 1, "claimed service request cannot fall back to browser authority");
  assert.equal((await request({ authorization, host: "untrusted.invalid" })).status, 404);
});
