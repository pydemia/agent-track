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
import { prepareProjectsTaskCreate } from "../packages/adapters/projects/writer.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }

test("task creation HTTP keeps reader and creator separate, binds native receipts and handles lost responses without resend", { timeout: 20_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "track-task-api-"));
  const user = "owner@example.test"; const proxyKey = randomBytes(32).toString("hex");
  const proxyFile = join(root, "proxy"); await writeFile(proxyFile, proxyKey);
  async function credential(role: string) {
    const secretFile = join(root, role + ".key"); const file = join(root, role + ".json");
    await writeFile(secretFile, randomBytes(32).toString("base64url"));
    await writeFile(file, JSON.stringify({ version: 1, user, accountId: id(10), principalId: role, kid: role, revision: 1, secretFile })); return file;
  }
  const readerFile = await credential("reader"); const creatorFile = await credential("creator");
  let readerAllowed = true; let creatorAllowed = true; let writes = 0; let lost = false; let revokeAfterWrite = false;
  let revokeBeforeWrite = false; let creatorChecks = 0;
  let revokeReaderBeforeWrite = false;
  const receipts = new Map<string, object>();
  let config!: Config;
  const native = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    const token = request.headers.authorization?.split(" ")[1]?.split(".")[0];
    const claims = token ? JSON.parse(Buffer.from(token, "base64url").toString("utf8")) : [];
    const creator = claims[2] === "creator";
    if (request.url?.endsWith("/capabilities")) {
      if (creator) { creatorChecks++; if (revokeBeforeWrite && creatorChecks === 3) config.sources[0]!.taskCreateUsers = [];
        if (revokeReaderBeforeWrite && creatorChecks === 3) readerAllowed = false; }
      response.end(JSON.stringify({ version: 1, projectsRead: true, tasksRead: true,
        tasksCreate: creator && creatorAllowed, tasksUpdate: false, resultsAttach: false })); return;
    }
    if (request.url?.endsWith("/projects")) {
      response.end(JSON.stringify((creator ? creatorAllowed : readerAllowed) ? [{ id: id(1), name: "QA", version: 1, access_revision: 1, archived: false }] : [])); return;
    }
    if (request.method === "POST" && request.url === `/api/integrations/assistant/v1/projects/${id(1)}/tasks`) {
      assert.equal(creator, true, "native mutation must never use the reader credential");
      const chunks = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (!creatorAllowed) { response.writeHead(403); response.end("{}"); return; }
      const prepared = prepareProjectsTaskCreate(id(1), input); writes++;
      const result = { operation_id: input.operation_id, request_hash: prepared.nativeRequestHash,
        request_method: "POST", request_path: prepared.path, request_body_sha256: prepared.requestBodySha256,
        task: { id: randomUUID(), project_id: id(1), kind: "task", title: input.title, body: input.body,
          revision: 1, data: { state: "todo", requires_test: input.requires_test, acceptance_criteria: input.acceptance_criteria } } };
      receipts.set(input.operation_id, result);
      if (revokeAfterWrite) readerAllowed = false;
      if (lost) { lost = false; response.destroy(); return; }
      response.end(JSON.stringify(result)); return;
    }
    const operation = /\/operations\/([a-f0-9-]+)$/.exec(request.url ?? "");
    if (operation && creator && receipts.has(operation[1]!)) { response.end(JSON.stringify(receipts.get(operation[1]!))); return; }
    response.writeHead(404); response.end("{}");
  });
  const nativeBase = await listen(native);
  config = { port: 14345, database: ":memory:", publicOrigin: "https://track.example.test",
    auth: { mode: "proxy", users: [user], secretFile: proxyFile }, sources: [{ id: "projects", kind: "projects", label: "Projects", device: "fixture",
      users: [user], baseUrl: nativeBase, projectsUser: user, projectsAccountId: id(10), projectsPrincipalId: "reader", projectsCredentialFile: readerFile,
      projectsTaskCreatorCredentialFile: creatorFile, projectsTaskCreatorPrincipalId: "creator", taskCreateUsers: [user],
      runIds: [], discoverActive: false, repositoryRoots: [], maxFiles: 10, sinceDays: 7 }] };
  const store = new Store(":memory:"); const sources = new Sources(store, () => config);
  const { server } = createTrackServer(store, () => config, root, sources); const base = await listen(server);
  const headers = { "x-track-proxy-key": proxyKey, "x-forwarded-email": user, origin: config.publicOrigin, "content-type": "application/json" };
  const draft = () => ({ id: randomUUID(), sourceId: "projects", projectId: id(1), title: "QA title", body: "PRIVATE_BODY",
    acceptanceCriteria: ["PRIVATE_CRITERION"], requiresTest: true, expiresAt: new Date(Date.now() + 60_000).toISOString() });
  const post = (input: object, extra = {}) => fetch(base + "/api/projects/task-creation", { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(input) });
  const status = (project = id(1), extra = {}) => fetch(`${base}/api/projects/projects/${project}/task-creation`, { headers: { ...headers, ...extra } });
  try {
    assert.equal((await post(draft(), { origin: "https://elsewhere.test" })).status, 403);
    assert.equal((await post({ ...draft(), arbitrary: "no" })).status, 400);
    const ready = await status(); assert.equal(ready.status, 200); assert.equal((await ready.json()).enabled, true);
    const input = draft(); const response = await post(input); assert.equal(response.status, 200);
    const { receipt } = await response.json(); assert.equal(receipt.state, "created"); assert.equal(writes, 1);
    assert.doesNotMatch(JSON.stringify(receipt), /PRIVATE_|QA title/);
    const replay = await post(input); assert.equal(replay.status, 200); assert.deepEqual((await replay.json()).receipt, receipt); assert.equal(writes, 1);
    assert.equal((await post({ ...input, title: "Different" })).status, 409);
    lost = true; const uncertain = draft(); const lostResponse = await post(uncertain);
    assert.equal(lostResponse.status, 200); assert.equal((await lostResponse.json()).receipt.state, "unknown"); assert.equal(writes, 2);
    const recovered = await (await status()).json(); assert.equal(recovered.receipts.find((item: { id: string }) => item.id === uncertain.id).state, "created");
    assert.equal((await post(uncertain)).status, 200); assert.equal(writes, 2);
    assert.equal((await status(id(2))).status, 404);
    config.auth = { mode: "proxy", users: [user, "other@example.test"], secretFile: proxyFile };
    assert.equal((await post(draft())).status, 403);
    assert.equal((await status(id(1), { "x-forwarded-email": "other@example.test" })).status, 404);
    config.auth = { mode: "proxy", users: [user], secretFile: proxyFile };
    config.sources[0]!.projectsTaskCreatorPrincipalId = "reader";
    assert.equal((await (await status()).json()).enabled, false); assert.equal((await post(draft())).status, 403);
    config.sources[0]!.projectsTaskCreatorPrincipalId = "creator";
    creatorChecks = 0; revokeBeforeWrite = true; assert.equal((await post(draft())).status, 403); assert.equal(writes, 2);
    revokeBeforeWrite = false; config.sources[0]!.taskCreateUsers = [user];
    creatorChecks = 0; revokeReaderBeforeWrite = true;
    assert.equal((await post(draft())).status, 404); assert.equal(writes, 2, "reader scope revoked during creator preflight must stop native dispatch");
    revokeReaderBeforeWrite = false; readerAllowed = true;
    revokeAfterWrite = true; const privateCreate = draft(); assert.equal((await post(privateCreate)).status, 404);
    assert.equal((await status()).status, 404); assert.equal(writes, 3);
    readerAllowed = true; revokeAfterWrite = false;
    const restored = await (await status()).json(); assert.equal(restored.receipts.find((item: { id: string }) => item.id === privateCreate.id).state, "created");
    creatorAllowed = false; assert.equal((await (await status()).json()).enabled, false); assert.equal((await post(draft())).status, 403);
    const journal = JSON.stringify(store.db.prepare("SELECT * FROM task_creation_receipts").all());
    assert.doesNotMatch(journal, /PRIVATE_|QA title/);
  } finally {
    await close(server); await close(native); store.close();
    assert.equal(dirname(resolve(root)), resolve(tmpdir())); assert.ok(basename(root).startsWith("track-task-api-")); await rm(root, { recursive: true, force: true });
  }
});
