import assert from "node:assert/strict";
import { mkdtemp, writeFile, realpath, rm, readdir, readFile, mkdir, copyFile, rename } from "node:fs/promises";
import { dirname, basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { once } from "node:events";
import test from "node:test";
import { launchApiAttempt, verifyApiAdoption } from "../deploy/demian/start-api.mjs";
import { apiListeners, inspectApiProcess } from "../deploy/demian/windows-api-process.mjs";

async function fixture(t: test.TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "demian-api-child-")));
  let beforeCleanup = async () => {};
  t.after(async () => { await beforeCleanup(); assert.equal(dirname(resolve(root)), await realpath(tmpdir())); assert(basename(root).startsWith("demian-api-child-")); await rm(root, { recursive: true, force: true }); });
  const socket = createServer(); socket.listen(0, "127.0.0.1"); await once(socket, "listening"); const address = socket.address(); assert(address && typeof address !== "string");
  const port = address.port; await new Promise<void>(done => socket.close(() => done()));
  const entry = join(root, "main.mjs"); await writeFile(entry, "import {createServer} from 'node:http'; const server=createServer((q,r)=>{r.setHeader('connection','close');r.end('ok',()=>{if(q.url==='/qa/stop'){server.closeAllConnections();server.close(()=>process.exit(0));}});});server.listen(Number(process.env.PORT),'127.0.0.1');\n");
  const plan = { executable: process.execPath, entry, repository: root }, env = { ...process.env, PORT: String(port) };
  return { root, plan, env, port, cleanupBeforeRemove: (callback: () => Promise<void>) => { beforeCleanup = callback; } };
}

for (const point of ["scope", "publish"] as const) test(`failed ${point} recheck kills only the retained cold-start child`, { skip: process.platform !== "win32" }, async t => {
  const f = await fixture(t); let published = false;
  await assert.rejects(launchApiAttempt({ ...f, active: { state: "active" }, revalidate: async () => { if (point === "scope") throw Error("Fixture changed scope"); },
    publish: async () => { published = true; throw Error("Fixture persistence failure"); } }));
  assert.equal(published, point === "publish"); assert.deepEqual(await apiListeners(f.port), []);
  const attempts = await readdir(join(f.root, "demian-api-startup-attempts")); assert.equal(attempts.length, 1);
  const owned = JSON.parse(await readFile(join(f.root, "demian-api-startup-attempts", attempts[0]!, "owned-process.json"), "utf8"));
  assert.equal(await inspectApiProcess(owned.pid), null);
});

for (const layout of ["original", "plain-executable-spaced-entry"] as const) test(`cold-start ${layout} publishes only the ready child with native listener and creation identity`, { skip: process.platform !== "win32" }, async t => {
  const f = await fixture(t); let published = 0; let owned: { pid: number; created: string; executable: string } | undefined;
  if (layout === "plain-executable-spaced-entry") {
    await mkdir(join(f.root, "tools")); await mkdir(join(f.root, "entry with spaces"));
    f.plan.executable = join(f.root, "tools/node.exe"); await copyFile(process.execPath, f.plan.executable);
    const entry = join(f.root, "entry with spaces/main.mjs"); await rename(f.plan.entry, entry); f.plan.entry = entry;
  }
  f.cleanupBeforeRemove(async () => {
    if (!owned) return;
    assert.equal((await inspectApiProcess(owned.pid))?.created, owned.created);
    assert((await apiListeners(f.port)).every(row => row.pid === owned!.pid));
    await (await fetch(`http://127.0.0.1:${f.port}/qa/stop`, { signal: AbortSignal.timeout(2000) })).text();
    const deadline = performance.now() + 10000;
    let current = await inspectApiProcess(owned.pid);
    while (current && performance.now() < deadline) current = await inspectApiProcess(owned.pid);
    assert.equal(current, null);
  });
  const result = await launchApiAttempt({ ...f, active: { state: "active" }, revalidate: async () => {}, publish: async record => {
    published++; owned = record.process; assert.equal(record.process.pid, (await apiListeners(f.port))[0]!.pid);
    assert.equal(record.automaticStartupConfigured, true);
  } });
  assert.equal(published, 1); assert.equal(result.pid, owned!.pid); assert.equal(result.workerStarted, false);
  assert.equal((await inspectApiProcess(result.pid))?.created, owned!.created);
});

test("adoption rechecks native process ownership after an HTTP-ready check loses its listener", { skip: process.platform !== "win32" }, async t => {
  const f = await fixture(t); let owned: Awaited<ReturnType<typeof inspectApiProcess>>;
  await launchApiAttempt({ ...f, active: { state: "active" }, revalidate: async () => {}, publish: async record => { owned = record.process; } });
  assert(owned!);
  // Readiness is true, then the old owner exits and this fixture process binds
  // the same port. A successful health response alone must not authorize reuse.
  const record = owned!, initial = await apiListeners(f.port);
  const replacement = createServer();
  f.cleanupBeforeRemove(async () => {
    if (replacement.listening) await new Promise<void>(done => replacement.close(() => done()));
    const current = await inspectApiProcess(record.pid);
    if (current) {
      assert.equal(current.created, record.created); await (await fetch(`http://127.0.0.1:${f.port}/qa/stop`, { signal: AbortSignal.timeout(2000) })).text();
      let alive = await inspectApiProcess(record.pid); const deadline = performance.now() + 10000;
      while (alive && performance.now() < deadline) alive = await inspectApiProcess(record.pid);
      assert.equal(alive, null);
    }
  });
  await assert.rejects(verifyApiAdoption({ record, plan: f.plan, current: record, listeners: initial, port: f.port, checkReady: async () => {
    assert.equal((await fetch(`http://127.0.0.1:${f.port}/health/ready`)).status, 200);
    await (await fetch(`http://127.0.0.1:${f.port}/qa/stop`)).text();
    let alive = await inspectApiProcess(record.pid); const until = performance.now() + 10000;
    while (alive && performance.now() < until) alive = await inspectApiProcess(record.pid);
    assert.equal(alive, null);
    replacement.listen(f.port, "127.0.0.1"); await once(replacement, "listening"); return true;
  } }));
  assert((await apiListeners(f.port)).some(row => row.pid === process.pid));
});
