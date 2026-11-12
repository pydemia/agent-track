export type FrozenWebManifest = { version: number; webBuildId: string; payloadFiles: Record<string, string> };
export function verifyFrozenRelease(release: string, manifest: FrozenWebManifest): Promise<void>;
export function webProfilePort(profile: string, publicPort: unknown): number;
export function loadWebRelease(serviceState: string, profile?: "public"): Promise<{ entry: string; cwd: string; contextFile: string; buildId: string } | null>;
