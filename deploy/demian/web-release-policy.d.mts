export type FrozenWebManifest = { version: number; webBuildId: string; payloadFiles: Record<string, string> };
export function verifyFrozenRelease(release: string, manifest: FrozenWebManifest): Promise<void>;
export function loadWebRelease(serviceState: string): Promise<{ entry: string; cwd: string; contextFile: string; buildId: string } | null>;
