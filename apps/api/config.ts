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
const producerOrigin = z.url().max(2000).refine(value => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && value === url.origin;
}, "Exact canonical HTTPS producer origin required");
export const assistantDemianMappingSchema = z.object({
  origin: producerOrigin, organizationId: z.guid(), workspaceId: z.guid(), sourceId,
}).strict();
export const sourceConfigSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,80}$/),
  kind: z.enum(["demian", "projects", "assistant", "desktop", "codex", "claude"]),
  label: z.string().min(1).max(120),
  device: z.string().min(1).max(120),
  users: z.array(email).min(1),
  cancelUsers: z.array(email).optional(),
  runCommandUsers: z.array(email).optional(),
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
  assistantProtocol: z.union([z.literal(1), z.literal(2)]).optional(),
  assistantDemianMappings: z.array(assistantDemianMappingSchema).max(20).optional(),
  assistantNativeSourceId: sourceId.optional(),
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
      const commandOwners = config.auth.mode === "proxy" ? config.auth.users : [];
      if (source.runCommandUsers?.length && (source.kind !== "demian" || !!source.assistantNativeSourceId || !source.baseUrl ||
          config.auth.mode !== "proxy" || config.auth.users.length !== 1 ||
          source.runCommandUsers.some(user => !source.users.includes(user) || !commandOwners.includes(user)))) {
        context.addIssue({ code: "custom", message: "Run commands require an explicit ordinary Native single-owner grant" });
      }
      if (source.assistantNativeSourceId) {
        const producer = config.sources.find(item => item.id === source.assistantNativeSourceId);
        const mapping = producer?.assistantDemianMappings?.filter(item => item.sourceId === source.id);
        if (source.kind !== "demian" || !producer || producer.kind !== "assistant" || producer.assistantProtocol !== 2 ||
            !producer.assistantProjectsSourceId || mapping?.length !== 1 || source.baseUrl !== mapping[0]?.origin ||
            source.organizationId !== mapping[0]?.organizationId || source.users.length !== 1 || source.users[0] !== producer.assistantUser ||
            source.tokenFile || source.credentialFormat || source.runIds.length || source.discoverActive || source.discoverHistory ||
            source.cancelUsers?.length || source.approvalUsers?.length || source.assignmentUsers?.length || source.assignmentSessionIds?.length) {
          context.addIssue({ code: "custom", message: "Protected native metadata requires one exact Assistant v2 mapping, owner and read-only source" });
        }
      }
      const fields = [source.assistantCredentialFile, source.assistantUser, source.assistantOwnerId, source.assistantPrincipalId];
      if (!fields.some(Boolean) && !source.assistantProjectsSourceId && !source.assistantProtocol && !source.assistantDemianMappings) continue;
      const rootUsers = config.auth.mode === "proxy" ? config.auth.users : [config.auth.user];
      const peer = source.assistantProjectsSourceId && config.sources.find(item => item.id === source.assistantProjectsSourceId);
      if (source.kind !== "assistant" || !source.baseUrl || !fields.every(Boolean) ||
          !source.users.includes(source.assistantUser!) || !rootUsers.includes(source.assistantUser!) ||
          (source.assistantProjectsSourceId && (!peer || peer.kind !== "projects" || peer.projectsUser !== source.assistantUser ||
            !peer.users.includes(source.assistantUser!) || !peer.baseUrl || !peer.projectsCredentialFile || !peer.projectsAccountId || !peer.projectsPrincipalId))) {
        context.addIssue({ code: "custom", message: "Assistant reader must pin one configured actor, owner, principal and optional same-actor Projects source" });
      }
      const mappings = source.assistantDemianMappings ?? [];
      if (mappings.length && ((source.assistantProtocol ?? 1) !== 2 || !source.assistantProjectsSourceId ||
          new Set(mappings.map(item => JSON.stringify([item.origin, item.organizationId, item.workspaceId]))).size !== mappings.length ||
          mappings.some(mapping => !config.sources.some(target => target.id === mapping.sourceId && target.kind === "demian" &&
            !!target.baseUrl && target.organizationId === mapping.organizationId && target.users.includes(source.assistantUser!))))) {
        context.addIssue({ code: "custom", message: "Assistant v2 links require unique explicit producer mappings and same-actor native/Projects scopes" });
      }
    }
  });
export type Config = z.infer<typeof configSchema>;
export function readConfig(path: string): Config {
  return configSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}
