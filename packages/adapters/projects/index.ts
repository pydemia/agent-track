import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { z } from "zod";
import type {
  ProjectMetadata,
  ProjectTaskMetadata,
  ProjectTaskPage,
} from "../../contracts/index.ts";
import type { ProjectDependencyPage } from "../../contracts/project-dependencies.ts";

const PREFIX = "/api/integrations/assistant/v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const states = new Set(["todo", "in_progress", "in_review", "done", "cancelled"]);

const credentialSchema = z.object({
  version: z.literal(1),
  user: z.string().min(1).max(320),
  accountId: z.string().regex(UUID),
  principalId: z.string().min(1).max(200),
  kid: z.string().min(1).max(200),
  revision: z.number().int().positive().safe(),
  secretFile: z.string().min(1),
}).strict();

const capabilitySchema = z.object({
  version: z.literal(1),
  projectsRead: z.boolean(),
  tasksRead: z.boolean(),
  tasksCreate: z.boolean(),
  tasksUpdate: z.boolean(),
  resultsAttach: z.boolean(),
  taskDependenciesRead: z.boolean().optional(),
});

const projectSchema = z.object({
  id: z.string().regex(UUID),
  name: z.string().min(1).max(300).refine((value) => value.trim().length > 0),
  version: z.number().int().positive().safe(),
  access_revision: z.number().int().positive().safe(),
  archived: z.boolean(),
});

const itemSchema = z.object({
  id: z.string().regex(UUID),
  project_id: z.string().regex(UUID),
  kind: z.string().min(1).max(100),
  title: z.string().min(1).max(300).refine((value) => value.trim().length > 0),
  revision: z.number().int().positive().safe(),
  data: z.object({
    state: z.string().min(1).max(100),
    // Native task creation defaults this field to true.
    requires_test: z.boolean().default(true),
  }),
});

const taskPageSchema = z.object({
  items: z.array(itemSchema).max(100),
  total: z.number().int().nonnegative().safe(),
  next_cursor: z.string().max(2000).nullable(),
  as_of: z.string().min(1).max(200),
});

const taskSchema = itemSchema;
const taskReviewSchema = itemSchema.extend({
  body: z.string(),
  data: itemSchema.shape.data.extend({ acceptance_criteria: z.array(z.string()) }),
});
const dependencyItemSchema = z.object({
  id: z.string().regex(UUID),
  project_id: z.string().regex(UUID),
  relation: z.literal("depends_on"),
  source_task: itemSchema,
  target_task: itemSchema,
  source_revision: z.number().int().positive().safe(),
  target_revision: z.number().int().positive().safe(),
});
const dependencyPageSchema = z.object({
  version: z.literal(1),
  project_id: z.string().regex(UUID),
  observed_at: z.iso.datetime({ offset: true }),
  items: z.array(dependencyItemSchema).max(200),
  has_more: z.boolean(),
});
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_REVIEW_BODY_CHARS = 5000;
const MAX_REVIEW_BODY_BYTES = 8192;
const MAX_REVIEW_CRITERIA = 20;
const MAX_REVIEW_CRITERION_CHARS = 500;

export interface ProjectTaskReview {
  task: ProjectTaskMetadata;
  body: string;
  acceptanceCriteria: string[];
  complete: boolean;
}

export interface ProjectsClientOptions {
  sourceId: string;
  baseUrl: string;
  credentialFile: string;
  user: string;
  accountId: string;
  principalId: string;
  fetch?: typeof fetch;
}

export class ProjectsSourceError extends Error {
  constructor(readonly status: number) {
    super(`Projects source request failed (${status})`);
    this.name = "ProjectsSourceError";
  }
}

function canonicalBase64Url(value: string): Buffer {
  if (!BASE64URL.test(value)) throw new Error("Invalid credential");
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) throw new Error("Invalid credential");
  return decoded;
}

function canonicalUuid(value: string): boolean {
  return UUID.test(value);
}

function nativeRevision(value: number): string {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid native revision");
  return String(value);
}

function mapTask(item: z.infer<typeof itemSchema>): ProjectTaskMetadata {
  return {
    id: item.id,
    projectId: item.project_id,
    title: item.title,
    revision: nativeRevision(item.revision),
    state: states.has(item.data.state) ? item.data.state : "unknown",
    requiresTest: item.data.requires_test,
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type");
  if (!contentType || !/^application\/json(?:\s*;|\s*$)/i.test(contentType)) {
    await response.body?.cancel();
    throw new ProjectsSourceError(502);
  }
  if (!response.body) throw new ProjectsSourceError(502);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new ProjectsSourceError(502);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ProjectsSourceError) throw error;
    throw new ProjectsSourceError(502);
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new ProjectsSourceError(502);
  }
}

export class ProjectsClient {
  constructor(readonly options: ProjectsClientOptions) {}

  private async credential(): Promise<{ kid: string; revision: number; principalId: string; key: Buffer }> {
    try {
      const value: unknown = JSON.parse((await readFile(this.options.credentialFile, "utf8")).replace(/^\uFEFF/, ""));
      const credential = credentialSchema.parse(value);
      if (
        credential.user !== this.options.user ||
        credential.accountId !== this.options.accountId ||
        credential.principalId !== this.options.principalId ||
        !canonicalUuid(this.options.accountId)
      ) throw new Error("Credential binding mismatch");
      if (!isAbsolute(credential.secretFile)) throw new Error("Invalid credential path");
      const secret = await readFile(credential.secretFile, "utf8");
      const key = canonicalBase64Url(secret.trim());
      if (key.byteLength !== 32) throw new Error("Invalid credential key");
      return { kid: credential.kid, revision: credential.revision, principalId: credential.principalId, key };
    } catch {
      // Credential contents, paths and parsing failures must never leave this boundary.
      throw new ProjectsSourceError(401);
    }
  }

  private async request(path: string): Promise<unknown> {
    const credential = await this.credential();
    const issued = Math.floor(Date.now() / 1000);
    const claims = [
      1, "projects", credential.kid, issued, issued + 30, randomUUID(),
      "GET", `${PREFIX}${path}`, createHash("sha256").update(Buffer.alloc(0)).digest("hex"),
      credential.principalId, credential.revision,
    ];
    const encoded = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const signature = createHmac("sha256", credential.key).update(encoded, "ascii").digest("base64url");
    const base = this.options.baseUrl.replace(/\/$/, "");
    let url: URL;
    try {
      const baseUrl = new URL(base);
      if (
        !(["http:", "https:"].includes(baseUrl.protocol)) ||
        baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash || baseUrl.pathname !== "/"
      ) throw new Error("Invalid source URL");
      url = new URL(`${base}${PREFIX}${path}`);
    } catch {
      throw new ProjectsSourceError(502);
    }
    try {
      const response = await (this.options.fetch ?? fetch)(url, {
        method: "GET",
        headers: { Accept: "application/json", Authorization: `Bearer ${encoded}.${signature}` },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new ProjectsSourceError(response.status);
      }
      return await readBoundedJson(response);
    } catch (error) {
      if (error instanceof ProjectsSourceError) throw error;
      throw new ProjectsSourceError(502);
    }
  }

  async capabilities(): Promise<{ projectsRead: boolean; tasksRead: boolean }> {
    const raw: unknown = await this.request("/capabilities");
    const parsed = capabilitySchema.safeParse(raw);
    if (!parsed.success || parsed.data.tasksCreate || parsed.data.tasksUpdate || parsed.data.resultsAttach) {
      throw new ProjectsSourceError(502);
    }
    return { projectsRead: parsed.data.projectsRead, tasksRead: parsed.data.tasksRead };
  }

  async dependencies(projectId: string): Promise<ProjectDependencyPage> {
    if (!canonicalUuid(projectId)) throw new ProjectsSourceError(400);
    const capabilityRaw: unknown = await this.request("/capabilities");
    const capability = capabilitySchema.safeParse(capabilityRaw);
    if (!capability.success || capability.data.tasksCreate || capability.data.tasksUpdate || capability.data.resultsAttach) {
      throw new ProjectsSourceError(502);
    }
    if (!capability.data.projectsRead || !capability.data.tasksRead) throw new ProjectsSourceError(403);
    if (capability.data.taskDependenciesRead !== true) {
      return {
        sourceId: this.options.sourceId,
        projectId,
        observedAt: null,
        supported: false,
        dependencies: [],
        hasMore: false,
      };
    }

    const raw: unknown = await this.request(`/projects/${projectId}/task-dependencies`);
    const parsed = dependencyPageSchema.safeParse(raw);
    if (!parsed.success || parsed.data.project_id !== projectId) throw new ProjectsSourceError(502);

    const ids = new Set<string>();
    const dependencies: ProjectDependencyPage["dependencies"] = [];
    for (const item of parsed.data.items) {
      if (
        ids.has(item.id) || item.source_task.id === item.target_task.id ||
        item.source_task.kind !== "task" || item.target_task.kind !== "task" ||
        ![item.project_id, item.source_task.project_id, item.target_task.project_id]
          .includes(projectId)
      ) throw new ProjectsSourceError(502);
      ids.add(item.id);
      dependencies.push({
        id: item.id,
        projectId: item.project_id,
        relation: item.relation,
        fromTask: mapTask(item.source_task),
        toTask: mapTask(item.target_task),
        fromRevision: nativeRevision(item.source_revision),
        toRevision: nativeRevision(item.target_revision),
      });
    }
    return {
      sourceId: this.options.sourceId,
      projectId,
      observedAt: parsed.data.observed_at,
      supported: true,
      dependencies,
      hasMore: parsed.data.has_more,
    };
  }

  async projects(): Promise<ProjectMetadata[]> {
    const raw: unknown = await this.request("/projects");
    const parsed = z.array(projectSchema).safeParse(raw);
    if (!parsed.success) throw new ProjectsSourceError(502);
    return parsed.data.map((project) => ({
      id: project.id,
      title: project.name,
      revision: nativeRevision(project.version),
      accessRevision: nativeRevision(project.access_revision),
      archived: project.archived,
    }));
  }

  async tasks(projectId: string, cursor?: string): Promise<ProjectTaskPage> {
    if (!canonicalUuid(projectId) || (cursor !== undefined && (cursor.length < 1 || cursor.length > 2000))) {
      throw new ProjectsSourceError(400);
    }
    const query = `?task_scope=all&status=all&limit=100${cursor === undefined ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
    const raw: unknown = await this.request(`/projects/${projectId}/tasks${query}`);
    const parsed = taskPageSchema.safeParse(raw);
    if (!parsed.success) throw new ProjectsSourceError(502);
    const tasks: ProjectTaskMetadata[] = [];
    for (const item of parsed.data.items) {
      // Native query_tasks counts and returns tasks only. Mixed kinds violate
      // that contract; filtering them would publish a misleading task total.
      if (item.project_id !== projectId || item.kind !== "task") throw new ProjectsSourceError(502);
      tasks.push(mapTask(item));
    }
    return {
      tasks,
      total: parsed.data.total,
      nextCursor: parsed.data.next_cursor,
      snapshot: parsed.data.as_of,
    };
  }

  async task(taskId: string, expectedProjectId: string): Promise<ProjectTaskMetadata> {
    if (!canonicalUuid(taskId) || !canonicalUuid(expectedProjectId)) throw new ProjectsSourceError(400);
    const raw: unknown = await this.request(`/tasks/${taskId}`);
    const parsed = taskSchema.safeParse(raw);
    if (!parsed.success || parsed.data.id !== taskId || parsed.data.project_id !== expectedProjectId || parsed.data.kind !== "task") {
      throw new ProjectsSourceError(502);
    }
    return mapTask(parsed.data);
  }

  async taskReview(taskId: string, expectedProjectId: string): Promise<ProjectTaskReview> {
    if (!canonicalUuid(taskId) || !canonicalUuid(expectedProjectId)) throw new ProjectsSourceError(400);
    const raw: unknown = await this.request(`/tasks/${taskId}`);
    const parsed = taskReviewSchema.safeParse(raw);
    if (!parsed.success || parsed.data.id !== taskId || parsed.data.project_id !== expectedProjectId || parsed.data.kind !== "task") {
      throw new ProjectsSourceError(502);
    }

    const body = parsed.data.body;
    const acceptanceCriteria = parsed.data.data.acceptance_criteria;
    const complete = body.length <= MAX_REVIEW_BODY_CHARS &&
      Buffer.byteLength(body, "utf8") <= MAX_REVIEW_BODY_BYTES &&
      acceptanceCriteria.length <= MAX_REVIEW_CRITERIA &&
      acceptanceCriteria.every((criterion) => criterion.length <= MAX_REVIEW_CRITERION_CHARS);

    return {
      task: mapTask(parsed.data),
      body: complete ? body : "",
      acceptanceCriteria: complete ? acceptanceCriteria : [],
      complete,
    };
  }
}
