import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { ProjectsClient, ProjectsSourceError } from "../packages/adapters/projects/index.ts";

const accountId = "12345678-1234-4234-8234-123456789abc";
const projectId = "22345678-1234-4234-8234-123456789abc";
const taskId = "32345678-1234-4234-8234-123456789abc";
const otherId = "42345678-1234-4234-8234-123456789abc";
const user = "reader@example.test";
const principalId = "track-readonly";
const key = randomBytes(32);
const directories: string[] = [];

after(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture(overrides: Record<string, unknown> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "projects-adapter-"));
  directories.push(directory);
  const secretFile = join(directory, "key.txt");
  const credentialFile = join(directory, "credentials.json");
  await writeFile(secretFile, key.toString("base64url"), "utf8");
  await writeFile(credentialFile, JSON.stringify({
    version: 1, user, accountId, principalId, kid: "track-kid", revision: 4, secretFile,
    ...overrides,
  }), "utf8");
  return { credentialFile, secretFile };
}

function client(credentialFile: string, fetcher?: typeof fetch, overrides: Record<string, unknown> = {}) {
  return new ProjectsClient({
    sourceId: "projects-main", baseUrl: "https://projects.example.test/", credentialFile,
    user, accountId, principalId, ...(fetcher ? { fetch: fetcher } : {}), ...overrides,
  });
}

async function inspectSignedRequest(input: RequestInfo | URL, init: RequestInit | undefined, path: string) {
  assert.equal(new URL(input instanceof Request ? input.url : input.toString()).pathname, `/api/integrations/assistant/v1${path.split("?")[0]}`);
  const url = new URL(input instanceof Request ? input.url : input.toString());
  assert.equal(`${url.pathname}${url.search}`, `/api/integrations/assistant/v1${path}`);
  assert.equal(init?.method, "GET");
  assert.equal(init?.redirect, "error");
  assert.equal(init?.body, undefined);
  assert.equal((init?.signal as AbortSignal).aborted, false);
  const headers = new Headers(init?.headers);
  const match = /^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(headers.get("authorization") ?? "");
  assert.ok(match);
  const [, encoded, signature] = match;
  assert.ok(encoded && signature);
  const expected = createHmac("sha256", key).update(encoded, "ascii").digest("base64url");
  assert.equal(signature, expected);
  const claims: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  assert.ok(Array.isArray(claims));
  assert.deepEqual(claims.slice(0, 3), [1, "projects", "track-kid"]);
  assert.ok(Number.isInteger(claims[3]) && Number.isInteger(claims[4]));
  assert.equal(claims[4] - claims[3], 30);
  assert.ok(Math.abs(Math.floor(Date.now() / 1000) - claims[3]) <= 1);
  assert.match(String(claims[5]), /^[0-9a-f-]{36}$/);
  assert.equal(claims[6], "GET");
  assert.equal(claims[7], `/api/integrations/assistant/v1${path}`);
  assert.equal(claims[8], createHash("sha256").update(Buffer.alloc(0)).digest("hex"));
  assert.equal(claims[9], principalId);
  assert.equal(claims[10], 4);
  return claims[5] as string;
}

describe("Projects read adapter", () => {
  it("signs each exact GET path and query using the native short-lived token", async () => {
    const { credentialFile } = await fixture();
    const nonces: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      nonces.push(await inspectSignedRequest(input, init, `/projects/${projectId}/tasks?task_scope=all&status=all&limit=100&cursor=${encodeURIComponent("next /?")}`));
      return Response.json({ items: [], total: 0, next_cursor: null, as_of: "snapshot", extra: "discarded" });
    };
    const instance = client(credentialFile, fetcher);
    await instance.tasks(projectId, "next /?");
    await instance.tasks(projectId, "next /?");
    assert.equal(new Set(nonces).size, 2);
  });

  it("compares owner, account, and principal bindings before any HTTP request", async () => {
    for (const [field, option] of [["user", "other@example.test"], ["accountId", otherId], ["principalId", "other"]] as const) {
      const { credentialFile } = await fixture();
      let calls = 0;
      const fetcher: typeof fetch = async () => { calls++; return Response.json({}); };
      const instance = client(credentialFile, fetcher, { [field]: option });
      await assert.rejects(instance.capabilities(), (error: unknown) => error instanceof ProjectsSourceError && error.status === 401);
      assert.equal(calls, 0);
    }
  });

  it("reads only safe project metadata and converts native revisions to decimal strings", async () => {
    const { credentialFile } = await fixture();
    const fetcher: typeof fetch = async (input, init) => {
      await inspectSignedRequest(input, init, "/projects");
      return Response.json([{ id: projectId, name: "Alpha", version: 2, access_revision: 9, archived: false,
        owner_id: "private-owner", goal: "private-goal", repo: "private-repo", body: "private-body" }]);
    };
    assert.deepEqual(await client(credentialFile, fetcher).projects(), [{
      id: projectId, title: "Alpha", revision: "2", accessRevision: "9", archived: false,
    }]);
  });

  it("returns only bounded task metadata with the native task-only total", async () => {
    const { credentialFile } = await fixture();
    const fetcher: typeof fetch = async (input, init) => {
      await inspectSignedRequest(input, init, `/projects/${projectId}/tasks?task_scope=all&status=all&limit=100`);
      return Response.json({
        items: [
          { id: taskId, project_id: projectId, kind: "task", title: "Build", revision: 3,
            data: { state: "in_progress", requires_test: false, body: "secret", description: "secret" },
            owner_id: "secret" },
        ], total: 1, next_cursor: "cursor", as_of: "snapshot", extra: "ignored",
      });
    };
    assert.deepEqual(await client(credentialFile, fetcher).tasks(projectId), {
      tasks: [{ id: taskId, projectId, title: "Build", revision: "3", state: "in_progress", requiresTest: false }],
      total: 1, nextCursor: "cursor", snapshot: "snapshot",
    });
  });

  it("rejects non-task items instead of publishing an inflated task total", async () => {
    const { credentialFile } = await fixture();
    const fetcher: typeof fetch = async () => Response.json({
      items: [{ id: otherId, project_id: projectId, kind: "artifact", title: "Unexpected", revision: 1, data: { state: "done" } }],
      total: 1, next_cursor: null, as_of: "snapshot",
    });
    await assert.rejects(client(credentialFile, fetcher).tasks(projectId), (error: unknown) => error instanceof ProjectsSourceError && error.status === 502);
  });

  it("uses the confirmed true native default when requires_test is absent and maps unknown states", async () => {
    const { credentialFile } = await fixture();
    const fetcher: typeof fetch = async () => Response.json({
      items: [{ id: taskId, project_id: projectId, kind: "task", title: "Task", revision: 1, data: { state: "future" } }],
      total: 1, next_cursor: null, as_of: "snapshot",
    });
    assert.deepEqual((await client(credentialFile, fetcher).tasks(projectId)).tasks[0], {
      id: taskId, projectId, title: "Task", revision: "1", state: "unknown", requiresTest: true,
    });
  });

  it("rejects cross-project task pages and task detail identity mismatches", async () => {
    const { credentialFile } = await fixture();
    const wrongProject: typeof fetch = async () => Response.json({
      items: [{ id: taskId, project_id: otherId, kind: "task", title: "Task", revision: 1, data: { state: "todo" } }],
      total: 1, next_cursor: null, as_of: "snapshot",
    });
    await assert.rejects(client(credentialFile, wrongProject).tasks(projectId), (error: unknown) => error instanceof ProjectsSourceError && error.status === 502);
    const wrongTask: typeof fetch = async () => Response.json({ id: otherId, project_id: projectId, kind: "task", title: "Task", revision: 1, data: { state: "todo" } });
    await assert.rejects(client(credentialFile, wrongTask).task(taskId, projectId), (error: unknown) => error instanceof ProjectsSourceError && error.status === 502);
    const wrongDetailProject: typeof fetch = async () => Response.json({ id: taskId, project_id: otherId, kind: "task", title: "Task", revision: 1, data: { state: "todo" } });
    await assert.rejects(client(credentialFile, wrongDetailProject).task(taskId, projectId), (error: unknown) => error instanceof ProjectsSourceError && error.status === 502);
  });

  it("parses read capabilities and rejects any granted write capability", async () => {
    const { credentialFile } = await fixture();
    const readonly: typeof fetch = async () => Response.json({ version: 1, projectsRead: true, tasksRead: true,
      tasksCreate: false, tasksUpdate: false, resultsAttach: false, idempotency: true, cas: true });
    assert.deepEqual(await client(credentialFile, readonly).capabilities(), { projectsRead: true, tasksRead: true });
    const writable: typeof fetch = async () => Response.json({ version: 1, projectsRead: true, tasksRead: true,
      tasksCreate: true, tasksUpdate: false, resultsAttach: false });
    await assert.rejects(client(credentialFile, writable).capabilities(), (error: unknown) => error instanceof ProjectsSourceError && error.status === 502);
  });

  it("keeps HTTP failures and malformed response details out of errors", async () => {
    const { credentialFile } = await fixture();
    const failure: typeof fetch = async () => new Response("sensitive native response", { status: 403 });
    await assert.rejects(client(credentialFile, failure).projects(), (error: unknown) => {
      assert.ok(error instanceof ProjectsSourceError);
      assert.equal(error.status, 403);
      assert.equal(error.message, "Projects source request failed (403)");
      assert.equal(error.message.includes("sensitive"), false);
      return true;
    });
    const malformed: typeof fetch = async () => new Response("private parse detail", { status: 200 });
    await assert.rejects(client(credentialFile, malformed).projects(), (error: unknown) => {
      assert.ok(error instanceof ProjectsSourceError);
      assert.equal(error.status, 502);
      assert.equal(error.message.includes("private"), false);
      return true;
    });
  });

  it("rejects oversized cursors before HTTP", async () => {
    const { credentialFile } = await fixture();
    let calls = 0;
    const fetcher: typeof fetch = async () => { calls++; return Response.json({}); };
    await assert.rejects(client(credentialFile, fetcher).tasks(projectId, "x".repeat(2001)), (error: unknown) => error instanceof ProjectsSourceError && error.status === 400);
    assert.equal(calls, 0);
  });

  it("reads credential and secret files afresh for every request", async () => {
    const { credentialFile, secretFile } = await fixture();
    let calls = 0;
    const fetcher: typeof fetch = async () => { calls++; return Response.json({ version: 1, projectsRead: false, tasksRead: false,
      tasksCreate: false, tasksUpdate: false, resultsAttach: false }); };
    const instance = client(credentialFile, fetcher);
    await instance.capabilities();
    await writeFile(secretFile, randomBytes(32).toString("base64url"), "utf8");
    await instance.capabilities();
    assert.equal(calls, 2);
  });

  it("accepts the native key file's trailing newline and a UTF-8 credential BOM", async () => {
    const { credentialFile, secretFile } = await fixture();
    await writeFile(secretFile, key.toString("base64url") + "\n", "utf8");
    const { readFile } = await import("node:fs/promises");
    await writeFile(credentialFile, "\uFEFF" + await readFile(credentialFile, "utf8"), "utf8");
    const fetcher: typeof fetch = async (input, init) => {
      await inspectSignedRequest(input, init, "/projects"); return Response.json([]);
    };
    assert.deepEqual(await client(credentialFile, fetcher).projects(), []);
  });
});
