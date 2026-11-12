import { backup, DatabaseSync } from "node:sqlite";
import { constants, openSync, closeSync, fstatSync, lstatSync, createReadStream, createWriteStream } from "node:fs";
import type { Stats } from "node:fs";
import { resolve, dirname, parse } from "node:path";
import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createGzip, createGunzip } from "node:zlib";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const MAX_BYTES = 8 * 1024 ** 3;
const MAX_CIPHER = MAX_BYTES + 16 * 1024 ** 2;
const MAX_ROWS = 5_000_000;
const MAX_ROW = 32 * 1024 ** 2;
const MAX_METADATA = 4 * 1024 ** 2;
const MAX_NAME = 1024;
const PURPOSE = "assistant-sqlite-backup";
type Code = "INVALID" | "PATH" | "BOUND" | "TIMEOUT" | "INTEGRITY" | "MISMATCH" | "IO" | "UNSUPPORTED";
export class BackupError extends Error {
  readonly code: Code;
  constructor(code: Code) { super(code); this.name = "BackupError"; this.code = code; }
}
export interface MeasureOptions { maxBytes?: number; maxRowBytes?: number; maxRowsPerTable?: number; timeoutMs?: number }
export interface Measurement {
  schemaSha256: string;
  tables: { name: string; rows: number; sha256: string }[];
  integrity: { integrityCheck: true; foreignKeyCheck: true };
}
export interface Envelope {
  version: 1; purpose: typeof PURPOSE; nonce: string; database: "work" | "runtime";
  iv: string; tag: string; cipherBytes: number; cipherSha256: string;
  plainBytes: number; plainSha256: string; measurement: Measurement; measurementSha256: string;
}
function fail(code: Code): never { throw new BackupError(code); }
function clean(error: unknown): BackupError { return error instanceof BackupError ? error : new BackupError("IO"); }
function integer(value: unknown, max: number, min = 1): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) fail("BOUND");
  return value;
}
function limits(options: MeasureOptions = {}) {
  return { maxBytes: integer(options.maxBytes ?? MAX_BYTES, MAX_BYTES),
    maxRowBytes: integer(options.maxRowBytes ?? MAX_ROW, MAX_ROW),
    maxRowsPerTable: integer(options.maxRowsPerTable ?? MAX_ROWS, MAX_ROWS),
    deadline: Date.now() + integer(options.timeoutMs ?? 300_000, 3_600_000) };
}
type Limits = ReturnType<typeof limits>;
function tick(l: Limits) { if (Date.now() >= l.deadline) fail("TIMEOUT"); }
function same(a: Stats, b: Stats) { if (a.dev !== b.dev || a.ino !== b.ino) fail("PATH"); }
// POSIX ownership is mandatory. Windows ACL ownership requires a separate parent adapter.
function parent(file: string): string {
  if (typeof process.getuid !== "function") fail("UNSUPPORTED");
  const path = resolve(file);
  let dir = dirname(path);
  const immediate = lstatSync(dir);
  if (!immediate.isDirectory() || immediate.uid !== process.getuid() || (immediate.mode & 0o077)) fail("PATH");
  for (;;) {
    const st = lstatSync(dir);
    if (st.isSymbolicLink() || !st.isDirectory()) fail("PATH");
    if (dir === parse(dir).root) break;
    dir = dirname(dir);
  }
  return path;
}
function regular(st: Stats, max: number) {
  if (!st.isFile() || st.nlink !== 1 || st.uid !== process.getuid!()) fail("PATH");
  integer(st.size, max, 0);
}
function source(file: string, max: number) {
  const path = parent(file);
  const before = lstatSync(path);
  if (before.isSymbolicLink()) fail("PATH");
  regular(before, max);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const st = fstatSync(fd); regular(st, max); same(before, st); return { path, fd, st }; }
  catch (error) { closeSync(fd); throw error; }
}
function verify(file: ReturnType<typeof source>, max: number) {
  parent(file.path);
  const st = lstatSync(file.path); regular(st, max); same(file.st, st); same(st, fstatSync(file.fd));
  return st;
}
// pipeline destroys its streams on error and can close their supplied fd even
// with autoClose:false. Give streams a separate, inode-checked descriptor; the
// retained identity descriptor stays exclusively owned by this module.
function streamFd(file: ReturnType<typeof source>, flags: number, max: number) {
  verify(file, max);
  const fd = openSync(file.path, flags | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try { const st = fstatSync(fd); regular(st, max); same(file.st, st); return fd; }
  catch (error) { closeSync(fd); throw error; }
}
function readStream(file: ReturnType<typeof source>, max: number) {
  return createReadStream(file.path, { fd: streamFd(file, constants.O_RDONLY, max), autoClose: true });
}
async function transfer(input: ReturnType<typeof source>, output: ReturnType<typeof reserve>, stages: Transform[], inputMax: number, outputMax: number) {
  const readable = readStream(input, inputMax);
  let writable: ReturnType<typeof createWriteStream> | undefined;
  try {
    writable = createWriteStream(output.path, { fd: streamFd(output, constants.O_WRONLY, outputMax), autoClose: true });
    await pipeline([readable, ...stages, writable]);
  } finally { readable.destroy(); writable?.destroy(); }
}
function reserve(file: string) {
  const path = parent(file);
  const fd = openSync(path, "wx", 0o600);
  return { path, fd, st: fstatSync(fd) };
}
function reader(path: string) {
  const db = new DatabaseSync(path, { readOnly: true, timeout: 1000 });
  try { db.exec("PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; BEGIN"); return db; }
  catch (error) { db.close(); throw error; }
}
function statement(db: DatabaseSync, sql: string) {
  const stmt = db.prepare(sql); stmt.setReadBigInts(true); stmt.setReturnArrays(true); return stmt;
}
// Node's declaration retains object rows when returnArrays is enabled.
function* rows(db: DatabaseSync, sql: string): Generator<unknown[]> {
  for (const row of statement(db, sql).iterate()) {
    if (!Array.isArray(row)) fail("UNSUPPORTED");
    yield row;
  }
}
function scalar(db: DatabaseSync, sql: string): bigint {
  for (const row of rows(db, sql)) { if (typeof row[0] !== "bigint") fail("INTEGRITY"); return row[0]; }
  return fail("INTEGRITY");
}
function quote(name: string) { return '"' + name.replaceAll('"', '""') + '"'; }
function rowHash(row: unknown[], max: number) {
  const hash = createHash("sha256"); let size = 0;
  for (const cell of row) {
    let type: number; let data: Buffer;
    if (cell === null) { type = 0; data = Buffer.alloc(0); }
    else if (typeof cell === "bigint") { type = 1; data = Buffer.alloc(8); data.writeBigInt64BE(cell); }
    else if (typeof cell === "number") { type = 2; data = Buffer.alloc(8); data.writeDoubleBE(cell); }
    else if (typeof cell === "string") { type = 3; size += Buffer.byteLength(cell); if (size > max) fail("BOUND"); data = Buffer.from(cell); }
    else if (cell instanceof Uint8Array) { type = 4; data = Buffer.from(cell.buffer, cell.byteOffset, cell.byteLength); }
    else return fail("UNSUPPORTED");
    if (type !== 3) size += data.length;
    if (size > max) fail("BOUND");
    const header = Buffer.alloc(9); header[0] = type; header.writeBigUInt64BE(BigInt(data.length), 1);
    hash.update(header); hash.update(data);
  }
  return hash.digest();
}
function preflightRows(db: DatabaseSync, name: string, l: Limits) {
  const sizes: string[] = [];
  for (const column of rows(db, `PRAGMA table_xinfo(${quote(name)})`)) {
    tick(l);
    // Hidden virtual-table arguments are not part of SELECT *. Generated columns are.
    if (column[6] === 1n) continue;
    if (typeof column[1] !== "string") fail("INTEGRITY");
    const id = quote(column[1]);
    sizes.push(`CASE typeof(${id}) WHEN 'null' THEN 0 WHEN 'text' THEN length(CAST(${id} AS BLOB)) WHEN 'blob' THEN length(${id}) ELSE 8 END`);
  }
  if (!sizes.length) fail("UNSUPPORTED");
  // dbstat bounds stored records, but generated/virtual columns can expand them.
  // This second pass returns only a size, before any row body reaches JavaScript.
  const largest = scalar(db, `SELECT coalesce(max(${sizes.join(" + ")}),0) FROM ${quote(name)}`);
  if (largest > BigInt(l.maxRowBytes)) fail("BOUND");
  tick(l);
}
function measure(db: DatabaseSync, l: Limits): Measurement {
  tick(l);
  const pageSize = scalar(db, "PRAGMA page_size");
  const pages = scalar(db, "PRAGMA page_count");
  if (pageSize * pages > BigInt(l.maxBytes)) fail("BOUND");
  if (scalar(db, "SELECT count(*) FROM sqlite_schema") > 100_000n) fail("BOUND");
  // dbstat includes schema, index and overflow payloads; fail closed if unavailable.
  const payload = scalar(db, "SELECT coalesce(max(mx_payload),0) FROM dbstat");
  if (payload > BigInt(l.maxRowBytes)) fail("BOUND");
  tick(l);
  const schema = createHash("sha256"); const names: string[] = []; let metadataBytes = 4096;
  for (const row of rows(db, "SELECT type,name,tbl_name,rootpage,sql FROM sqlite_schema ORDER BY type,name,tbl_name")) {
    tick(l); schema.update(rowHash(row, l.maxRowBytes));
    if (row[0] === "table") { if (typeof row[1] !== "string") fail("INTEGRITY");
      if (Buffer.byteLength(row[1]) > MAX_NAME) fail("BOUND");
      metadataBytes += Buffer.byteLength(JSON.stringify(row[1])) + 160;
      if (metadataBytes > MAX_METADATA) fail("BOUND");
      names.push(row[1]); }
    if (names.length > 100_000) fail("BOUND");
  }
  const tables: Measurement["tables"] = [];
  for (const name of names.sort()) {
    tick(l);
    const count = scalar(db, `SELECT count(*) FROM ${quote(name)}`);
    if (count > BigInt(l.maxRowsPerTable)) fail("BOUND");
    preflightRows(db, name, l);
    const hashes: Buffer[] = [];
    for (const row of rows(db, `SELECT * FROM ${quote(name)}`)) {
      tick(l); if (hashes.length >= l.maxRowsPerTable) fail("BOUND");
      hashes.push(rowHash(row, l.maxRowBytes));
    }
    if (BigInt(hashes.length) !== count) fail("MISMATCH");
    hashes.sort(Buffer.compare); const digest = createHash("sha256");
    for (const hash of hashes) { tick(l); digest.update(hash); }
    tables.push({ name, rows: hashes.length, sha256: digest.digest("hex") });
  }
  let ok = 0;
  for (const row of rows(db, "PRAGMA integrity_check")) { tick(l); if (row.length !== 1 || row[0] !== "ok") fail("INTEGRITY"); ok++; }
  if (ok !== 1) fail("INTEGRITY");
  for (const _row of rows(db, "PRAGMA foreign_key_check")) fail("INTEGRITY");
  tick(l);
  return { schemaSha256: schema.digest("hex"), tables, integrity: { integrityCheck: true, foreignKeyCheck: true } };
}
export function measureDatabase(file: string, options: MeasureOptions = {}): Measurement {
  let input: ReturnType<typeof source> | undefined; let db: DatabaseSync | undefined;
  try { const l = limits(options); input = source(file, l.maxBytes); db = reader(input.path);
    const result = measure(db, l); verify(input, l.maxBytes); return result;
  } catch (error) { throw clean(error); }
  finally { db?.close(); if (input) closeSync(input.fd); }
}
function meter(max: number) {
  const hash = createHash("sha256"); let bytes = 0;
  const stream = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    bytes += chunk.length;
    if (bytes > max) { callback(new BackupError("BOUND")); return; }
    hash.update(chunk); callback(null, chunk);
  } });
  return { stream, result: () => ({ bytes, sha256: hash.digest("hex") }) };
}
export async function sha256File(file: string, maxBytes: number): Promise<string> {
  let input: ReturnType<typeof source> | undefined;
  try { integer(maxBytes, MAX_CIPHER); input = source(file, maxBytes);
    const hash = createHash("sha256"); let bytes = 0;
    for await (const chunk of readStream(input, maxBytes)) {
      bytes += chunk.length; if (bytes > maxBytes) fail("BOUND"); hash.update(chunk);
    }
    if (verify(input, maxBytes).size !== bytes || bytes !== input.st.size) fail("MISMATCH");
    return hash.digest("hex");
  } catch (error) { throw clean(error); } finally { if (input) closeSync(input.fd); }
}
// Reserve 4 KiB for all fixed envelope fields and measurement framing. Count
// each small table separately before constructing any aggregate JSON string.
function metadataBudget(tables: Measurement["tables"]) {
  let bytes = 4096;
  if (tables.length > 100_000) fail("BOUND");
  for (const table of tables) {
    if (Buffer.byteLength(table.name) > MAX_NAME) fail("BOUND");
    bytes += Buffer.byteLength(JSON.stringify(table.name)) + 160;
    if (bytes > MAX_METADATA) fail("BOUND");
  }
}
function measurementHash(m: Measurement) {
  metadataBudget(m.tables);
  return createHash("sha256").update(JSON.stringify(m)).digest("hex");
}
export async function snapshotDatabase(sourcePath: string, destination: string, options: MeasureOptions & { maxBytes: number }) {
  let input: ReturnType<typeof source> | undefined; let output: ReturnType<typeof reserve> | undefined; let db: DatabaseSync | undefined;
  try {
    if (!options) fail("INVALID"); integer(options.maxBytes, MAX_BYTES);
    const l = limits(options); input = source(sourcePath, l.maxBytes); db = reader(input.path);
    const pageSize = Number(scalar(db, "PRAGMA page_size"));
    const pages = Number(scalar(db, "PRAGMA page_count"));
    const bytes = integer(pageSize * pages, l.maxBytes);
    const measurement = measure(db, l); tick(l); verify(input, l.maxBytes);
    output = reserve(destination); let progressSteps = 0; let remaining = pages + 1;
    await backup(db, output.path, { rate: 256, progress(info) {
      tick(l); progressSteps++;
      if (info.totalPages !== pages || info.remainingPages < 0 || info.remainingPages >= remaining || progressSteps > Math.ceil(pages / 256) + 1) fail("BOUND");
      remaining = info.remainingPages; verify(input!, l.maxBytes); verify(output!, bytes);
    } });
    tick(l); verify(input, l.maxBytes);
    if (verify(output, bytes).size !== bytes) fail("MISMATCH");
    db.close(); db = undefined;
    const copied = measureDatabase(output.path, { ...options, timeoutMs: integer(l.deadline - Date.now(), 3_600_000) });
    if (measurementHash(copied) !== measurementHash(measurement)) fail("MISMATCH");
    const sha256 = await sha256File(output.path, bytes); tick(l); verify(output, bytes);
    return { bytes, sha256, pageSize, pages, measurement,
      backup: { backupCalls: 1 as const, heldReadTransaction: true as const, sourceWrites: 0 as const, progressSteps } };
  } catch (error) { throw clean(error); }
  finally { db?.close(); if (input) closeSync(input.fd); if (output) closeSync(output.fd); }
}
function keyCheck(key: Uint8Array) { if (!(key instanceof Uint8Array) || key.byteLength !== 32) fail("INVALID"); }
function metadataCheck(metadata: { nonce: string; database: string }) {
  if (!metadata || typeof metadata.nonce !== "string" || !/^[a-f0-9]{32}$/.test(metadata.nonce) || !["work", "runtime"].includes(metadata.database)) fail("INVALID");
}
function aad(e: Pick<Envelope, "nonce" | "database" | "plainBytes" | "plainSha256" | "measurementSha256">) {
  return Buffer.from(JSON.stringify([1, PURPOSE, e.nonce, e.database, e.plainBytes, e.plainSha256, e.measurementSha256]));
}
export async function sealSnapshot(snapshotPath: string, cipherPath: string, key: Uint8Array, metadata: { nonce: string; database: "work" | "runtime" }): Promise<Envelope> {
  let input: ReturnType<typeof source> | undefined; let output: ReturnType<typeof reserve> | undefined;
  try {
    keyCheck(key); metadataCheck(metadata); input = source(snapshotPath, MAX_BYTES);
    const measurement = measureDatabase(input.path); const plainSha256 = await sha256File(input.path, MAX_BYTES);
    const base = { version: 1 as const, purpose: PURPOSE as typeof PURPOSE, nonce: metadata.nonce, database: metadata.database,
      plainBytes: input.st.size, plainSha256, measurement, measurementSha256: measurementHash(measurement) };
    const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key, iv); cipher.setAAD(aad(base));
    output = reserve(cipherPath); const plain = meter(base.plainBytes); const encrypted = meter(MAX_CIPHER);
    await transfer(input, output, [plain.stream, createGzip(), cipher, encrypted.stream], MAX_BYTES, MAX_CIPHER);
    const p = plain.result(); const c = encrypted.result();
    if (p.bytes !== base.plainBytes || p.sha256 !== plainSha256) fail("MISMATCH");
    verify(input, MAX_BYTES); if (verify(output, MAX_CIPHER).size !== c.bytes) fail("MISMATCH");
    return { ...base, iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex"), cipherBytes: c.bytes, cipherSha256: c.sha256 };
  } catch (error) { throw clean(error); }
  finally { if (input) closeSync(input.fd); if (output) closeSync(output.fd); }
}
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== keys.sort().join(",")) fail("INVALID");
}
function hex(value: unknown, length: number) { if (typeof value !== "string" || value.length !== length || !/^[0-9a-f]+$/.test(value)) fail("INVALID"); }
function validateEnvelope(value: unknown): asserts value is Envelope {
  exact(value, ["version", "purpose", "nonce", "database", "iv", "tag", "cipherBytes", "cipherSha256", "plainBytes", "plainSha256", "measurement", "measurementSha256"]);
  if (value.version !== 1 || value.purpose !== PURPOSE) fail("INVALID");
  hex(value.nonce, 32); if (value.database !== "work" && value.database !== "runtime") fail("INVALID");
  hex(value.iv, 24); hex(value.tag, 32); hex(value.cipherSha256, 64); hex(value.plainSha256, 64); hex(value.measurementSha256, 64);
  integer(value.cipherBytes, MAX_CIPHER); integer(value.plainBytes, MAX_BYTES);
  const m = value.measurement; exact(m, ["schemaSha256", "tables", "integrity"]); hex(m.schemaSha256, 64);
  exact(m.integrity, ["integrityCheck", "foreignKeyCheck"]);
  if (m.integrity.integrityCheck !== true || m.integrity.foreignKeyCheck !== true || !Array.isArray(m.tables) || m.tables.length > 100_000) fail("INVALID");
  let previous: string | undefined; let metadataBytes = 4096;
  for (const t of m.tables) {
    exact(t, ["name", "rows", "sha256"]);
    if (typeof t.name !== "string" || Buffer.byteLength(t.name) > MAX_NAME || (previous !== undefined && t.name <= previous)) fail("INVALID");
    metadataBytes += Buffer.byteLength(JSON.stringify(t.name)) + 160;
    if (metadataBytes > MAX_METADATA) fail("BOUND");
    previous = t.name; integer(t.rows, MAX_ROWS, 0); hex(t.sha256, 64);
  }
}
export async function restoreSealedSnapshot(cipherPath: string, destination: string, key: Uint8Array, envelope: Envelope): Promise<Measurement> {
  let input: ReturnType<typeof source> | undefined; let output: ReturnType<typeof reserve> | undefined;
  try {
    keyCheck(key); validateEnvelope(envelope);
    // Detach metadata before the first await so callers cannot change authenticated bounds.
    const e: Envelope = JSON.parse(JSON.stringify(envelope));
    if (measurementHash(e.measurement) !== e.measurementSha256) fail("MISMATCH");
    input = source(cipherPath, e.cipherBytes);
    if (input.st.size !== e.cipherBytes || await sha256File(input.path, e.cipherBytes) !== e.cipherSha256) fail("MISMATCH");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(e.iv, "hex"));
    decipher.setAuthTag(Buffer.from(e.tag, "hex")); decipher.setAAD(aad(e));
    output = reserve(destination); const cipher = meter(e.cipherBytes); const plain = meter(e.plainBytes);
    await transfer(input, output, [cipher.stream, decipher, createGunzip(), plain.stream], e.cipherBytes, e.plainBytes);
    const c = cipher.result(); const p = plain.result();
    if (c.bytes !== e.cipherBytes || c.sha256 !== e.cipherSha256 || p.bytes !== e.plainBytes || p.sha256 !== e.plainSha256) fail("MISMATCH");
    verify(input, e.cipherBytes); if (verify(output, e.plainBytes).size !== e.plainBytes) fail("MISMATCH");
    const measurement = measureDatabase(output.path, { maxBytes: e.plainBytes });
    if (measurementHash(measurement) !== e.measurementSha256) fail("MISMATCH");
    return measurement;
  } catch (error) { throw clean(error); }
  finally { if (input) closeSync(input.fd); if (output) closeSync(output.fd); }
}
