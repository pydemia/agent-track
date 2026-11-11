import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ProjectsAuthority } from "../apps/api/projects-authority.ts";
import type { Config } from "../apps/api/config.ts";
import { Store } from "../packages/storage/store.ts";
import type { SourceView } from "../packages/contracts/index.ts";

test("native Project grants stay user-bound, refresh after each request and serialize revocation checks", { timeout: 10_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "track-project-grants-"));
  const id = "11111111-1111-4111-8111-111111111111";
  const accountId = "22222222-2222-4222-8222-222222222222";
  const user = "owner@example.com";
  const secretFile = join(directory, "reader-key"); writeFileSync(secretFile, randomBytes(32).toString("base64url"));
  const credentialFile = join(directory, "reader.json");
  writeFileSync(credentialFile, JSON.stringify({ version: 1, user, accountId, principalId: "readonly", kid: "fixture-key", revision: 1, secretFile }));
  let allowed = true;
  let calls = 0;
  let projectsCalls = 0;
  let holdNext = false;
  let waiting!: () => void;
  const waitingRequest = new Promise<void>((resolve) => { waiting = resolve; });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let outstanding = 0;
  let maximumOutstanding = 0;
  const native = createServer(async (request, response) => {
    calls++; response.setHeader("Content-Type", "application/json");
    if (request.url?.endsWith("/capabilities")) {
      response.end(JSON.stringify({ version: 1, projectsRead: allowed, tasksRead: allowed, tasksCreate: false, tasksUpdate: false, resultsAttach: false })); return;
    }
    if (!request.url?.endsWith("/projects")) { response.writeHead(404); response.end("{}"); return; }
    projectsCalls++; outstanding++; maximumOutstanding = Math.max(maximumOutstanding, outstanding);
    const captured = allowed;
    if (holdNext) { holdNext = false; waiting(); await gate; }
    response.end(JSON.stringify(captured ? [{ id, name: "allowed project", version: 1, access_revision: 2, archived: false, goal: "PRIVATE_BODY" }] : []));
    outstanding--;
  });
  await new Promise<void>((resolve) => native.listen(0, "127.0.0.1", resolve));
  const address = native.address(); assert.ok(address && typeof address !== "string");
  const config: Config = { port: 14345, database: ":memory:", publicOrigin: "https://track.example", auth: { mode: "proxy", users: [user, "other@example.com"], secretFile },
    sources: [{ id: "projects-native", kind: "projects", label: "Projects", device: "test", users: [user, "other@example.com"],
      baseUrl: `http://127.0.0.1:${address.port}`, projectsCredentialFile: credentialFile, projectsUser: user, projectsAccountId: accountId, projectsPrincipalId: "readonly",
      runIds: [], discoverActive: false, repositoryRoots: [], maxFiles: 10, sinceDays: 7 }] };
  const store = new Store(":memory:");
  const authority = new ProjectsAuthority(store, () => config);
  const source = config.sources[0]!;
  const now = new Date().toISOString();
  store.observeRun({ sourceId: "runtime", runId: "run", sessionId: "session", workspaceId: null, title: "private-bound-run", status: "succeeded", createdAt: now, startedAt: now, completedAt: now, observedAt: now });
  store.bind({ sourceId: "runtime", runId: "run", projectSourceId: source.id, projectId: id, taskId: "task", taskRevision: "1", projectTitle: "private-project-title", taskTitle: "private-task-title", provenance: "operator" }, user);
  const runtime: SourceView = { id: "runtime", kind: "demian", label: "runtime", device: "test", state: "connected", lastObservedAt: now, detail: "fixture", capabilities: ["run.read"] };
  try {
    await authority.refresh(user);
    assert.equal(store.snapshot(user, [runtime, authority.view(source, user)]).runs.length, 1);
    assert.doesNotMatch(JSON.stringify(authority.catalog(source.id, user)), /PRIVATE_BODY|owner_id/);
    const beforeOther = calls;
    await authority.refresh("other@example.com");
    assert.equal(calls, beforeOther, "another Track actor must not borrow the owner's native reader");
    assert.equal(store.snapshot("other@example.com", [runtime, authority.view(source, "other@example.com")]).runs.length, 0);
    holdNext = true;
    const earlier = authority.refresh(user); await waitingRequest;
    allowed = false;
    const later = authority.refresh(user);
    release(); await Promise.all([earlier, later]);
    assert.equal(maximumOutstanding, 1);
    assert.equal(projectsCalls, 2, "revoked capabilities must stop before the Project list request");
    const revoked = store.snapshot(user, [runtime, authority.view(source, user)]);
    assert.equal(revoked.runs.length, 0);
    assert.doesNotMatch(JSON.stringify(revoked), /private-bound-run|private-project-title|private-task-title/);
    assert.deepEqual(authority.catalog(source.id, user), []);
    assert.equal(authority.view(source, user).state, "forbidden", "empty lists cannot manufacture read capabilities");
    assert.deepEqual(authority.view(source, user).capabilities, []);
  } finally { release(); native.closeAllConnections(); await new Promise<void>((resolve) => native.close(() => resolve())); store.close(); rmSync(directory, { recursive: true, force: true }); }
});
