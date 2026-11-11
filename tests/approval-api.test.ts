import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createTrackServer } from "../apps/api/server.ts";
import type { Config } from "../apps/api/config.ts";
import type { Sources } from "../apps/api/runner.ts";
import type { SourceView } from "../packages/contracts/index.ts";
import { Store } from "../packages/storage/store.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }

test("approval HTTP keeps arguments opt-in, enforces current owner/Project/origin and reconciles lost acknowledgements without writes", { timeout: 20_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "track-approval-api-")); const user = "owner@example.com";
  const secret = "fixture-proxy-key-32-characters-minimum"; const secretFile = join(directory, "proxy-key"); writeFileSync(secretFile, secret);
  const now = new Date().toISOString(); let posts = 0; let loseReply = false;
  let policy = true; let cachedGrant = true; let holdList = false;
  let waiting!: () => void; const waitingRead = new Promise<void>((resolve) => { waiting = resolve; });
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  const requests = [1, 2].map((n) => ({ id: id(10 + n), object: "demian.permission_request", run_id: id(1), call_id: `call${n}`, tool: "write_file",
    input: { path: `qa${n}.txt`, content: "PRIVATE_TOOL_ARGUMENT" }, actor: "build", reason: "PRIVATE_REASON", status: "pending", decision: null as string | null,
    created_at: now, resolved_at: null as string | null, expires_at: new Date(Date.now() + 300_000).toISOString() }));
  const native = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === `/api/v1/runs/${id(1)}`) { response.end(JSON.stringify({ id: id(1), session_id: id(2), status: "waiting_for_permission", created_at: now, started_at: now, completed_at: null })); return; }
    if (request.url === `/api/v1/sessions/${id(2)}`) { response.end(JSON.stringify({ id: id(2), workspace_id: id(3), title: "QA" })); return; }
    if (request.url === `/api/v1/runs/${id(1)}/permissions`) {
      if (holdList) { waiting(); await gate; }
      response.end(JSON.stringify({ object: "list", data: requests })); return;
    }
    const target = requests.find((item) => request.url === `/api/v1/runs/${id(1)}/permissions/${item.id}/decision`);
    if (target && request.method === "POST") {
      posts++; const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      target.status = "resolved"; target.decision = JSON.parse(Buffer.concat(chunks).toString()).decision; target.resolved_at = new Date().toISOString();
      if (loseReply) { response.destroy(); return; }
      response.end(JSON.stringify(target)); return;
    }
    response.writeHead(404); response.end("{}");
  });
  const nativeBase = await listen(native); const store = new Store(":memory:");
  const config: Config = { port: 14345, database: ":memory:", publicOrigin: "https://track.example.com", auth: { mode: "proxy", secretFile, users: [user] },
    sources: [{ id: "native", kind: "demian", label: "fixture", device: "fixture", users: [user], approvalUsers: [], baseUrl: nativeBase,
      runIds: [], discoverActive: false, repositoryRoots: [], maxFiles: 10, sinceDays: 7 }] };
  const key = store.observeRun({ sourceId: "native", runId: id(1), sessionId: id(2), workspaceId: id(3), title: "QA", status: "waiting_for_permission", createdAt: now, startedAt: now, completedAt: null, observedAt: now });
  store.bind({ sourceId: "native", runId: id(1), projectSourceId: "projects", projectId: id(4), taskId: id(5), taskRevision: "1", projectTitle: "QA Project", taskTitle: "QA Task", provenance: "operator" }, user);
  const sources = { refreshProjectGrants: async () => { cachedGrant = policy; }, views: (actor: string): SourceView[] => actor !== user ? [] : [
    { id: "native", kind: "demian", label: "fixture", device: "fixture", state: "connected", lastObservedAt: now, detail: "fixture", capabilities: ["session.link", "permission.decide"] },
    { id: "projects", kind: "projects", label: "fixture", device: "fixture", state: "connected", lastObservedAt: now, detail: "fixture", capabilities: ["projects.read"], authorizedProjectIds: cachedGrant ? [id(4)] : [] },
  ] } as unknown as Sources;
  const { server } = createTrackServer(store, () => config, directory, sources); const base = await listen(server);
  const headers = { "x-track-proxy-key": secret, "x-forwarded-email": user, "content-type": "application/json", origin: config.publicOrigin };
  const get = (path: string, extra = {}) => fetch(base + path, { headers: { ...headers, ...extra } });
  const post = (body: unknown, extra = {}) => fetch(base + "/api/commands/approval", { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body) });
  try {
    const metadata = await (await get(`/api/runs/${key}/permissions`)).json();
    assert.equal(metadata.requests.length, 2); assert.doesNotMatch(JSON.stringify(metadata), /PRIVATE_|qa1.txt|reviewText|"input"/);
    const review = await get(`/api/runs/${key}/permissions/${id(11)}/review`); assert.equal(review.status, 200); assert.match((await review.json()).reviewText, /PRIVATE_TOOL_ARGUMENT/);
    const input = { id: randomUUID(), runKey: key, permissionId: id(11), fingerprint: metadata.requests[0].fingerprint, decision: "allow_once", expiresAt: new Date(Date.now() + 90_000).toISOString() };
    assert.equal((await post(input, { origin: "https://untrusted.example" })).status, 403);
    assert.equal((await post(input)).status, 403, "native decisions require explicit owner opt-in"); assert.equal(posts, 0);
    config.sources[0]!.approvalUsers = [user];
    const first = await post(input); assert.equal(first.status, 200); const receipt = (await first.json()).receipt; assert.equal(receipt.state, "succeeded");
    const duplicate = await post(input); assert.equal(duplicate.status, 200); assert.deepEqual((await duplicate.json()).receipt, receipt); assert.equal(posts, 1);
    loseReply = true;
    const unknown = await post({ ...input, id: randomUUID(), permissionId: id(12), fingerprint: metadata.requests[1].fingerprint, decision: "deny" });
    assert.equal(unknown.status, 200); assert.equal((await unknown.json()).receipt.state, "unknown"); assert.equal(posts, 2);
    const records = await (await get(`/api/approvals?run=${key}`)).json(); assert.equal(records.receipts.length, 2); assert.ok(records.receipts.every((item: { state: string }) => item.state === "succeeded")); assert.equal(posts, 2);
    const durable = store.db.prepare("SELECT payload FROM approval_receipts").all(); assert.doesNotMatch(JSON.stringify(durable), /PRIVATE_|qa1.txt|reviewText|"input"/);
    holdList = true;
    const pendingReview = get(`/api/runs/${key}/permissions/${id(11)}/review`); await waitingRead; policy = false; release();
    assert.equal((await pendingReview).status, 404, "a revoked Project must hide an already awaited private review");
    assert.equal((await get(`/api/approvals?run=${key}`)).status, 404); assert.equal(posts, 2);
  } finally { release(); await close(server); await close(native); store.close(); rmSync(directory, { recursive: true, force: true }); }
});
