export interface NativeWebDatabaseClient {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
}
export function nativeWebDatabaseState(pg: NativeWebDatabaseClient): Promise<{
  data: { dataSha256: string; schemaSha256: string; sequenceSha256: string; tables: Array<{ table: string; count: string; sha256: string }> };
  security: { sha256: string; readOnly: boolean; components: Record<string, { count: number; sha256: string }> };
}>;
