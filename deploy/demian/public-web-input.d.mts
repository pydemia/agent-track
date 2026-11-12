import type { ApiProcessSnapshot } from "./windows-api-process.mjs";
export interface PublicWebInput {
  version: 1; capturedAt: string; operationId: string; executionImplemented: false;
  scope: { profiles: ["public"]; port: 3001; neverOperatePorts: number[] };
  serviceState: string; contextRoot: string;
  roles: Record<"web" | "api" | "gate" | "track" | "tunnel", { port?: number; identity: ApiProcessSnapshot }>;
  protectedFiles: Record<string, string>;
  distribution: Record<string, { source: string; target: string; beforeSha256: string | null; targetSha256: string }>;
  startup: { file: string; beforeSha256: string; afterSha256: string };
  activation: { file: string; expectedMissing: true };
  candidate: { releaseDir: string; manifestSha256: string; webBuildId: string };
  rollback: { releaseDir: string; manifestSha256: string; webBuildId: string };
  backup: { resultFile: string; resultSha256: string; cipherFile: string; cipherSha256: string;
    currentData: { dataSha256: string; schemaSha256: string; sequenceSha256: string }; currentSecurity: { sha256: string } };
}
export const publicWebHelpers: readonly string[];
export function assertRegularPublicFile(file: string, allowMissing?: boolean): Promise<void>;
export function validatePublicWebInput(value: unknown, boundaries: { serviceState: string; repository: string }): PublicWebInput;
