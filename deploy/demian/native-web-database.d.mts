export interface NativeWebDatabaseClient {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
}
export interface NativeWebDatabaseState {
  data: { dataSha256: string; schemaSha256: string; sequenceSha256: string; tables: Array<{ table: string; count: string; sha256: string }>;
    workerFreshness?: { version: 1; observedAtMicros: string; tables: Array<{table: string; column: 'checked_at'; rows: Array<{sha256: string; checkedAtMicros: string}>}> };
    delegationNonces?: { version: 1; snapshot: string; observedAtMicros: string; rows: Array<{keySha256: string; rowSha256: string; acceptedAtMicros: string; expiresAtMicros: string; retainUntilMicros: string; transactionId: string}> } };
  security: { sha256: string; readOnly: boolean; components: Record<string, { count: number; sha256: string }> };
}
export function nativeWebDatabaseState(pg: NativeWebDatabaseClient, options?: {workerFreshness?: boolean; delegationNonces?: boolean}): Promise<NativeWebDatabaseState>;
export function assertNativeWebDatabasePreserved(before: NativeWebDatabaseState, after: NativeWebDatabaseState): true;
