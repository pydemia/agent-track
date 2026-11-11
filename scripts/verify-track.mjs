import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const origin = "https://track.pydemia.ai";
const results = [];
for (const [name, route, headers, expected] of [
  ["login", "/", {}, 302],
  ["snapshot-auth", "/api/snapshot", {}, 401],
  ["stream-auth", "/api/stream", {}, 401],
  ["artifact-auth", "/api/runs/unknown/artifacts", {}, 401],
  ["public-basic-rejected", "/api/snapshot", { authorization: "Basic dGVzdDp0ZXN0" }, 401],
  ["forged-identity-rejected", "/api/snapshot", { "x-forwarded-email": "pydemia@pydemia.ai", "x-track-proxy-key": "forged-test-key" }, 401],
  ["forged-cookie-rejected", "/api/snapshot", { cookie: "__Host-agent-track=forged-test-cookie" }, 401],
]) {
  const response = await fetch(origin + route, { headers, redirect: "manual", signal: AbortSignal.timeout(15_000) });
  assert.equal(response.status, expected, name);
  if (name === "login") assert.equal(new URL(response.headers.get("location")).host, "login.microsoftonline.com");
  await response.body?.cancel();
  results.push({ name, status: response.status, passed: true });
}

// Operator-only hop validation. No browser session/token is read or copied.
if (process.env.TRACK_CONFIG) {
  const config = JSON.parse(await readFile(process.env.TRACK_CONFIG, "utf8"));
  assert.equal(config.auth.mode, "proxy");
  const headers = { "x-track-proxy-key": (await readFile(config.auth.secretFile, "utf8")).trim(), "x-forwarded-email": config.auth.users[0] };
  const base = `http://127.0.0.1:${config.port}`;
  const snapshotResponse = await fetch(base + "/api/snapshot", { headers });
  assert.equal(snapshotResponse.status, 200);
  const snapshot = await snapshotResponse.json();
  results.push({ name: "operator-snapshot", passed: true, runs: snapshot.runs.length, workspaces: new Set(snapshot.runs.map((r) => r.workspaceId)).size });
  const html = await readFile("dist/web/index.html", "utf8");
  for (const [, route] of html.matchAll(/href="([^"]*favicon[^"]*)"/g)) {
    const response = await fetch(base + route, { headers });
    assert.equal(response.status, 200);
    const contentType = response.headers.get("content-type");
    assert.ok(contentType?.startsWith("image/"));
    const actual = Buffer.from(await response.arrayBuffer());
    const expected = await readFile("dist/web" + route);
    const hash = (value) => createHash("sha256").update(value).digest("hex");
    assert.equal(hash(actual), hash(expected));
    results.push({ name: "operator-icon", route, contentType, bytes: actual.length, sha256: hash(actual), passed: true });
  }
}
console.log(JSON.stringify({ verifiedAt: new Date().toISOString(), scope: "unauthenticated-public-and-operator-hop", browserLoginVerified: false, results }, null, 2));
