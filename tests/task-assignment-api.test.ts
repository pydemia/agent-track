import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { Config } from "../apps/api/config.ts";
import { Sources } from "../apps/api/runner.ts";
import { createTrackServer } from "../apps/api/server.ts";
import { Store } from "../packages/storage/store.ts";
import { externalKey } from "../packages/contracts/index.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function listen(server: Server) { await new Promise<void>((done) => server.listen(0, "127.0.0.1", done)); const address = server.address(); assert.ok(address && typeof address !== "string"); return `http://127.0.0.1:${address.port}`; }
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())); }

test("assignment HTTP joins an explicit Task review to native request acceptance and recovers binding without rerunning", { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "track-assignment-api-")); const user = "owner@example.test";
  const proxyKey = randomBytes(32).toString("hex"); const nativeKey = randomBytes(32).toString("hex");
  const proxyFile = join(root, "proxy"); const nativeFile = join(root, "native"); const keyFile = join(root, "reader.key"); const credentialFile = join(root, "reader.json");
  await writeFile(proxyFile, proxyKey); await writeFile(nativeFile, nativeKey); await writeFile(keyFile, randomBytes(32).toString("base64url"));
  await writeFile(credentialFile, JSON.stringify({ version: 1, user, accountId: id(10), principalId: "reader", kid: "reader", revision: 1, secretFile: keyFile }));
  let granted = true; let writes = 0; let lost = false; let revision = 1; let reviewReads = 0; let revokeAtReview = 0;
  const nativeRuns = new Map<string, Record<string, unknown>>(); const operations = new Map<string, Record<string, unknown>>(); const at = new Date().toISOString();
  const session = { id: id(3), object: "demian.session", workspace_id: id(4), title: "QA Session", agent: "build", provider: "test", model: "test", mode: "single-agent", permission_policy: "ask", active_run_id: null, archived_at: null };
  const native = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url?.startsWith("/api/integrations/assistant/v1")) {
      assert.match(request.headers.authorization ?? "", /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      assert.equal(request.method, "GET", "Task assignment never writes or completes the source Task");
      if (request.url.endsWith("/capabilities")) { response.end(JSON.stringify({ version: 1, projectsRead: true, tasksRead: true, tasksCreate: false, tasksUpdate: false, resultsAttach: false })); return; }
      if (request.url.endsWith("/projects")) { response.end(JSON.stringify(granted ? [{ id: id(1), name: "QA", version: 1, access_revision: 1, archived: false }] : [])); return; }
      if (request.url.endsWith(`/tasks/${id(2)}`)) {
        if (!granted) { response.writeHead(403).end("{}"); return; }
        reviewReads++; if (revokeAtReview === reviewReads) granted = false;
        response.end(JSON.stringify({ id: id(2), project_id: id(1), kind: "task", title: "QA Task", revision, body: "PRIVATE_TASK_BODY",
          data: { state: "todo", requires_test: true, acceptance_criteria: ["PRIVATE_CRITERION"] } })); return;
      }
      response.writeHead(404).end("{}"); return;
    }
    assert.equal(request.headers.authorization, `Bearer ${nativeKey}`);
    if (request.url === `/api/v1/sessions/${id(3)}`) { response.end(JSON.stringify(session)); return; }
    if (request.url === `/api/v1/sessions/${id(3)}/runs` && request.method === "POST") {
      // Assert the producer's actual header; a similarly named header must not pass.
      const operationId = request.headers["idempotency-key"]; assert.equal(typeof operationId, "string"); assert.equal(request.headers["nativeidempotency-key"], undefined);
      const chunks = []; for await (const chunk of request) chunks.push(Buffer.from(chunk)); const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      assert.deepEqual(Object.keys(body), ["input"]); const runId = randomUUID(); writes++;
      const run = { id: runId, object: "demian.run", session_id: id(3), status: "succeeded", input: body.input, output_text: "PRIVATE_OUTPUT", created_at: at, started_at: at, completed_at: at };
      nativeRuns.set(runId, run); operations.set(String(operationId), run);
      if (lost) { lost = false; response.destroy(); return; }
      response.writeHead(202).end(JSON.stringify(run)); return;
    }
    const requestStatus = /\/requests\/([0-9a-f-]+)$/.exec(request.url ?? "");
    if (requestStatus) { const run = operations.get(requestStatus[1]!); response.end(JSON.stringify({ object: "demian.run_request_status", request_id: requestStatus[1], status: run ? "found" : "not_found", run: run ?? null })); return; }
    const runRead = /^\/api\/v1\/runs\/([0-9a-f-]+)$/.exec(request.url ?? "");
    if (runRead && nativeRuns.has(runRead[1]!)) { response.end(JSON.stringify(nativeRuns.get(runRead[1]!))); return; }
    response.writeHead(404).end("{}");
  });
  const nativeBase = await listen(native);
  const config: Config = { port: 14345, database: ":memory:", publicOrigin: "https://track.example.test", auth: { mode: "proxy", secretFile: proxyFile, users: [user] }, sources: [
    { id: "projects", kind: "projects", label: "Projects", device: "fixture", users: [user], baseUrl: nativeBase, projectsUser: user, projectsAccountId: id(10), projectsPrincipalId: "reader", projectsCredentialFile: credentialFile,
      assignmentProjectIds: [id(1)], runIds: [], discoverActive: false, repositoryRoots: [], maxFiles: 10, sinceDays: 7 },
    { id: "native", kind: "demian", label: "Demian", device: "fixture", users: [user], baseUrl: nativeBase, tokenFile: nativeFile, assignmentUsers: [user], assignmentSessionIds: [id(3)],
      runIds: [], discoverActive: false, repositoryRoots: [], maxFiles: 10, sinceDays: 7 },
  ] };
  const store = new Store(":memory:"); const sources = new Sources(store, () => config); const { server } = createTrackServer(store, () => config, root, sources); const base = await listen(server);
  const running = sources.start();
  const headers = { "x-track-proxy-key": proxyKey, "x-forwarded-email": user, origin: config.publicOrigin, "content-type": "application/json" };
  const taskPath = `/api/projects/projects/${id(1)}/tasks/${id(2)}`;
  const read = (path: string) => fetch(base + path, { headers });
  const post = (input: object, extra: Record<string, string> = {}) => fetch(base + "/api/projects/task-assignments", { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(input) });
  try {
    const reviewResponse = await read(taskPath + "/review"); assert.equal(reviewResponse.status, 200); const review = await reviewResponse.json();
    assert.equal(review.body, "PRIVATE_TASK_BODY"); assert.equal(review.complete, true);
    const optionsResponse = await read(taskPath + "/assignment-sessions"); assert.equal(optionsResponse.status, 200); const options = await optionsResponse.json(); assert.equal(options.sessions.length, 1);
    const input = () => ({ id: randomUUID(), projectSourceId: "projects", projectId: id(1), taskId: id(2), taskRevision: "1", reviewSha256: review.reviewSha256,
      demianSourceId: "native", sessionId: id(3), sessionSha256: options.sessions[0].sessionSha256, instructions: "PRIVATE_INSTRUCTION", expiresAt: new Date(Date.now() + 60_000).toISOString() });
    assert.equal((await post(input(), { origin: "https://other.invalid" })).status, 403); assert.equal(writes, 0);
    const first = input(); const response = await post(first); assert.equal(response.status, 200); const accepted = (await response.json()).receipt;
    assert.equal(accepted.state, "accepted"); assert.equal(accepted.bindingState, "bound"); assert.equal(writes, 1);
    assert.equal((await post(first)).status, 200); assert.equal(writes, 1);
    assert.equal((await post({ ...first, instructions: "changed" })).status, 409); assert.equal(writes, 1);
    const binding = JSON.parse(store.run(externalKey("native", accepted.runId))!.binding!);
    assert.equal(binding.taskId, id(2)); assert.equal(binding.taskRevision, "1");
    config.sources[1]!.assignmentSessionIds!.push(id(99));
    const expanded = await read(taskPath + "/assignments");
    assert.equal((await expanded.json()).receipts.find((value: { id: string }) => value.id === first.id)?.state, "accepted", "adding another Session must not invalidate the original still-authorized receipt");
    config.sources[1]!.assignmentSessionIds!.pop();

    lost = true; const uncertainInput = input(); const lostResponse = await post(uncertainInput); assert.equal(lostResponse.status, 200);
    assert.equal((await lostResponse.json()).receipt.state, "unknown"); assert.equal(writes, 2);
    const status = await read(taskPath + "/assignments"); assert.equal(status.status, 200); const confirmed = (await status.json()).receipts.find((value: { id: string }) => value.id === uncertainInput.id);
    assert.equal(confirmed.state, "accepted"); assert.equal(confirmed.bindingState, "bound"); assert.equal(writes, 2);

    store.db.exec("CREATE TRIGGER temporary_binding_failure BEFORE INSERT ON bindings BEGIN SELECT RAISE(ABORT,'temporary QA failure'); END");
    const pendingResponse = await post(input()); const pending = (await pendingResponse.json()).receipt;
    assert.equal(pending.state, "accepted"); assert.equal(pending.bindingState, "pending"); assert.equal(writes, 3);
    assert.equal(store.run(externalKey("native", pending.runId))?.binding, null);
    granted = false;
    const deniedPending = await read("/api/snapshot"); assert.equal((await deniedPending.json()).runs.length, 0, "a known Task Run keeps Project scope even before its binding is repaired");
    assert.equal((await read(`/api/runs/${externalKey("native", pending.runId)}/tools`)).status, 404);
    assert.equal((await read(`/api/runs/${externalKey("native", pending.runId)}/lineage`)).status, 404);
    granted = true;
    store.db.exec("DROP TRIGGER temporary_binding_failure");
    const repaired = await read(taskPath + "/assignments"); assert.equal((await repaired.json()).receipts.find((value: { id: string }) => value.id === pending.id).bindingState, "bound"); assert.equal(writes, 3);

    revision = 2; assert.equal((await post(input())).status, 409); assert.equal(writes, 3); revision = 1;
    revokeAtReview = reviewReads + 2; assert.equal((await post(input())).status, 404); assert.equal(writes, 3);
    assert.equal(store.db.prepare("SELECT state FROM task_assignment_receipts ORDER BY rowid DESC LIMIT 1").get()?.state, "failed");
    const hidden = await read("/api/snapshot"); assert.equal((await hidden.json()).runs.length, 0);
    assert.equal((await read(taskPath + "/review")).status, 404);
    granted = true; revokeAtReview = 0;
    assert.equal((await read(taskPath + "/assignments")).status, 200); assert.equal(writes, 3);
    const rows = store.db.prepare("SELECT * FROM task_assignment_receipts").all();
    assert.doesNotMatch(JSON.stringify(rows), /PRIVATE_TASK_BODY|PRIVATE_INSTRUCTION|PRIVATE_CRITERION|PRIVATE_OUTPUT/);
    assert.doesNotMatch(JSON.stringify(store.db.prepare("SELECT * FROM events").all()), /PRIVATE_/);
  } finally {
    sources.stop(); await running; await close(server); await close(native); store.close();
    const absolute = resolve(root); assert.equal(dirname(absolute), resolve(tmpdir())); assert.ok(basename(absolute).startsWith("track-assignment-api-"));
    await rm(absolute, { recursive: true, force: true });
  }
});
