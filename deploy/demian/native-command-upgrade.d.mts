import type {NativeWebDatabaseState} from './native-web-database.mjs';
export const nativeCommandMigration: Readonly<{name: string; sha256: string}>;
export type NativeCommandCatalog = Record<'columns'|'constraints'|'indexes'|'functions'|'triggers', Array<Record<string, unknown>>>;
export function assertNativeCommandCatalog(before: NativeCommandCatalog, after: NativeCommandCatalog, golden: NativeCommandCatalog, migrationSha256: string): true;
export function assertNativeCommandAccess(before: {views: unknown[]; grants: Array<Record<string, unknown>>}, after: {views: unknown[]; grants: Array<Record<string, unknown>>}): true;
export function assertNativeCommandData(before: NativeWebDatabaseState, after: NativeWebDatabaseState, oldMigrationRowsAfter: {table: string; count: string; sha256: string}, newMigrationRows: number): true;
export function nativeApiRecovery(): {
  stop(action: () => Promise<unknown>): Promise<void>;
  recover(input: {journal: (stage: string) => Promise<unknown>; recover: () => Promise<unknown>}): Promise<{recovered: boolean; recoveryUnverified: boolean; journalUnverified?: boolean}>;
};
