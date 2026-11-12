import type { ApiProcessIdentity } from "./api-start-policy.mjs";
export function ensureApiStarted(root: string, checkOnly?: boolean): Promise<{ok: boolean; action: string; pid: number; port: number; workerStarted: false}>;
export function verifyApiAdoption(options: {record: ApiProcessIdentity; plan: {executable: string; entry: string}; current: ApiProcessIdentity;
  listeners: Array<{pid: number; address: string}>; checkReady: () => Promise<boolean>; port?: number}): Promise<void>;
export function launchApiAttempt(options: {
  root: string; plan: { executable: string; entry: string; repository: string }; active: Record<string, unknown>;
  env: Record<string, string | undefined>; port?: number;
  revalidate: () => Promise<void>;
  publish: (record: Record<string, unknown> & {process: ApiProcessIdentity}, attempt: string) => Promise<void>;
}): Promise<{ok: boolean; action: string; pid: number; port: number; workerStarted: false}>;
