import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";

const email = z.email().transform((value) => value.toLowerCase());
const sourceId = z.string().regex(/^[a-z0-9_-]{1,80}$/);
export const contextReaderSchema = z.object({
  id: sourceId, purpose: z.enum(["demian", "projects", "assistant"]), user: email,
  secretFile: z.string().refine(isAbsolute), nativeSourceIds: z.array(sourceId).min(1).max(20),
  projectScopes: z.array(z.object({ sourceId, projectIds: z.array(z.uuid()).min(1).max(100) }).strict()).max(20).default([]),
  sessionScopes: z.array(z.object({ sourceId, sessionIds: z.array(z.uuid()).min(1).max(100) }).strict()).max(20).default([]),
}).strict().refine((reader) => reader.projectScopes.length + reader.sessionScopes.length > 0, "Explicit context scope required");
export type ContextReader = z.infer<typeof contextReaderSchema>;
const safeUrl = z.url().refine((value) => {
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
}, "Credential-free HTTP origin required");
export const sourceConfigSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,80}$/),
  kind: z.enum(["demian", "projects", "assistant", "desktop", "codex", "claude"]),
  label: z.string().min(1).max(120),
  device: z.string().min(1).max(120),
  users: z.array(email).min(1),
  cancelUsers: z.array(email).optional(),
  approvalUsers: z.array(email).optional(),
  assignmentUsers: z.array(email).optional(),
  assignmentSessionIds: z.array(z.uuid()).max(100).optional(),
  assignmentProjectIds: z.array(z.uuid()).max(100).optional(),
  baseUrl: safeUrl.optional(),
  uiBaseUrl: safeUrl.optional(),
  tokenFile: z.string().refine(isAbsolute).optional(),
  credentialFormat: z.enum(["plain", "demian-service"]).optional(),
  projectsCredentialFile: z.string().refine(isAbsolute).optional(),
  projectsUser: email.optional(),
  projectsAccountId: z.uuid().optional(),
  projectsPrincipalId: z.string().min(1).max(200).optional(),
  projectsTaskCreatorCredentialFile: z.string().refine(isAbsolute).optional(),
  projectsTaskCreatorPrincipalId: z.string().min(1).max(200).optional(),
  assistantCredentialFile: z.string().refine(isAbsolute).optional(),
  assistantUser: email.optional(),
  assistantOwnerId: z.string().regex(/^sso-sub:[a-f0-9]{64}$/).optional(),
  assistantPrincipalId: sourceId.optional(),
  assistantProjectsSourceId: sourceId.optional(),
  taskCreateUsers: z.array(email).optional(),
  organizationId: z.string().max(512).optional(),
  runIds: z.array(z.string().min(1).max(512)).default([]),
  discoverActive: z.boolean().default(false),
  discoverHistory: z.boolean().optional(),
  historyPageLimit: z.number().int().min(1).max(20).optional(),
  logRoot: z.string().refine(isAbsolute).optional(),
  repositoryRoots: z.array(z.string().refine(isAbsolute)).default([]),
  maxFiles: z.number().int().min(1).max(1000).default(100),
  sinceDays: z.number().int().min(1).max(90).default(7),
}).strict();
export type SourceConfig = z.infer<typeof sourceConfigSchema>;
export const configSchema = z.object({
  port: z.number().int().min(1024).max(65535).default(14345),
  database: z.string().refine(isAbsolute),
  publicOrigin: safeUrl,
  auth: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("proxy"), secretFile: z.string().refine(isAbsolute), users: z.array(email).min(1) }).strict(),
    z.object({ mode: z.literal("local"), user: email }).strict(),
  ]),
  sources: z.array(sourceConfigSchema),
  contextReaders: z.array(contextReaderSchema).max(10).optional(),
}).strict().refine((config) => new Set(config.sources.map((s) => s.id)).size === config.sources.length, "Duplicate source id")
  .superRefine((config, context) => {
    const readers = config.contextReaders ?? [];
    const pathKey = (value: string) => process.platform === "win32" ? resolve(value).toLowerCase() : resolve(value);
    if (new Set(readers.map((reader) => reader.id)).size !== readers.length || new Set(readers.map((reader) => pathKey(reader.secretFile))).size !== readers.length) {
      context.addIssue({ code: "custom", message: "Context reader identities and credentials must be separate" });
    }
    for (const reader of readers) {
      const root = config.auth.mode === "proxy" && config.auth.users.includes(reader.user);
      const native = (id: string) => config.sources.some((source) => source.id === id && source.kind === "demian" && source.users.includes(reader.user));
      if (!root || (config.auth.mode === "proxy" && pathKey(reader.secretFile) === pathKey(config.auth.secretFile)) ||
        reader.nativeSourceIds.some((id) => !native(id)) || reader.sessionScopes.some((scope) => !reader.nativeSourceIds.includes(scope.sourceId) || !native(scope.sourceId)) ||
        reader.projectScopes.some((scope) => !config.sources.some((source) => source.id === scope.sourceId && source.kind === "projects" && source.users.includes(reader.user) && source.projectsUser === reader.user))) {
        context.addIssue({ code: "custom", message: "Context reader must use its own credential and an explicitly configured owner/source scope" });
      }
    }
    for (const source of config.sources) {
      const fields = [source.assistantCredentialFile, source.assistantUser, source.assistantOwnerId, source.assistantPrincipalId];
      if (!fields.some(Boolean) && !source.assistantProjectsSourceId) continue;
      const rootUsers = config.auth.mode === "proxy" ? config.auth.users : [config.auth.user];
      const peer = source.assistantProjectsSourceId && config.sources.find(item => item.id === source.assistantProjectsSourceId);
      if (source.kind !== "assistant" || !source.baseUrl || !fields.every(Boolean) ||
          !source.users.includes(source.assistantUser!) || !rootUsers.includes(source.assistantUser!) ||
          (source.assistantProjectsSourceId && (!peer || peer.kind !== "projects" || peer.projectsUser !== source.assistantUser ||
            !peer.users.includes(source.assistantUser!) || !peer.baseUrl || !peer.projectsCredentialFile || !peer.projectsAccountId || !peer.projectsPrincipalId))) {
        context.addIssue({ code: "custom", message: "Assistant reader must pin one configured actor, owner, principal and optional same-actor Projects source" });
      }
    }
  });
export type Config = z.infer<typeof configSchema>;
export function readConfig(path: string): Config {
  return configSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}
