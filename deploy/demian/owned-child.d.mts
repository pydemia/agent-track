import type { ChildProcess } from "node:child_process";
export type OwnedWebRecord = Record<string, unknown> & { pid: number; startedAt: string; state: string };
export function launchRecordedWeb(options: {
  executable: string; args: string[]; cwd: string; env: Record<string, string | undefined>;
  stdoutFd?: number; stderrFd?: number; record: Record<string, unknown>;
  persist: (record: OwnedWebRecord) => Promise<void>;
  verify: (record: OwnedWebRecord, child: ChildProcess) => Promise<boolean>;
}): Promise<OwnedWebRecord>;
