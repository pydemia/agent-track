import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, rm, realpath } from "node:fs/promises";
import { join, dirname, basename, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import test from "node:test";

const operator = resolve("deploy/demian/write-api-record.ps1"), hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
async function fixture(t: test.TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "demian-api-atomic-")));
  t.after(async () => { assert.equal(dirname(root), await realpath(tmpdir())); assert(basename(root).startsWith("demian-api-atomic-")); await rm(root, { recursive: true, force: true }); });
  const target = join(root, "active.json"), payload = join(root, "next.json"), old = JSON.stringify({ state: "active", pid: 100 }), next = JSON.stringify({ state: "active", pid: 200 });
  await writeFile(target, old); await writeFile(payload, next);
  const args = ["-NoProfile", "-NonInteractive", "-File", operator, "-Target", target, "-Payload", payload, "-ExpectedSha256", hash(old)];
  return { root, target, payload, old, next, args };
}

test("API process record publication is complete and rejects stale CAS without overwriting", { skip: process.platform !== "win32" }, async t => {
  const f = await fixture(t), run = promisify(execFile);
  const { stdout } = await run("powershell.exe", f.args, { windowsHide: true, timeout: 10000 });
  assert.deepEqual(JSON.parse(stdout), { updated: true, sha256: hash(f.next) }); assert.equal(await readFile(f.target, "utf8"), f.next);
  await assert.rejects(run("powershell.exe", f.args, { windowsHide: true, timeout: 10000 }));
  assert.equal(await readFile(f.target, "utf8"), f.next);
});

for (const phase of ["after-stage", "after-replace"] as const) test(`forced writer exit ${phase} retains a complete recoverable API record`, { skip: process.platform !== "win32" }, async t => {
  const f = await fixture(t), marker = phase === "after-stage" ? "staged" : "replaced";
  const child = spawn("powershell.exe", [...f.args, "-TestPause", phase], { windowsHide: true, env: { ...process.env, AGENT_TRACK_API_RECORD_TEST: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit"); let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      let output = "";
      child.stdout.on("data", bytes => { output += String(bytes); if (output.includes(`"phase":"${marker}"`)) resolve(); });
      child.once("exit", () => reject(Error("Writer fixture exited before pause")));
      child.once("error", reject); timeout = setTimeout(() => reject(Error("Writer pause timed out")), 10000);
    });
    child.kill(); await exited;
    const bytes = await readFile(f.target, "utf8"); assert.equal(bytes, phase === "after-stage" ? f.old : f.next); assert.doesNotThrow(() => JSON.parse(bytes));
    // The OS released the sharing lock even though the writer's finally did not run.
    const args = [...f.args]; args[args.length - 1] = hash(bytes);
    await promisify(execFile)("powershell.exe", args, { windowsHide: true, timeout: 10000 });
    assert.equal(await readFile(f.target, "utf8"), f.next);
  } finally { clearTimeout(timeout); if (child.exitCode === null && child.signalCode === null) { child.kill(); await exited; } }
});
