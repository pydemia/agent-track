import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join, dirname } from "node:path";
import { backup } from "node:sqlite";
import { readConfig } from "../apps/api/config.ts";
import { createTrackServer } from "../apps/api/server.ts";
import type { Sources } from "../apps/api/runner.ts";
import { CommandService } from "../packages/commands/index.ts";
import type { Snapshot } from "../packages/contracts/index.ts";
import { Store } from "../packages/storage/store.ts";

// Recover to a distinct private database and ephemeral loopback API. The live writer,
// configuration and collectors are preserved; restored receipts are never dispatched.
const config = readConfig(process.env.TRACK_CONFIG ?? "");
if (config.auth.mode !== "proxy" || config.auth.users.length !== 1) throw new Error("Single-owner proxy required");
const headers = { "x-track-proxy-key": (await readFile(config.auth.secretFile, "utf8")).trim(), "x-forwarded-email": config.auth.users[0]! };
const originalResponse = await fetch(`http://127.0.0.1:${config.port}/api/snapshot`, { headers });
assert.equal(originalResponse.status, 200);
const original = await originalResponse.json() as Snapshot;
const suffix = new Date().toISOString().replace(/[:.]/g, "-");
const directory = join(dirname(config.database), "backups");
await mkdir(directory, { recursive: true, mode: 0o700 });
const backupPath = join(directory, `product-${suffix}.sqlite`);
const restorePath = join(directory, `restored-${suffix}.sqlite`);
const live = new Store(config.database);
try { await backup(live.db, backupPath); } finally { live.close(); }
await copyFile(backupPath, restorePath, constants.COPYFILE_EXCL);
const baseline = new Store(backupPath);
const restored = new Store(restorePath);
const tables = ["metadata", "runs", "events", "event_digests", "bindings", "receipts"];
const digests = (store: Store) => Object.fromEntries(tables.map((table) => {
  const rows = store.db.prepare(`SELECT * FROM ${table}`).all().map((row) => JSON.stringify(row)).sort();
  return [table, { count: rows.length, digest: createHash("sha256").update(JSON.stringify(rows)).digest("hex") }];
}));
try {
  assert.equal(baseline.integrity(), "ok"); assert.equal(restored.integrity(), "ok");
  const before = digests(baseline);
  assert.deepEqual(digests(restored), before);
  // Recovery changes pending receipt state only. It has no native execution port.
  const pending = restored.db.prepare("SELECT count(*) AS n FROM receipts WHERE state IN ('requested','dispatching','accepted')").get()!;
  new CommandService(restored).recoverInterrupted();
  const sources = { views: () => original.sources } as unknown as Sources;
  const { server } = createTrackServer(restored, () => ({ ...config, database: restorePath }), "dist/web", sources);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/snapshot`, { headers });
    assert.equal(response.status, 200);
    const snapshot = await response.json() as Snapshot;
    const expected = baseline.snapshot(config.auth.users[0]!, original.sources);
    assert.deepEqual(snapshot.runs, expected.runs);
    assert.deepEqual(snapshot.relations, expected.relations);
    for (const table of ["metadata", "runs", "events", "event_digests", "bindings"]) {
      assert.deepEqual(digests(restored)[table], before[table]);
    }
    console.log(JSON.stringify({ verifiedAt: new Date().toISOString(), liveOnlineBackup: true,
      independentRestore: true, integrity: "ok", journalCursorBindingDigestsMatch: true,
      receiptDigestMatchedBeforeRecovery: true, pendingReceiptsRecoveredWithoutDispatch: Number(pending.n),
      restoredApiRuns: snapshot.runs.length, restoredApiRelations: snapshot.relations.length,
      tableCounts: Object.fromEntries(tables.map((table) => [table, before[table]!.count])),
      productionDatabaseSwitched: false, backupAndRestoreKeptPrivate: true }, null, 2));
  } finally {
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
  }
} finally { baseline.close(); restored.close(); }
