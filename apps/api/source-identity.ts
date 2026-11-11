import { createHash } from "node:crypto";
import type { SourceConfig } from "./config.ts";

export function projectsReady(source: SourceConfig): boolean {
  return source.kind === "projects" && !!source.baseUrl && !!source.projectsCredentialFile &&
    !!source.projectsUser && !!source.projectsAccountId && !!source.projectsPrincipalId;
}
export function sourceIdentity(source: SourceConfig): string {
  // Preserve the original identity encoding for existing native/log sources.
  const parts: unknown[] = [source.kind, source.baseUrl ?? null, source.organizationId ?? null,
    source.logRoot ?? null, [...source.repositoryRoots].sort()];
  if (projectsReady(source)) parts.push(source.projectsUser, source.projectsAccountId, source.projectsPrincipalId);
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
