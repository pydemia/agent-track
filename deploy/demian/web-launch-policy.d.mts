import type { ApiProcessSnapshot } from "./windows-api-process.mjs";
export function webLaunchRecordPath(root: string, profile: string, operationId: string | undefined, state: string): string;
export function webLaunchArguments(entry: string, operationId?: string): string[];
export function matchesWebLaunch(actual: ApiProcessSnapshot | null, pid: number, executable: string, entry: string, operationId?: string): boolean;
