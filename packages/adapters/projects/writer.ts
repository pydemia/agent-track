import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { timestampSchema, type ProjectMetadata, type ProjectTaskMetadata } from "../../contracts/index.ts";
import { ProjectsSourceError, type ProjectsClientOptions } from "./index.ts";

const PREFIX = "/api/integrations/assistant/v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;

const createTaskSchema = z.object({
  operation_id: z.string().regex(UUID),
  title: z.string().refine((value) => value.trim().length > 0),
  body: z.string().optional().default(""),
  acceptance_criteria: z.array(z.string()).max(20).optional().default([]),
  requires_test: z.boolean().optional().default(true),
}).strict();

const capabilitySchema = z.object({
  version: z.literal(1),
  projectsRead: z.boolean(),
  tasksRead: z.boolean(),
  tasksCreate: z.boolean(),
  tasksUpdate: z.boolean(),
  resultsAttach: z.boolean(),
});

const projectSchema = z.object({
  id: z.string().regex(UUID),
  name: z.string().min(1).max(300).refine((value) => value.trim().length > 0),
  version: z.number().int().positive().safe(),
  access_revision: z.number().int().positive().safe(),
  archived: z.boolean(),
});

const receiptSchema = z.object({
  operation_id: z.string().regex(UUID),
  request_hash: z.string().regex(/^[0-9a-f]{64}$/),
  request_method: z.enum(["GET", "POST"]),
  request_path: z.string().min(1).max(1000),
  request_body_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  task: z.object({
    id: z.string().regex(UUID),
    project_id: z.string().regex(UUID),
    kind: z.string().min(1).max(100),
    title: z.string().min(1).refine((value) => value.trim().length > 0),
    revision: z.number().int().positive().safe(),
    data: z.object({
      state: z.string().min(1).max(100),
      requires_test: z.boolean().default(true),
    }),
  }),
});

export interface PreparedProjectsTaskCreate {
  operationId: string;
  projectId: string;
  path: string;
  body: string;
  requestBodySha256: string;
  nativeRequestHash: string;
}

export class ProjectsTaskDeadlinePassed extends Error {
  constructor() {
    super("Projects task deadline passed before dispatch");
    this.name = "ProjectsTaskDeadlinePassed";
  }
}

function canonicalUuid(value: string): boolean {
  return UUID.test(value);
}

function canonicalBase64Url(value: string): Buffer {
  if (!BASE64URL.test(value)) throw new Error("Invalid credential");
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) throw new Error("Invalid credential");
  return decoded;
}

function pythonCanonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(pythonCanonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${pythonCanonicalJson(record[key])}`,
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function prepareProjectsTaskCreate(
  projectId: string,
  input: unknown,
): PreparedProjectsTaskCreate {
  const parsed = createTaskSchema.safeParse(input);
  if (!canonicalUuid(projectId) || !parsed.success) throw new ProjectsSourceError(400);
  const countCharacters = (value: string) => Array.from(value).length;
  if (
    countCharacters(parsed.data.title) > 300 ||
    countCharacters(parsed.data.body) > 5000 ||
    parsed.data.acceptance_criteria.some((criterion) => countCharacters(criterion) > 500)
  ) throw new ProjectsSourceError(400);

  const payload = {
    operation_id: parsed.data.operation_id,
    title: parsed.data.title,
    body: parsed.data.body,
    acceptance_criteria: parsed.data.acceptance_criteria,
    requires_test: parsed.data.requires_test,
  };
  const body = JSON.stringify(payload);
  const bodyBytes = Buffer.from(body, "utf8");
  if (bodyBytes.byteLength > MAX_REQUEST_BYTES) throw new ProjectsSourceError(400);
  const path = `${PREFIX}/projects/${projectId}/tasks`;
  const nativeCanonical = pythonCanonicalJson([1, "create", projectId, payload]);
  return {
    operationId: parsed.data.operation_id,
    projectId,
    path,
    body,
    requestBodySha256: createHash("sha256").update(bodyBytes).digest("hex"),
    nativeRequestHash: createHash("sha256").update(nativeCanonical, "utf8").digest("hex"),
  };
}

export interface ProjectsTaskWriterOptions extends ProjectsClientOptions {}

export class ProjectsTaskWriter {
  constructor(readonly options: ProjectsTaskWriterOptions) {}

  private async credential(): Promise<{
    kid: string;
    revision: number;
    principalId: string;
    key: Buffer;
  }> {
    try {
      const value: unknown = JSON.parse(
        (await readFile(this.options.credentialFile, "utf8")).replace(/^\uFEFF/, ""),
      );
      const credential = z.object({
        version: z.literal(1),
        user: z.string().min(1).max(320),
        accountId: z.string().regex(UUID),
        principalId: z.string().min(1).max(200),
        kid: z.string().min(1).max(200),
        revision: z.number().int().positive().safe(),
        secretFile: z.string().min(1),
      }).strict().parse(value);
      if (
        credential.user !== this.options.user ||
        credential.accountId !== this.options.accountId ||
        credential.principalId !== this.options.principalId ||
        !canonicalUuid(this.options.accountId) ||
        !isAbsolute(credential.secretFile)
      ) throw new Error("Credential binding mismatch");
      const key = canonicalBase64Url((await readFile(credential.secretFile, "utf8")).trim());
      if (key.byteLength !== 32) throw new Error("Invalid credential key");
      return {
        kid: credential.kid,
        revision: credential.revision,
        principalId: credential.principalId,
        key,
      };
    } catch {
      throw new ProjectsSourceError(401);
    }
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body = "",
    beforeFetch?: () => void,
  ): Promise<unknown> {
    const bodyBytes = Buffer.from(body, "utf8");
    if (bodyBytes.byteLength > MAX_REQUEST_BYTES) throw new ProjectsSourceError(400);
    const credential = await this.credential();
    const bodyHash = createHash("sha256").update(bodyBytes).digest("hex");
    const issued = Math.floor(Date.now() / 1000);
    const claims = [
      1, "projects", credential.kid, issued, issued + 30, randomUUID(),
      method, path, bodyHash, credential.principalId, credential.revision,
    ];
    const encoded = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const signature = createHmac("sha256", credential.key)
      .update(encoded, "ascii").digest("base64url");

    let url: URL;
    try {
      const base = this.options.baseUrl.replace(/\/$/, "");
      const baseUrl = new URL(base);
      if (
        !["http:", "https:"].includes(baseUrl.protocol) || baseUrl.username ||
        baseUrl.password || baseUrl.search || baseUrl.hash || baseUrl.pathname !== "/"
      ) throw new Error("Invalid source URL");
      url = new URL(`${base}${path}`);
    } catch {
      throw new ProjectsSourceError(502);
    }

    try {
      beforeFetch?.();
      const response = await (this.options.fetch ?? fetch)(url, {
        method,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${encoded}.${signature}`,
          ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
        },
        ...(method === "POST" ? { body } : {}),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new ProjectsSourceError(response.status);
      }
      return await this.decodeJson(response);
    } catch (error) {
      if (error instanceof ProjectsSourceError) throw error;
      if (error instanceof ProjectsTaskDeadlinePassed) throw error;
      throw new ProjectsSourceError(502);
    }
  }

  private async decodeJson(response: Response): Promise<unknown> {
    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null && Number(declaredLength) > MAX_RESPONSE_BYTES) {
      await response.body?.cancel();
      throw new ProjectsSourceError(502);
    }
    if (!response.body) throw new ProjectsSourceError(502);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new ProjectsSourceError(502);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    try {
      const bytes = Buffer.concat(chunks, total);
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return JSON.parse(text) as unknown;
    } catch {
      throw new ProjectsSourceError(502);
    }
  }

  private async verifyReceipt(
    raw: unknown,
    expected: PreparedProjectsTaskCreate,
  ): Promise<{ operationId: string; requestBodySha256: string; task: ProjectTaskMetadata }> {
    const receipt = receiptSchema.safeParse(raw);
    const expectedPath = `${PREFIX}/projects/${expected.projectId}/tasks`;
    if (
      !receipt.success || receipt.data.operation_id !== expected.operationId ||
      (expected.nativeRequestHash !== "" &&
        receipt.data.request_hash !== expected.nativeRequestHash) ||
      receipt.data.request_method !== "POST" ||
      receipt.data.request_path !== expectedPath ||
      receipt.data.request_body_sha256 !== expected.requestBodySha256 ||
      receipt.data.task.project_id !== expected.projectId ||
      receipt.data.task.kind !== "task"
    ) throw new ProjectsSourceError(502);
    const task = receipt.data.task;
    if (Array.from(task.title).length > 300) throw new ProjectsSourceError(502);
    const states = new Set(["todo", "in_progress", "in_review", "done", "cancelled"]);
    return {
      operationId: receipt.data.operation_id,
      requestBodySha256: receipt.data.request_body_sha256,
      task: {
        id: task.id,
        projectId: task.project_id,
        title: task.title,
        revision: String(task.revision),
        state: states.has(task.data.state) ? task.data.state : "unknown",
        requiresTest: task.data.requires_test,
      },
    };
  }

  private requireCapabilities(raw: unknown) {
    const capabilities = capabilitySchema.safeParse(raw);
    if (!capabilities.success) throw new ProjectsSourceError(502);
    if (
      !capabilities.data.projectsRead || !capabilities.data.tasksRead ||
      !capabilities.data.tasksCreate || capabilities.data.tasksUpdate ||
      capabilities.data.resultsAttach
    ) throw new ProjectsSourceError(403);
    return capabilities.data;
  }

  async capabilities() {
    return this.requireCapabilities(
      await this.request("GET", `${PREFIX}/capabilities`),
    );
  }

  async projects(): Promise<ProjectMetadata[]> {
    await this.capabilities();
    const raw = await this.request("GET", `${PREFIX}/projects`);
    const parsed = z.array(projectSchema).safeParse(raw);
    if (!parsed.success) throw new ProjectsSourceError(502);
    return parsed.data.map((project) => ({
      id: project.id,
      title: project.name,
      revision: String(project.version),
      accessRevision: String(project.access_revision),
      archived: project.archived,
    }));
  }

  async create(
    projectId: string,
    input: unknown,
    options: { expiresAt?: string } = {},
  ): Promise<{
    operationId: string;
    requestBodySha256: string;
    task: ProjectTaskMetadata;
  }> {
    const expected = prepareProjectsTaskCreate(projectId, input);
    let expiresAt: number | undefined;
    if (options.expiresAt !== undefined) {
      const parsed = timestampSchema.safeParse(options.expiresAt);
      if (!parsed.success) throw new ProjectsSourceError(400);
      expiresAt = Date.parse(parsed.data);
    }
    await this.capabilities();
    const raw = await this.request("POST", expected.path, expected.body, () => {
      if (expiresAt !== undefined && Date.now() >= expiresAt) {
        throw new ProjectsTaskDeadlinePassed();
      }
    });
    return this.verifyReceipt(raw, expected);
  }

  async reconcile(
    projectId: string,
    operationId: string,
    expectedBodySha256: string,
  ): Promise<{
    operationId: string;
    requestBodySha256: string;
    task: ProjectTaskMetadata;
  }> {
    if (
      !canonicalUuid(projectId) || !canonicalUuid(operationId) ||
      !/^[0-9a-f]{64}$/.test(expectedBodySha256)
    ) throw new ProjectsSourceError(400);
    const expected: PreparedProjectsTaskCreate = {
      operationId,
      projectId,
      path: `${PREFIX}/projects/${projectId}/tasks`,
      body: "",
      requestBodySha256: expectedBodySha256,
      nativeRequestHash: "",
    };
    await this.capabilities();
    const raw = await this.request("GET", `${PREFIX}/operations/${operationId}`);
    const receipt = receiptSchema.safeParse(raw);
    if (!receipt.success) throw new ProjectsSourceError(502);
    return this.verifyReceipt(raw, expected);
  }
}
