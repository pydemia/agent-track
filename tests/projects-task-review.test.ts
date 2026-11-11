import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { ProjectsClient, ProjectsSourceError } from "../packages/adapters/projects/index.ts";

const accountId = "12345678-1234-4234-8234-123456789abc";
const projectId = "22345678-1234-4234-8234-123456789abc";
const taskId = "32345678-1234-4234-8234-123456789abc";
const user = "reader@example.test";
const principalId = "track-readonly";
const directories: string[] = [];

after(async () => {
  await Promise.all(directories.map((directory) => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("projects-task-review-"));
    return rm(directory, { recursive: true, force: true });
  }));
});

async function client(fetcher: typeof fetch) {
  const directory = await mkdtemp(join(tmpdir(), "projects-task-review-"));
  directories.push(directory);
  const secretFile = join(directory, "key.txt");
  const credentialFile = join(directory, "credentials.json");
  await writeFile(secretFile, randomBytes(32).toString("base64url"), "utf8");
  await writeFile(credentialFile, JSON.stringify({
    version: 1, user, accountId, principalId, kid: "track-kid", revision: 4, secretFile,
  }), "utf8");
  return new ProjectsClient({
    sourceId: "projects-main", baseUrl: "https://projects.example.test/", credentialFile,
    user, accountId, principalId, fetch: fetcher,
  });
}

function nativeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: taskId,
    project_id: projectId,
    kind: "task",
    title: "Build",
    revision: 3,
    body: "Original task description",
    data: { state: "in_progress", requires_test: false, acceptance_criteria: ["Works", "Handles edge cases"] },
    owner_id: "private-owner",
    private_link: "https://private.example.test",
    ...overrides,
  };
}

describe("Projects task review", () => {
  it("uses the signed task detail GET and returns only reviewed fields", async () => {
    let requestedPath = "";
    const instance = await client(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      requestedPath = `${url.pathname}${url.search}`;
      assert.equal(init?.method, "GET");
      assert.equal(init?.redirect, "error");
      assert.equal(init?.body, undefined);
      assert.match(new Headers(init?.headers).get("authorization") ?? "", /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      return Response.json(nativeTask());
    });

    assert.deepEqual(await instance.taskReview(taskId, projectId), {
      task: { id: taskId, projectId, title: "Build", revision: "3", state: "in_progress", requiresTest: false },
      body: "Original task description",
      acceptanceCriteria: ["Works", "Handles edge cases"],
      complete: true,
    });
    assert.equal(requestedPath, `/api/integrations/assistant/v1/tasks/${taskId}`);
  });

  it("rejects bad request IDs and mismatched task identity", async () => {
    let calls = 0;
    const instance = await client(async () => { calls++; return Response.json(nativeTask()); });
    await assert.rejects(instance.taskReview("bad", projectId), (error: unknown) => error instanceof ProjectsSourceError && error.status === 400);
    assert.equal(calls, 0);
    for (const mismatch of [
      nativeTask({ id: "42345678-1234-4234-8234-123456789abc" }),
      nativeTask({ project_id: "42345678-1234-4234-8234-123456789abc" }),
      nativeTask({ kind: "artifact" }),
    ]) {
      const wrong = await client(async () => Response.json(mismatch));
      await assert.rejects(wrong.taskReview(taskId, projectId), (error: unknown) => error instanceof ProjectsSourceError && error.status === 502);
    }
  });

  it("returns no review content when body exceeds the character or UTF-8 byte bound", async () => {
    for (const body of ["x".repeat(5001), "😀".repeat(2049)]) {
      const instance = await client(async () => Response.json(nativeTask({ body })));
      const result = await instance.taskReview(taskId, projectId);
      assert.equal(result.complete, false);
      assert.equal(result.body, "");
      assert.deepEqual(result.acceptanceCriteria, []);
    }
  });

  it("returns no review content when criteria exceed either bound", async () => {
    for (const acceptance_criteria of [[...Array(21)].map((_, i) => `criterion ${i}`), ["x".repeat(501)]]) {
      const instance = await client(async () => Response.json(nativeTask({ data: { state: "todo", acceptance_criteria } })));
      const result = await instance.taskReview(taskId, projectId);
      assert.equal(result.complete, false);
      assert.equal(result.body, "");
      assert.deepEqual(result.acceptanceCriteria, []);
    }
  });

  it("rejects missing or malformed native body and acceptance criteria", async () => {
    for (const value of [
      nativeTask({ body: undefined }),
      nativeTask({ body: 17 }),
      nativeTask({ data: { state: "todo" } }),
      nativeTask({ data: { state: "todo", acceptance_criteria: "not an array" } }),
      nativeTask({ data: { state: "todo", acceptance_criteria: ["okay", 4] } }),
    ]) {
      const instance = await client(async () => Response.json(value));
      await assert.rejects(instance.taskReview(taskId, projectId), (error: unknown) => error instanceof ProjectsSourceError && error.status === 502);
    }
  });

  it("keeps the metadata task API compatible when review fields are absent", async () => {
    const instance = await client(async () => Response.json({
      id: taskId, project_id: projectId, kind: "task", title: "Legacy", revision: 1,
      data: { state: "todo" },
    }));
    assert.deepEqual(await instance.task(taskId, projectId), {
      id: taskId, projectId, title: "Legacy", revision: "1", state: "todo", requiresTest: true,
    });
  });

  it("rejects non-JSON and responses larger than 1 MiB", async () => {
    const nonJson = await client(async () => new Response("{}", { headers: { "content-type": "text/plain" } }));
    await assert.rejects(nonJson.taskReview(taskId, projectId), (error: unknown) => error instanceof ProjectsSourceError && error.status === 502);
    const exactLimitJson = JSON.stringify(nativeTask());
    const exactLimitResponse = exactLimitJson + " ".repeat(1024 * 1024 - Buffer.byteLength(exactLimitJson));
    const exactLimit = await client(async () => new Response(exactLimitResponse, { headers: { "content-type": "application/json; charset=utf-8" } }));
    assert.equal((await exactLimit.taskReview(taskId, projectId)).complete, true);
    const oversized = await client(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{"));
        controller.enqueue(new Uint8Array(1024 * 1024));
        controller.close();
      },
    }), { headers: { "content-type": "application/json" } }));
    await assert.rejects(oversized.taskReview(taskId, projectId), (error: unknown) => error instanceof ProjectsSourceError && error.status === 502);
  });
});
