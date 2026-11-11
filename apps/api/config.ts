import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { z } from "zod";

const email = z.email().transform((value) => value.toLowerCase());
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
  baseUrl: safeUrl.optional(),
  uiBaseUrl: safeUrl.optional(),
  tokenFile: z.string().refine(isAbsolute).optional(),
  credentialFormat: z.enum(["plain", "demian-service"]).optional(),
  projectsCredentialFile: z.string().refine(isAbsolute).optional(),
  projectsUser: email.optional(),
  projectsAccountId: z.uuid().optional(),
  projectsPrincipalId: z.string().min(1).max(200).optional(),
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
}).strict().refine((config) => new Set(config.sources.map((s) => s.id)).size === config.sources.length, "Duplicate source id");
export type Config = z.infer<typeof configSchema>;
export function readConfig(path: string): Config {
  return configSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}
