export interface ApiStartupConfig {
  version: 1; ownerSid: string; executable: string; executableSha256: string; entry: string; bundleSha256: string;
  repository: string; serviceState: string; profilePins: Record<string, string>; operatorDirectory: string; operatorFiles: Record<string, string>;
}
export interface ApiProcessIdentity { pid: number; name: string; executable: string; created: string; command: string }
export function apiStartupHash(bytes: Buffer | string): string;
export function hashStartupFile(file: string, limit: number): Promise<string>;
export function readStartupFile(file: string, limit?: number): Promise<Buffer>;
export function validateApiStartupConfig(value: unknown): ApiStartupConfig;
export function matchesApiProcess(record: unknown, actual: unknown, plan: Pick<ApiStartupConfig, "executable" | "entry">): boolean;
export function apiStartupDisposition(record: unknown, actual: unknown, listeners: Array<{pid: number; address: string}>, plan: Pick<ApiStartupConfig, "executable" | "entry">): "adopt" | "start";
export function verifyApiDatabase(service: Record<string, unknown>, observed: unknown): boolean;
export function apiStartupEnvironment(plan: ApiStartupConfig, secrets: unknown, ambient?: Record<string, string | undefined>): Record<string, string>;
export function loadApiStartup(stateRoot: string): Promise<{
  stateRoot: string; plan: ApiStartupConfig; service: Record<string, unknown>; secrets: unknown;
  active: Record<string, unknown>; activePath: string; activeSha256: string; configSha256: string;
}>;
