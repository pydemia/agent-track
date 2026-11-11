import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { ProjectsClient, ProjectsSourceError } from "../packages/adapters/projects/index.ts";
import {
  prepareProjectsTaskCreate,
  ProjectsTaskDeadlinePassed,
  ProjectsTaskAccessChanged,
  ProjectsTaskWriter,
} from "../packages/adapters/projects/writer.ts";

const accountId = "12345678-1234-4234-8234-123456789abc";
const projectId = "22345678-1234-4234-8234-123456789abc";
const taskId = "32345678-1234-4234-8234-123456789abc";
const otherId = "42345678-1234-4234-8234-123456789abc";
const operationId = "52345678-1234-4234-8234-123456789abc";
const user = "writer@example.test";
const principalId = "track-writer";
const key = randomBytes(32);
const directories: string[] = [];

after(async () => {
  await Promise.all(directories.map(async (directory) => {
    const target = resolve(directory);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert.ok(basename(target).startsWith("projects-writer-"));
    await rm(target, { recursive: true, force: true });
  }));
});

async function fixture(overrides: Record<string, unknown> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "projects-writer-"));
  directories.push(directory);
  const secretFile = join(directory, "key.txt");
  const credentialFile = join(directory, "credentials.json");
  await writeFile(secretFile, key.toString("base64url"), "utf8");
  await writeFile(credentialFile, JSON.stringify({
    version: 1, user, accountId, principalId, kid: "fake-kid", revision: 7, secretFile,
    ...overrides,
  }), "utf8");
  return { credentialFile };
}

function writer(credentialFile: string, fetcher: typeof fetch) {
  return new ProjectsTaskWriter({
    sourceId: "projects-test", baseUrl: "https://projects.example.test",
    credentialFile, user, accountId, principalId, fetch: fetcher,
  });
}

function capabilities(overrides: Record<string, unknown> = {}) {
  return Response.json({ version: 1, projectsRead: true, tasksRead: true,
    tasksCreate: true, tasksUpdate: false, resultsAttach: false, ...overrides });
}

function nativeReceipt(expected = prepareProjectsTaskCreate(projectId, {
  operation_id: operationId, title: "Build task", body: "private body",
  acceptance_criteria: ["private criterion"], requires_test: false,
})) {
  return {
    operation_id: expected.operationId,
    request_hash: expected.nativeRequestHash,
    request_method: "POST",
    request_path: expected.path,
    request_body_sha256: expected.requestBodySha256,
    task: {
      id: taskId, project_id: projectId, kind: "task", title: "Build task",
      revision: 1, body: "private body", owner_id: "private owner",
      data: { state: "todo", requires_test: false,
        acceptance_criteria: ["private criterion"], private: "secret" },
    },
    private_top_level: "secret",
  };
}

async function inspectSigned(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  method: "GET" | "POST",
  path: string,
  body = "",
) {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  assert.equal(`${url.pathname}${url.search}`, path);
  assert.equal(init?.method, method);
  assert.equal(init?.redirect, "error");
  assert.equal(init?.body ?? "", body);
  const headers = new Headers(init?.headers);
  const match = /^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(headers.get("authorization") ?? "");
  assert.ok(match);
  const [, encoded, signature] = match;
  assert.ok(encoded && signature);
  assert.equal(signature, createHmac("sha256", key).update(encoded, "ascii").digest("base64url"));
  const claims: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  assert.ok(Array.isArray(claims));
  assert.equal(claims[6], method);
  assert.equal(claims[7], path);
  assert.equal(claims[8], createHash("sha256").update(body, "utf8").digest("hex"));
  assert.equal(claims[9], principalId);
  assert.equal(claims[10], 7);
}

describe("Projects native task writer", () => {
  it("prepares native defaults, exact wire hash, and canonical operation hash", () => {
    const prepared = prepareProjectsTaskCreate(projectId, {
      operation_id: operationId, title: "  Task 🧪  ",
    });
    assert.equal(prepared.path, `/api/integrations/assistant/v1/projects/${projectId}/tasks`);
    assert.equal(prepared.body, JSON.stringify({ operation_id: operationId,
      title: "  Task 🧪  ", body: "", acceptance_criteria: [], requires_test: true }));
    assert.equal(prepared.requestBodySha256, createHash("sha256").update(prepared.body).digest("hex"));
    const canonical = `[1,"create","${projectId}",{"acceptance_criteria":[],"body":"","operation_id":"${operationId}","requires_test":true,"title":"  Task 🧪  "}]`;
    assert.equal(prepared.nativeRequestHash, createHash("sha256").update(canonical).digest("hex"));
  });

  it("signs exact POST bytes and returns only allowlisted task and operation metadata", async () => {
    const { credentialFile } = await fixture();
    const prepared = prepareProjectsTaskCreate(projectId, {
      operation_id: operationId, title: "Build task", body: "private body",
      acceptance_criteria: ["private criterion"], requires_test: false,
    });
    let call = 0;
    const fetcher: typeof fetch = async (input, init) => {
      call++;
      if (call === 1) {
        await inspectSigned(input, init, "GET", "/api/integrations/assistant/v1/capabilities");
        return capabilities();
      }
      await inspectSigned(input, init, "POST", prepared.path, prepared.body);
      assert.equal(new Headers(init?.headers).get("content-type"), "application/json");
      return Response.json(nativeReceipt(prepared));
    };
    const result = await writer(credentialFile, fetcher).create(projectId, {
      operation_id: operationId, title: "Build task", body: "private body",
      acceptance_criteria: ["private criterion"], requires_test: false,
    });
    assert.deepEqual(result, {
      operationId, requestBodySha256: prepared.requestBodySha256,
      task: { id: taskId, projectId, title: "Build task", revision: "1",
        state: "todo", requiresTest: false },
    });
    assert.equal(JSON.stringify(result).includes("private"), false);
  });

  it("reconciles a GET receipt against persisted operation, project, and body hash", async () => {
    const { credentialFile } = await fixture();
    const prepared = prepareProjectsTaskCreate(projectId, {
      operation_id: operationId, title: "Build task", body: "private body",
      acceptance_criteria: ["private criterion"], requires_test: false,
    });
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname.endsWith("/capabilities")) {
        await inspectSigned(input, init, "GET", "/api/integrations/assistant/v1/capabilities");
        return capabilities();
      }
      await inspectSigned(input, init, "GET", `/api/integrations/assistant/v1/operations/${operationId}`);
      return Response.json(nativeReceipt(prepared));
    };
    const result = await writer(credentialFile, fetcher).reconcile(
      projectId, operationId, prepared.requestBodySha256,
    );
    assert.equal(result.operationId, operationId);
    assert.equal(result.requestBodySha256, prepared.requestBodySha256);
    assert.equal(JSON.stringify(result).includes("private"), false);
  });

  it("fetches and validates fresh writer capabilities before listing project metadata", async () => {
    const { credentialFile } = await fixture();
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname.endsWith("/capabilities")) {
        await inspectSigned(input, init, "GET", "/api/integrations/assistant/v1/capabilities");
        return capabilities();
      }
      await inspectSigned(input, init, "GET", "/api/integrations/assistant/v1/projects");
      return Response.json([{ id: projectId, name: "Alpha", version: 2,
        access_revision: 9, archived: false, private: "discard" }]);
    };
    const instance = writer(credentialFile, fetcher);
    assert.deepEqual(await instance.capabilities(), {
      version: 1, projectsRead: true, tasksRead: true, tasksCreate: true,
      tasksUpdate: false, resultsAttach: false,
    });
    assert.deepEqual(await instance.projects(), [{ id: projectId, title: "Alpha",
      revision: "2", accessRevision: "9", archived: false }]);
  });

  it("rejects receipts with mismatched operation, project, path, method, or body hash", async () => {
    const { credentialFile } = await fixture();
    const prepared = prepareProjectsTaskCreate(projectId, {
      operation_id: operationId, title: "Build task", body: "private body",
      acceptance_criteria: ["private criterion"], requires_test: false,
    });
    const mutations: Array<(receipt: ReturnType<typeof nativeReceipt>) => void> = [
      (receipt) => { receipt.operation_id = otherId; },
      (receipt) => { receipt.task.project_id = otherId; },
      (receipt) => { receipt.request_path = "/wrong/path"; },
      (receipt) => { receipt.request_method = "GET"; },
      (receipt) => { receipt.request_body_sha256 = "0".repeat(64); },
      (receipt) => { receipt.request_hash = "0".repeat(64); },
    ];
    for (const mutate of mutations) {
      const receipt = nativeReceipt(prepared);
      mutate(receipt);
      let call = 0;
      const fetcher: typeof fetch = async (input, init) => {
        call++;
        if (call === 1) return capabilities();
        await inspectSigned(input, init, "POST", prepared.path, prepared.body);
        return Response.json(receipt);
      };
      await assert.rejects(writer(credentialFile, fetcher).create(projectId, {
        operation_id: operationId, title: "Build task", body: "private body",
        acceptance_criteria: ["private criterion"], requires_test: false,
      }), (error: unknown) => error instanceof ProjectsSourceError && error.status === 502);
    }
  });

  it("rejects malformed and oversized success responses without exposing payloads", async () => {
    const { credentialFile } = await fixture();
    const malformed: typeof fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname.endsWith("/capabilities")) return capabilities();
      await inspectSigned(input, init, "POST", prepareProjectsTaskCreate(projectId, {
        operation_id: operationId, title: "T",
      }).path, JSON.stringify({ operation_id: operationId, title: "T", body: "",
        acceptance_criteria: [], requires_test: true }));
      return new Response("private invalid json");
    };
    await assert.rejects(writer(credentialFile, malformed).create(projectId, {
      operation_id: operationId, title: "T",
    }), (error: unknown) => error instanceof ProjectsSourceError && error.status === 502 && !error.message.includes("private"));

    const oversized: typeof fetch = async (input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      return url.pathname.endsWith("/capabilities")
        ? capabilities()
        : new Response(" ".repeat(1024 * 1024 + 1));
    };
    await assert.rejects(writer(credentialFile, oversized).create(projectId, {
      operation_id: operationId, title: "T",
    }), (error: unknown) => error instanceof ProjectsSourceError && error.status === 502);
  });

  it("preserves native non-success status and rejects invalid inputs before credentials or I/O", async () => {
    const { credentialFile } = await fixture();
    let calls = 0;
    const fetcher: typeof fetch = async () => { calls++; return new Response("private", { status: 409 }); };
    await assert.rejects(writer(credentialFile, fetcher).create(projectId, {
      operation_id: operationId, title: "Task",
    }), (error: unknown) => error instanceof ProjectsSourceError && error.status === 409);
    assert.equal(calls, 1);

    for (const invalid of [
      { operation_id: "not-a-uuid", title: "Task" },
      { operation_id: operationId, title: "   " },
      { operation_id: operationId, title: "T", body: "x".repeat(5001) },
      { operation_id: operationId, title: "T", acceptance_criteria: ["x".repeat(501)] },
      { operation_id: operationId, title: "T", acceptance_criteria: Array(21).fill("x") },
      { operation_id: operationId, title: "T", owner_id: "injection" },
      { operation_id: operationId, title: "T", body: "🧪".repeat(3000) },
    ]) {
      assert.throws(() => prepareProjectsTaskCreate(projectId, invalid),
        (error: unknown) => error instanceof ProjectsSourceError && error.status === 400);
    }
    assert.throws(() => prepareProjectsTaskCreate("bad-project", {
      operation_id: operationId, title: "Task",
    }), (error: unknown) => error instanceof ProjectsSourceError && error.status === 400);
    assert.equal(calls, 1);
  });

  it("expires after capability and credential awaits without dispatching a POST", async (t) => {
    let now = 1_000;
    t.mock.method(Date, "now", () => now);
    const expiresAt = new Date(2_000).toISOString();
    const { credentialFile } = await fixture();
    let calls = 0;
    const fetcher: typeof fetch = async (input, init) => {
      calls++;
      const url = new URL(input instanceof Request ? input.url : input.toString());
      assert.equal(url.pathname, "/api/integrations/assistant/v1/capabilities");
      await inspectSigned(input, init, "GET", "/api/integrations/assistant/v1/capabilities");
      now = Date.parse(expiresAt);
      return capabilities();
    };
    await assert.rejects(writer(credentialFile, fetcher).create(projectId, {
      operation_id: operationId, title: "Task",
    }, { expiresAt }), (error: unknown) => error instanceof ProjectsTaskDeadlinePassed);
    assert.equal(calls, 1);
  });

  it("requires the exact create capability set and leaves the reader read-only", async () => {
    const { credentialFile } = await fixture();
    let postCalls = 0;
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      if (url.pathname.endsWith("/capabilities")) return capabilities({ tasksUpdate: true });
      postCalls++;
      return Response.json({});
    };
    await assert.rejects(writer(credentialFile, fetcher).create(projectId, {
      operation_id: operationId, title: "Task",
    }), (error: unknown) => error instanceof ProjectsSourceError && error.status === 403);
    assert.equal(postCalls, 0);

    const reader = new ProjectsClient({ sourceId: "projects-test",
      baseUrl: "https://projects.example.test", credentialFile, user, accountId,
      principalId, fetch: async () => capabilities({ tasksCreate: true }) });
    await assert.rejects(reader.capabilities(),
      (error: unknown) => error instanceof ProjectsSourceError && error.status === 502);
  });

  it("checks current local authority after capability and credential awaits", async () => {
    const { credentialFile } = await fixture(); let allowed = true; let posts = 0;
    const fetcher: typeof fetch = async (_input, init) => {
      if (init?.method === "POST") posts++;
      allowed = false; return capabilities();
    };
    await assert.rejects(writer(credentialFile, fetcher).create(projectId, { operation_id: operationId, title: "Task" },
      { isAuthorized: () => allowed }), (error: unknown) => error instanceof ProjectsTaskAccessChanged);
    assert.equal(posts, 0);
  });
});
