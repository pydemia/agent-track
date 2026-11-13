export interface RuntimeReleaseManifest {
  version: 1;
  kind: 'agent-track-runtime-release';
  apiRevision: string;
  webRevision: string;
  node: { version: string; sha256: string };
  packages: Record<string, string>;
  files: Record<string, string>;
}
export interface RuntimeOptions { executable?: string; version?: string }
export function verifyRuntimeRelease(directory: string, expectedManifestSha256: string,
  options?: RuntimeOptions): Promise<{
    root: string; entry: string; manifest: RuntimeReleaseManifest; manifestSha256: string;
  }>;
export function resolveTrackRuntime(stateDir: string, repository: string,
  options?: RuntimeOptions): Promise<{
    mode: 'legacy' | 'frozen'; cwd: string; entry: string;
    executable: string; manifestSha256: string | null;
  }>;
