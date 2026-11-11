import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { z } from "zod";
import type {
  ProjectMetadata,
  ProjectTaskMetadata,
  ProjectTaskPage,
} from "../../contracts/index.ts";

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
      return await response.json();
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
}
