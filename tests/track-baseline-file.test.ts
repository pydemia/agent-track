import assert from "node:assert/strict";
import { mkdtemp, writeFile, open, link, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { loadTrackBaseline } from "../deploy/track/runtime-operation.mjs";

test("a nonce preservation baseline larger than 4 MiB retains every fingerprint", async t => {
  const parent = await realpath(tmpdir()), root = await mkdtemp(join(parent, "track-baseline-"));
  t.after(async () => { assert(!relative(parent, root).startsWith("..")); await rm(root, { recursive: true }); });
  const rows = Array.from({ length: 16000 }, (_, n) => ({ keySha256: n.toString(16).padStart(64, "0"), rowSha256: "a".repeat(64),
    acceptedAtMicros: "1794797590000000", expiresAtMicros: "1794797650000000", retainUntilMicros: "1794797770000000", transactionId: String(n + 1) }));
  const value = { nativeDatabase: { data: { delegationNonces: { version: 1, rows } } } }, bytes = JSON.stringify(value);
  assert(Buffer.byteLength(bytes) > 4 * 1024 * 1024);
  const file = join(root, "baseline.json"); await writeFile(file, bytes, { flag: "wx" });
  assert.deepEqual(await loadTrackBaseline(file), value);
});

test("baseline loading rejects oversized, multiply linked, non-file and malformed input", async t => {
  const parent = await realpath(tmpdir()), root = await mkdtemp(join(parent, "track-baseline-"));
  t.after(async () => { assert(!relative(parent, root).startsWith("..")); await rm(root, { recursive: true }); });
  const large = join(root, "oversized.json"), handle = await open(large, "wx");
  try { await handle.truncate(64 * 1024 * 1024 + 1); } finally { await handle.close(); }
  await assert.rejects(loadTrackBaseline(large));
  const file = join(root, "linked.json"); await writeFile(file, "{}"); await link(file, join(root, "other.json"));
  await assert.rejects(loadTrackBaseline(file));
  await assert.rejects(loadTrackBaseline(root));
  const malformed = join(root, "invalid.json"); await writeFile(malformed, "{");
  await assert.rejects(loadTrackBaseline(malformed), SyntaxError);
});
