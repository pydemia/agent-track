import assert from "node:assert/strict";
import { once } from "node:events";
import type { ChildProcess } from "node:child_process";
import test from "node:test";
import { launchRecordedWeb, type OwnedWebRecord } from "../deploy/demian/owned-child.mjs";

const base = { executable: process.execPath, args: ["--eval", "setInterval(() => {}, 1000)"], cwd: process.cwd(), env: process.env, record: { profile: "owned-fixture" } };

test("failed starting-record persistence kills the newly spawned child", async () => {
  let pid = 0;
  await assert.rejects(launchRecordedWeb({ ...base, persist: async record => { pid = record.pid; throw new Error("fixture persistence failure"); }, verify: async () => true }), /persistence failure/);
  assert.ok(pid > 0); assert.throws(() => process.kill(pid, 0));
});

test("failed ready-record persistence retains cleanup ownership after readiness", async () => {
  let observed: ChildProcess | undefined;
  await assert.rejects(launchRecordedWeb({ ...base, persist: async record => { if (record.state === "ready") throw new Error("fixture ready write failed"); }, verify: async (_record, child) => { observed = child; return true; } }), /ready write failed/);
  assert.ok(observed); assert.ok(observed.exitCode !== null || observed.signalCode !== null);
});

test("success returns the verified record directly and only then releases ownership", async () => {
  let observed: ChildProcess | undefined;
  const writes: OwnedWebRecord[] = [];
  try {
    const result = await launchRecordedWeb({ ...base, persist: async record => { writes.push(record); }, verify: async (_record, child) => { observed = child; return true; } });
    assert.equal(result.state, "ready"); assert.deepEqual(writes.map(row => row.state), ["starting", "ready"]);
    assert.equal(result.pid, observed?.pid); assert.equal(observed?.exitCode, null);
  } finally {
    if (observed && observed.exitCode === null && observed.signalCode === null) { const exited = once(observed, "exit"); observed.kill(); await exited; }
  }
});
