import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
async function freePort() {
  const server = createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert(address && typeof address !== "string");
  await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done()));
  return address.port;
}
async function exitedPid() {
  const child = spawn(process.execPath, ["--eval", "process.exit(0)"], { windowsHide: true, stdio: "ignore" });
  const pid = child.pid; assert(pid); await once(child, "exit"); return pid;
}
const inspect = (pid: number, port: number, entry: string, startedAt = new Date().toISOString()) => exec("powershell.exe", ["-NoProfile", "-File", resolve("deploy/demian/inspect-web.ps1"), "-TargetProcessId", String(pid), "-Port", String(port), "-Entry", entry, "-StartedAt", startedAt, "-AllowExited", "-Stop"], { windowsHide: true });

test("Windows recovery accepts an exited owned process when its port is free", { skip: process.platform !== "win32" }, async () => {
  const result = JSON.parse((await inspect(await exitedPid(), await freePort(), "owned-fixture-never-current-entry")).stdout);
  assert.equal(result.exited, true); assert.equal(result.portFree, true); assert.equal(result.stopped, false);
});

test("Windows recovery preserves a different listener instead of treating it as exited", { skip: process.platform !== "win32" }, async () => {
  const pid = await exitedPid(); const server = createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const address = server.address(); assert(address && typeof address !== "string");
    await assert.rejects(inspect(pid, address.port, "owned-fixture-never-current-entry"), error => typeof error === "object" && error !== null && "code" in error && error.code === 1);
    assert.equal(server.listening, true);
  } finally { await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())); }
});

test("Windows recovery cleans only an exact owned process that has lost its listener", { skip: process.platform !== "win32" }, async () => {
  const directory = resolve(await mkdtemp(join(tmpdir(), "demian-inspect-owned-")));
  const entry = join(directory, "owned-server.mjs"); await writeFile(entry, "setInterval(() => {}, 1000);\n");
  const child = spawn(process.execPath, [entry], { windowsHide: true, stdio: "ignore" });
  const startedAt = new Date().toISOString(); const ended = once(child, "exit");
  try {
    assert(child.pid);
    const result = JSON.parse((await inspect(child.pid, await freePort(), entry, startedAt)).stdout);
    assert.equal(result.matched, true); assert.equal(result.stopped, true); assert.equal(result.portFree, true);
    await ended;
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill(); await ended; }
    assert.ok(directory.startsWith(resolve(tmpdir()) + sep) && directory.split(sep).at(-1)?.startsWith("demian-inspect-owned-"));
    await rm(directory, { recursive: true, force: true });
  }
});
