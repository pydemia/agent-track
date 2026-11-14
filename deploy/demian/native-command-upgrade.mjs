import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {assertNativeWebDatabasePreserved} from './native-web-database.mjs';

export const nativeCommandMigration = Object.freeze({
  name: '027_run_commands.sql',
  sha256: '9a3c95dfbba95772b346855de86c8a4ce6e85d1b3600349bfc568c075b35e3ec',
});
const empty = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const families = ['columns', 'constraints', 'indexes', 'functions', 'triggers'];

/** A pinned actual-copy catalog is evidence, never a name-only schema allowance. */
export function assertNativeCommandCatalog(before, after, golden, migrationSha256) {
  assert.equal(migrationSha256, nativeCommandMigration.sha256);
  for (const value of [before, after, golden]) assert.deepEqual(Object.keys(value).sort(), [...families].sort());
  assert.equal(golden.columns.length, 21); assert.equal(golden.constraints.length, 18);
  assert(golden.columns.every(row => row.table_name === 'run_commands'));
  assert(golden.constraints.every(row => row.table_name === 'run_commands' || row.table_name === 'runs' && row.name === 'runs_command_scope_unique' && row.definition === 'UNIQUE (organization_id, session_id, id)'));
  assert.deepEqual(golden.indexes.map(row => row.name).sort(), ['run_commands_accepted_head_idx', 'run_commands_pkey', 'run_commands_successor_idx', 'runs_command_scope_unique'].sort());
  assert.deepEqual(golden.functions.map(row => row.name).sort(), ['guard_run_command_scope', 'immutable_run_command'].sort());
  assert.deepEqual(golden.triggers.map(row => row.name).sort(), ['run_commands_immutable', 'run_commands_scope'].sort());
  for (const family of families) {
    const left = before[family], right = after[family];
    assert(Array.isArray(left) && Array.isArray(right));
    for (const row of left) assert(right.some(other => isDeepStrictEqual(row, other)));
    const additions = right.filter(row => !left.some(old => isDeepStrictEqual(row, old)));
    assert.equal(right.length, left.length + golden[family].length);
    assert.equal(additions.length, golden[family].length);
    for (const row of additions) assert(golden[family].some(expected => isDeepStrictEqual(row, expected)));
  }
  return true;
}

export function assertNativeCommandAccess(before, after) {
  assert.deepEqual(after.views, before.views);
  for (const row of before.grants) assert(after.grants.some(other => isDeepStrictEqual(row, other)));
  const added = after.grants.filter(row => !before.grants.some(old => isDeepStrictEqual(row, old)));
  assert.equal(after.grants.length, before.grants.length + 7); assert.equal(added.length, 7);
  assert(added.every(row => row.table_name === 'run_commands' && row.grantee === 'demian' && row.is_grantable === 'YES'));
  assert.deepEqual(added.map(row => row.privilege_type).sort(), ['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE']);
  return true;
}

/** Existing rows remain exact; only the declared marker, empty ledger and live clocks/nonces may advance. */
export function assertNativeCommandData(before, after, oldMigrationRowsAfter, newMigrationRows) {
  assert(before.data.workerFreshness?.version === 1 && after.data.workerFreshness?.version === 1);
  assert(before.data.delegationNonces?.version === 1 && after.data.delegationNonces?.version === 1);
  const oldTables = before.data.tables, tables = after.data.tables;
  assert(!oldTables.some(table => table.table === 'run_commands'));
  assert.deepEqual(tables.map(table => table.table).sort(), [...oldTables.map(table => table.table), 'run_commands'].sort());
  const ledger = tables.find(table => table.table === 'run_commands');
  assert.equal(ledger.count, '0'); assert.equal(ledger.sha256, empty);
  const versions = oldTables.find(table => table.table === 'schema_migrations'); assert(versions);
  assert.deepEqual(oldMigrationRowsAfter, versions); assert.equal(newMigrationRows, 1);
  assert.equal(tables.find(table => table.table === 'schema_migrations').count, String(BigInt(versions.count) + 1n));
  for (const name of ['roles', 'roleMemberships', 'roleDatabaseSettings', 'defaultAcls', 'extensions', 'database', 'schemas', 'policies']) assert.deepEqual(after.security.components[name], before.security.components[name]);
  // Catalog changes are separately checked against the complete actual-copy
  // delta. Reuse the strict row/cursor/nonce policy for the remaining data.
  const baseline = {...before, data: {...before.data, schemaSha256: after.data.schemaSha256}, security: after.security};
  const projected = {...after, data: {...after.data, tables: tables.filter(table => table.table !== 'run_commands').map(table => table.table === 'schema_migrations' ? oldMigrationRowsAfter : table)}};
  assertNativeWebDatabasePreserved(baseline, projected);
  return true;
}

/** Native API stop/recovery boundary, independent of database or process primitives. */
export function nativeApiRecovery() {
  let stopAttempted = false;
  return {
    async stop(action) { stopAttempted = true; await action(); },
    async recover({journal, recover}) {
      let journalUnverified = false;
      const record = async stage => {
        try { await journal(stage); } catch { journalUnverified = true; }
      };
      await record('failed');
      if (!stopAttempted) return {recovered: false, recoveryUnverified: false, journalUnverified};
      let recovered = false;
      try { await recover(); recovered = true; } catch { /* Ownership cannot be proved. */ }
      await record(recovered ? 'old-code-recovered' : 'recovery-refused');
      return {recovered, recoveryUnverified: !recovered, journalUnverified};
    },
  };
}
