import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const origin = "https://track.pydemia.ai";
// Windows' native transport provides a reproducible alternative when Node's
// direct Cloudflare socket times out. It retains normal HTTPS validation and
// receives only these unauthenticated, synthetic public probes.
async function publicRequest(url, options = {}) {
  if (process.env.TRACK_PUBLIC_TRANSPORT !== "curl") return fetch(url, options);
  const args = ["--silent", "--show-error", "--max-time", "20", "--output", process.platform === "win32" ? "NUL" : "/dev/null", "--write-out", "%{json}"];
  if (options.method) args.push("--request", options.method);
  for (const [name, value] of Object.entries(options.headers ?? {})) args.push("--header", `${name}: ${value}`);
  if (options.body) args.push("--data-binary", options.body);
  args.push(url);
  const { stdout } = await promisify(execFile)("curl", args, { windowsHide: true, maxBuffer: 64 * 1024 });
  const result = JSON.parse(stdout);
  return new Response(null, { status: result.http_code, headers: result.redirect_url ? { location: result.redirect_url } : {} });
}
const results = [];
for (const [name, route, headers, expected] of [
  ["login", "/", {}, 302],
  ["snapshot-auth", "/api/snapshot", {}, 401],
  ["stream-auth", "/api/stream", {}, 401],
  ["artifact-auth", "/api/runs/unknown/artifacts", {}, 401],
  ["file-evidence-auth", "/api/runs/unknown/files", {}, 401],
  ["lineage-evidence-auth", "/api/runs/unknown/lineage", {}, 401],
  ["orchestration-support-auth", "/api/runs/unknown/orchestration", {}, 401],
  ["context-summary-public-auth", "/api/integrations/context/v1/projects/projects-native/7b0bc73a-8a1f-4111-9d7f-cc85efad3fea/tasks/a061ce29-f674-4449-86c3-2902b16713c5", {}, 401],
  ["tool-evidence-auth", "/api/runs/unknown/tools", {}, 401],
  ["permission-metadata-auth", "/api/runs/unknown/permissions", {}, 401],
  ["permission-review-auth", "/api/runs/unknown/permissions/00000000-0000-4000-8000-000000000001/review", {}, 401],
  ["approval-receipt-auth", "/api/approvals?run=unknown", {}, 401],
  ["task-creation-status-auth", "/api/projects/projects-native/7b0bc73a-8a1f-4111-9d7f-cc85efad3fea/task-creation", {}, 401],
  ["task-review-auth", "/api/projects/projects-native/7b0bc73a-8a1f-4111-9d7f-cc85efad3fea/tasks/a061ce29-f674-4449-86c3-2902b16713c5/review", {}, 401],
  ["assignment-sessions-auth", "/api/projects/projects-native/7b0bc73a-8a1f-4111-9d7f-cc85efad3fea/tasks/a061ce29-f674-4449-86c3-2902b16713c5/assignment-sessions", {}, 401],
  ["assignment-receipts-auth", "/api/projects/projects-native/7b0bc73a-8a1f-4111-9d7f-cc85efad3fea/tasks/a061ce29-f674-4449-86c3-2902b16713c5/assignments", {}, 401],
  ["public-basic-rejected", "/api/snapshot", { authorization: "Basic dGVzdDp0ZXN0" }, 401],
  ["forged-identity-rejected", "/api/snapshot", { "x-forwarded-email": "pydemia@pydemia.ai", "x-track-proxy-key": "forged-test-key" }, 401],
  ["forged-cookie-rejected", "/api/snapshot", { cookie: "__Host-agent-track=forged-test-cookie" }, 401],
]) {
  const response = await publicRequest(origin + route, { headers, redirect: "manual", signal: AbortSignal.timeout(15_000) });
  assert.equal(response.status, expected, name);
  if (name === "login") assert.equal(new URL(response.headers.get("location")).host, "login.microsoftonline.com");
  await response.body?.cancel();
  results.push({ name, status: response.status, passed: true });
}

const unauthenticatedDecision = await publicRequest(origin + "/api/commands/approval", { method: "POST", redirect: "manual",
  headers: { "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(15_000) });
assert.equal(unauthenticatedDecision.status, 401); await unauthenticatedDecision.body?.cancel();
results.push({ name: "approval-decision-auth", status: unauthenticatedDecision.status, passed: true });
const unauthenticatedTaskCreation = await publicRequest(origin + "/api/projects/task-creation", { method: "POST", redirect: "manual",
  headers: { "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(15_000) });
assert.equal(unauthenticatedTaskCreation.status, 401); await unauthenticatedTaskCreation.body?.cancel();
results.push({ name: "task-creation-post-auth", status: unauthenticatedTaskCreation.status, passed: true });
for (const [name, route] of [["task-assignment-post-auth", "/api/projects/task-assignments"], ["assignment-reconcile-auth", "/api/projects/task-assignments/00000000-0000-4000-8000-000000000001/reconcile"]]) {
  const response = await publicRequest(origin + route, { method: "POST", redirect: "manual", headers: { "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(15_000) });
  assert.equal(response.status, 401); await response.body?.cancel(); results.push({ name, status: response.status, passed: true });
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
console.log(JSON.stringify({ verifiedAt: new Date().toISOString(), scope: "unauthenticated-public-and-operator-hop", publicTransport: process.env.TRACK_PUBLIC_TRANSPORT === "curl" ? "curl-https" : "node-fetch", browserLoginVerified: false, results }, null, 2));
