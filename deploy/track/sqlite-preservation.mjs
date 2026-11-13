import { createHash } from 'node:crypto';
import { lstatSync, realpathSync, mkdtempSync, openSync, closeSync,
  linkSync, unlinkSync, rmdirSync } from 'node:fs';
import { dirname, join, resolve, parse } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';

const quote = (name) => `"${name.replaceAll('"', '""')}"`;
const hash = () => createHash('sha256');

// Length framing is unambiguous even for embedded NULs and arbitrary blobs.
function encode(digest, value) {
  let tag;
  let bytes;
  if (value === null) { tag = 'n'; bytes = Buffer.alloc(0); }
  else if (typeof value === 'bigint') {
    tag = 'i'; bytes = Buffer.alloc(8); bytes.writeBigInt64BE(value);
  } else if (typeof value === 'number') {
    tag = 'r'; bytes = Buffer.alloc(8); bytes.writeDoubleBE(value);
  } else if (typeof value === 'string') {
    tag = 't'; bytes = Buffer.from(value, 'utf8');
  } else if (value instanceof Uint8Array) {
    tag = 'b'; bytes = value;
  } else { throw new Error('Unsupported SQLite value'); }
  digest.update(`${tag}${bytes.length}:`);
  digest.update(bytes);
}

function rowsFingerprint(db, table, columns) {
  // Text is transported as bytes so malformed UTF-8 is not replaced by JS.
  const projection = columns.flatMap((column) => {
    const c = quote(column);
    return [`typeof(${c})`, `CASE WHEN typeof(${c})='text' THEN CAST(${c} AS BLOB) ELSE ${c} END`];
  });
  const ordering = columns.flatMap((column) => [
    `${quote(column)} COLLATE BINARY`, `typeof(${quote(column)}) COLLATE BINARY`,
  ]);
  const statement = db.prepare(`SELECT ${projection.join(',')} FROM main.${quote(table)} ORDER BY ${ordering.join(',')}`);
  statement.setReadBigInts(true);
  statement.setReturnArrays(true);
  const digest = hash();
  for (const column of columns) encode(digest, column);
  let count = 0;
  for (const row of statement.iterate()) {
    digest.update('row:');
    for (const value of row) encode(digest, value);
    if (++count > Number.MAX_SAFE_INTEGER) throw new Error('Row count exceeds safe integer');
  }
  return { name: table, count, sha256: digest.digest('hex') };
}

/** Logical main-database fingerprint; caller owns snapshot isolation.
 * Streams rows (memory bounded by one row and schema metadata). SQLite may
 * use temporary disk for sorting. Rowid/rootpage and database pragmas are not
 * logical columns. Custom collations/functions/virtual modules must be available.
 */
export function trackDatabaseFingerprint(db) {
  const schema = rowsFingerprint(db, 'sqlite_schema', ['type', 'name', 'tbl_name', 'sql']);
  const tables = [];
  for (const { name } of db.prepare("SELECT name FROM main.sqlite_schema WHERE type='table' ORDER BY name COLLATE BINARY").iterate()) {
    const columns = [...db.prepare('SELECT name FROM pragma_table_xinfo(?, ?) ORDER BY cid').iterate(name, 'main')].map((row) => row.name);
    tables.push(rowsFingerprint(db, name, columns));
  }
  const digest = hash();
  encode(digest, 'track-sqlite-preservation-v1');
  encode(digest, schema.sha256);
  for (const table of tables) {
    encode(digest, table.name);
    encode(digest, BigInt(table.count));
    encode(digest, table.sha256);
  }
  return { schemaSha256: schema.sha256, tables, sha256: digest.digest('hex') };
}

function identity(path) {
  const stat = lstatSync(path, { bigint: true });
  if (stat.isSymbolicLink()) throw new Error('Symbolic links are not allowed');
  return stat;
}

function same(a, b) { return a.dev === b.dev && a.ino === b.ino; }

function checkedParent(path) {
  let current = dirname(path);
  while (true) {
    if (!identity(current).isDirectory()) throw new Error('Parent is not a directory');
    if (current === parse(current).root) break;
    current = dirname(current);
  }
  return realpathSync(dirname(path));
}

function assertAbsent(path) {
  try { lstatSync(path); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error('Destination must be absent');
}

/** Private local backup, not encryption or an off-machine restore test.
 * Requires trusted, non-concurrently-renamed directories and hardlink support.
 * Node's path-based backup cannot defend against hostile filesystem races.
 * A pinned read transaction spans fingerprint and backup; any error/mismatch
 * fails closed. No retry with a newer snapshot. WAL readers may update SQLite
 * shared-memory bookkeeping; no source SQL writes/checkpoints are issued.
 */
export async function backupTrackDatabase(sourceFile, destinationFile) {
  const source = resolve(sourceFile);
  const destination = resolve(destinationFile);
  checkedParent(source);
  const sourceIdentity = identity(source);
  if (!sourceIdentity.isFile()) throw new Error('Source must be a regular file');
  const parent = checkedParent(destination);
  const parentIdentity = identity(parent);
  assertAbsent(destination); // Also rejects same paths, hardlinks and dangling links.
  const staging = mkdtempSync(join(parent, '.track-sqlite-'));
  const stagingIdentity = identity(staging);
  const target = join(staging, 'backup.sqlite');
  let targetIdentity;
  const sidecars = [];
  let sourceDb;
  let backupDb;
  let published = false;
  try {
    const fd = openSync(target, 'wx', 0o600);
    try { targetIdentity = identity(target); } finally { closeSync(fd); }
    sourceDb = new DatabaseSync(source, { readOnly: true });
    if (!same(identity(source), sourceIdentity)) throw new Error('Source changed identity');
    sourceDb.exec('BEGIN');
    // BEGIN is deferred: this read explicitly pins the snapshot before hashing.
    sourceDb.prepare('SELECT count(*) FROM main.sqlite_schema').get();
    const fingerprint = trackDatabaseFingerprint(sourceDb);
    await backup(sourceDb, target);
    if (!same(identity(target), targetIdentity)) throw new Error('Staging file changed identity');
    // Read-only WAL connections can create these files and leave them behind.
    // Reserve them ourselves so cleanup never infers ownership from a filename.
    for (const suffix of ['-wal', '-shm']) {
      const path = `${target}${suffix}`;
      const handle = openSync(path, 'wx', 0o600);
      try { sidecars.push({ path, stat: identity(path) }); }
      finally { closeSync(handle); }
    }
    backupDb = new DatabaseSync(target, { readOnly: true });
    let checks = 0;
    for (const row of backupDb.prepare('PRAGMA integrity_check').iterate()) {
      if (Object.values(row)[0] !== 'ok') throw new Error('Backup integrity check failed');
      checks++;
    }
    if (checks !== 1) throw new Error('Backup integrity check failed');
    if (JSON.stringify(trackDatabaseFingerprint(backupDb)) !== JSON.stringify(fingerprint)) {
      throw new Error('Backup snapshot fingerprint mismatch');
    }
    backupDb.close(); backupDb = undefined;
    sourceDb.exec('ROLLBACK');
    sourceDb.close(); sourceDb = undefined;
    if (checkedParent(destination) !== parent || !same(identity(parent), parentIdentity)
      || !same(identity(staging), stagingIdentity) || !same(identity(target), targetIdentity)) {
      throw new Error('Backup path ownership changed');
    }
    const backupBytes = Number(identity(target).size);
    linkSync(target, destination); // Atomic create-only publication, never overwrite.
    published = true;
    return { fingerprint, integrityVerified: true, backupBytes };
  } finally {
    try { backupDb?.close(); } finally {
      try { sourceDb?.close(); } finally {
        // Never recursively delete or follow a replaced staging path.
        if (realpathSync(parent) === parent && same(identity(parent), parentIdentity)
          && same(identity(staging), stagingIdentity)) {
          if (targetIdentity && same(identity(target), targetIdentity)) unlinkSync(target);
          for (const { path, stat } of sidecars) {
            try { if (same(identity(path), stat)) unlinkSync(path); }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
          }
          // SQLite owns any sidecars: do not guess ownership of unexpected files.
          try { rmdirSync(staging); } catch (error) {
            if (error.code !== 'ENOTEMPTY') throw error;
            if (!published) throw new Error('Backup failed; staging contains unowned artifacts', { cause: error });
          }
        }
      }
    }
  }
}
