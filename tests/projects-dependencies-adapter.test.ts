import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { ProjectsClient, ProjectsSourceError } from "../packages/adapters/projects/index.ts";

const accountId = "12345678-1234-4234-8234-123456789abc";
const projectId = "22345678-1234-4234-8234-123456789abc";
const otherProjectId = "42345678-1234-4234-8234-123456789abc";
const sourceTaskId = "32345678-1234-4234-8234-123456789abc";
const targetTaskId = "52345678-1234-4234-8234-123456789abc";
const relationId = "62345678-1234-4234-8234-123456789abc";
const user = "reader@example.test";
const principalId = "track-readonly";
const key = randomBytes(32);
const directories: string[] = [];

after(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "projects-dependencies-"));
  directories.push(directory);
  const secretFile = join(directory, "key.txt");
  const credentialFile = join(directory, "credentials.json");
  await writeFile(secretFile, key.toString("base64url"), "utf8");
  await writeFile(credentialFile, JSON.stringify({
    version: 1, user, accountId, principalId, kid: "track-kid", revision: 4, secretFile,
  }), "utf8");
  return { credentialFile, secretFile };
}

function client(credentialFile: string, fetcher: typeof fetch) {
  return new ProjectsClient({
    sourceId: "projects-main", baseUrl: "https://projects.example.test/",
    credentialFile, user, accountId, principalId, fetch: fetcher,
  });
}

async function checkRequest(input: RequestInfo | URL, init: RequestInit | undefined, path: string) {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  assert.equal(`${url.pathname}${url.search}`, `/api/integrations/assistant/v1${path}`);
  assert.equal(init?.method, "GET");
  assert.equal(init?.redirect, "error");
  assert.equal(init?.body, undefined);
  const headers = new Headers(init?.headers);
  const match = /^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(headers.get("authorization") ?? "");
  assert.ok(match?.[1] && match[2]);
  const [, encoded, signature] = match;
  assert.equal(createHmac("sha256", key).update(encoded!, "ascii").digest("base64url"), signature);
  const claims: unknown = JSON.parse(Buffer.from(encoded!, "base64url").toString("utf8"));
  assert.ok(Array.isArray(claims));
  assert.deepEqual(claims.slice(0, 3), [1, "projects", "track-kid"]);
  assert.equal(claims[6], "GET");
  assert.equal(claims[7], `/api/integrations/assistant/v1${path}`);
  assert.equal(claims[8], createHash("sha256").update(Buffer.alloc(0)).digest("hex"));
  assert.equal(claims[9], principalId);
  assert.equal(claims[10], 4);
}

const capabilities = (extra: Record<string, unknown> = {}) => ({
  version: 1, projectsRead: true, tasksRead: true, tasksCreate: false,
  tasksUpdate: false, resultsAttach: false, ...extra,
});

function task(id: string, project: string, extra: Record<string, unknown> = {}) {
  return {
    id, project_id: project, kind: "task", title: `Task ${id}`, revision: 3,
    data: { state: "future_state", body: "private body", requires_test: false, secret: "private" },
    body: "private body", arguments: { token: "private" }, ...extra,
  };
}

function page(items: unknown[], extra: Record<string, unknown> = {}) {
  return {
    version: 1, project_id: projectId, observed_at: "2026-11-12T01:02:03Z",
    items, has_more: false, ...extra,
  };
}

function edge(overrides: Record<string, unknown> = {}) {
  return {
    id: relationId, project_id: otherProjectId, relation: "depends_on",
    source_task: task(sourceTaskId, projectId, { data: { state: "future_state" } }),
    target_task: task(targetTaskId, otherProjectId),
    source_revision: 4, target_revision: 5, ...overrides,
  };
}

async function expect502(fetcher: typeof fetch, credentialFile: string) {
  await assert.rejects(client(credentialFile, fetcher).dependencies(projectId),
    (error: unknown) => error instanceof ProjectsSourceError && error.status === 502);
}

describe("Projects dependency read adapter", () => {
  it("uses signed capability and dependency GETs and returns allowlisted cross-project metadata", async () => {
    const { credentialFile } = await fixture();
    const paths: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const path = `${url.pathname}${url.search}`;
      paths.push(path);
      await checkRequest(input, init, path.replace("/api/integrations/assistant/v1", ""));
      return path.endsWith("/capabilities")
        ? Response.json(capabilities({ taskDependenciesRead: true }))
        : Response.json(page([edge()]));
    };
    const result = await client(credentialFile, fetcher).dependencies(projectId);
    assert.deepEqual(paths.map((path) => path.split("/api/integrations/assistant/v1")[1]), [
      "/capabilities", `/projects/${projectId}/task-dependencies`,
    ]);
    assert.deepEqual(result, {
      sourceId: "projects-main", projectId, observedAt: "2026-11-12T01:02:03Z",
      supported: true, hasMore: false,
      dependencies: [{
        id: relationId, projectId: otherProjectId, relation: "depends_on",
        fromTask: { id: sourceTaskId, projectId, title: `Task ${sourceTaskId}`, revision: "3", state: "unknown", requiresTest: true },
        toTask: { id: targetTaskId, projectId: otherProjectId, title: `Task ${targetTaskId}`, revision: "3", state: "unknown", requiresTest: false },
        fromRevision: "4", toRevision: "5",
      }],
    });
    assert.equal(JSON.stringify(result).includes("private"), false);
    assert.equal(JSON.stringify(result).includes("arguments"), false);
  });

  it("preserves capabilities shape and omits endpoint IO when optional capability is absent", async () => {
    const { credentialFile } = await fixture();
    let count = 0;
    const fetcher: typeof fetch = async (input, init) => {
      count++;
      await checkRequest(input, init, "/capabilities");
      return Response.json(capabilities());
    };
    const instance = client(credentialFile, fetcher);
    assert.deepEqual(await instance.capabilities(), { projectsRead: true, tasksRead: true });
    assert.deepEqual(await instance.dependencies(projectId), {
      sourceId: "projects-main", projectId, observedAt: null, supported: false,
      dependencies: [], hasMore: false,
    });
    assert.equal(count, 2);
  });

  it("distinguishes forbidden read flags, HTTP failures, and invalid capability grants", async () => {
    const { credentialFile } = await fixture();
    const forbidden = client(credentialFile, async () => Response.json(capabilities({ projectsRead: false })));
    await assert.rejects(forbidden.dependencies(projectId), (error: unknown) => error instanceof ProjectsSourceError && error.status === 403);
    const failed = client(credentialFile, async () => new Response("private response", { status: 403 }));
    await assert.rejects(failed.dependencies(projectId), (error: unknown) => error instanceof ProjectsSourceError && error.status === 403 && !error.message.includes("private"));
    const writable = client(credentialFile, async () => Response.json(capabilities({ tasksUpdate: true })));
    await assert.rejects(writable.dependencies(projectId), (error: unknown) => error instanceof ProjectsSourceError && error.status === 502);
  });

  it("rejects malformed pages, identity mismatches, duplicate relations, self edges and oversize pages", async () => {
    const { credentialFile } = await fixture();
    const malformedPages = [
      page([edge()], { project_id: otherProjectId }),
      page([edge({ id: "not-a-uuid" })]),
      page([edge({ source_task: task(sourceTaskId, otherProjectId), target_task: task(targetTaskId, otherProjectId), project_id: otherProjectId })]),
      page([edge(), edge()]),
      page([edge({ target_task: task(sourceTaskId, projectId) })]),
      page([edge({ source_revision: Number.MAX_SAFE_INTEGER + 1 })]),
      page([edge({ source_task: task(sourceTaskId, projectId, { kind: "artifact" }) })]),
      page([edge()], { observed_at: "yesterday" }),
      page(Array.from({ length: 201 }, (_, index) => edge({ id: `72345678-1234-4234-8234-${String(index).padStart(12, "0")}` }))),
    ];
    for (const value of malformedPages) {
      let calls = 0;
      await expect502(async () => {
        calls++;
        return calls === 1 ? Response.json(capabilities({ taskDependenciesRead: true })) : Response.json(value);
      }, credentialFile);
    }
  });

  it("validates canonical project UUID before IO and keeps native errors opaque", async () => {
    const { credentialFile } = await fixture();
    let calls = 0;
    const fetcher: typeof fetch = async () => { calls++; return Response.json({}); };
    await assert.rejects(client(credentialFile, fetcher).dependencies(projectId.toUpperCase()),
      (error: unknown) => error instanceof ProjectsSourceError && error.status === 400);
    assert.equal(calls, 0);
    const nativeFailure = client(credentialFile, async () => {
      calls++;
      return calls === 1
        ? Response.json(capabilities({ taskDependenciesRead: true }))
        : new Response("secret token /private/path", { status: 500 });
    });
    await assert.rejects(nativeFailure.dependencies(projectId), (error: unknown) => {
      assert.ok(error instanceof ProjectsSourceError);
      assert.equal(error.status, 500);
      assert.equal(error.message, "Projects source request failed (500)");
      return true;
    });
  });

  it("reads credential and secret files afresh for both requests", async () => {
    const { credentialFile, secretFile } = await fixture();
    let calls = 0;
    const originalKey = Buffer.from(key);
    const rotatedKey = randomBytes(32);
    const fetcher: typeof fetch = async (input, init) => {
      calls++;
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const auth = new Headers(init?.headers).get("authorization") ?? "";
      const match = /^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(auth);
      assert.ok(match?.[1] && match[2]);
      const expectedKey = calls === 1 ? originalKey : rotatedKey;
      assert.equal(createHmac("sha256", expectedKey).update(match[1]!, "ascii").digest("base64url"), match[2]);
      if (calls === 1) {
        await writeFile(secretFile, rotatedKey.toString("base64url"), "utf8");
        return Response.json(capabilities({ taskDependenciesRead: true }));
      }
      assert.ok(url.pathname.endsWith("/task-dependencies"));
      return Response.json(page([]));
    };
    const instance = client(credentialFile, fetcher);
    await instance.dependencies(projectId);
    assert.equal(calls, 2);
  });
});
