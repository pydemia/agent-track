import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { matchesWebLaunch, webLaunchArguments, webLaunchRecordPath } from "../deploy/demian/web-launch-policy.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const root = resolve("fixture-home/track-context");
const entry = join(root, "releases/build/apps/web/server.js");
const exe = process.execPath;
const created = "2026-01-01T00:00:00.0000000Z";
const command = `"${exe}" "${entry}" --agent-track-operation=${id}`;
const actual = { pid: 123, name: "node.exe", executable: exe, created, command };

test("operation receipts separate starting, ready and legacy launches", () => {
  assert.notEqual(webLaunchRecordPath(root, "public", id, "starting"), webLaunchRecordPath(root, "public", id, "ready"));
  assert.equal(webLaunchRecordPath(root, "public", undefined, "ready"), join(root, "processes/public.json"));
  assert.deepEqual(webLaunchArguments(entry, id), [entry, `--agent-track-operation=${id}`]);
  assert.deepEqual(webLaunchArguments(entry), [entry]);
  for (const operationId of [id + "\n", "../escape", "", "00000000-0000-0000-0000-000000000000"]) {
    assert.throws(() => webLaunchRecordPath(root, "public", operationId, "ready"));
    assert.throws(() => webLaunchArguments(entry, operationId));
  }
  assert.throws(() => webLaunchRecordPath(root, "../public", id, "ready"));
  assert.throws(() => webLaunchRecordPath(root, "public", id, "../ready"));
});

test("launch adoption rejects another PID, entry, operation, executable and appended arguments", () => {
  assert.equal(matchesWebLaunch(actual, 123, exe, entry, id), true);
  for (const changed of [null, { ...actual, pid: 124 }, { ...actual, executable: entry },
    { ...actual, name: "other.exe" }, { ...actual, created: created + "\n" },
    { ...actual, command: command + " --extra" }, { ...actual, command: command.replace(id, "22222222-2222-4222-8222-222222222222") },
    { ...actual, command: `"${exe}" "${entry}.other" --agent-track-operation=${id}` }]) {
    assert.equal(matchesWebLaunch(changed, 123, exe, entry, id), false);
  }
  assert.equal(matchesWebLaunch(actual, 123, exe, entry), false);
  assert.equal(matchesWebLaunch({ ...actual, command: `"${exe}" "${entry}"` }, 123, exe, entry), true);
});

test("a missing operation flag value fails before native configuration or launch I/O", () => {
  assert.throws(() => execFileSync(process.execPath,
    [resolve("deploy/demian/run-web.mjs"), "--profile", "qa", "--operation-id"],
    { stdio: ["ignore", "ignore", "pipe"], timeout: 10000, windowsHide: true }),
  error => error instanceof Error && "stderr" in error && String(error.stderr).includes("Missing web operation ID"));
});
