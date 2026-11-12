import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import test from "node:test";
import { apiListeners, inspectApiProcess } from "../deploy/demian/windows-api-process.mjs";

for (const pid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
  test(`inspectApiProcess rejects invalid PID ${String(pid)}`, async () => {
    await assert.rejects(inspectApiProcess(pid), { name: "TypeError", message: "Invalid process ID." });
  });
}

for (const port of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 65_536, Number.MAX_SAFE_INTEGER + 1]) {
  test(`apiListeners rejects invalid port ${String(port)}`, async () => {
    await assert.rejects(apiListeners(port), { name: "TypeError", message: "Invalid port." });
  });
}

test("Windows process inspection returns the current process snapshot", { skip: process.platform !== "win32" }, async () => {
  const snapshot = await inspectApiProcess(process.pid);
  assert.ok(snapshot);
  assert.equal(snapshot.pid, process.pid);
  assert.match(snapshot.name, /node(?:\.exe)?$/i);
  assert.equal(snapshot.executable.toLowerCase(), process.execPath.toLowerCase());
  assert.match(snapshot.created, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{7}Z$/);
  assert.ok(snapshot.command.length > 0);
});

test("Windows listener lookup returns this process as the loopback server owner", { skip: process.platform !== "win32" }, async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const listeners = await apiListeners(address.port);
    assert.ok(listeners.some(listener => listener.port === address.port && listener.pid === process.pid && listener.address === "127.0.0.1"));
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  assert.deepEqual(await apiListeners(address.port), []);
});

test("Windows process inspection returns null for an exited retained fixture child", { skip: process.platform !== "win32" }, async () => {
  const child = spawn(process.execPath, ["--eval", "process.exit(0)"], { windowsHide: true, stdio: "ignore" });
  const pid = child.pid;
  assert.ok(pid);
  await once(child, "exit");
  assert.equal(await inspectApiProcess(pid), null);
});
