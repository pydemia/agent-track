import assert from "node:assert/strict";
import { test, mock } from "node:test";
import childProcess, { fork, spawn, type ChildProcess } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { once } from "node:events";
import { inspectOwnedWeb, stopOwnedWeb } from "../deploy/demian/windows-web-process.mjs";
import { inspectApiProcess, type ApiProcessSnapshot } from "../deploy/demian/windows-api-process.mjs";
import { recoverPublicWeb } from "../deploy/demian/recover-webs.mjs";

const example = { pid: 123, name: "node.exe", executable: "C:\\fixture\\node.exe", created: "2026-01-01T00:00:00.0000000Z", command: "fixture" };

test("invalid inputs fail before any subprocess", async () => {
  let calls = 0;
  const mocked = mock.method(childProcess, "execFile", () => { calls++; throw new Error("unexpected subprocess"); });
  syncBuiltinESMExports();
  try {
    const invalid = [null, {}, ...["name", "executable", "created", "command"].flatMap(key =>
      [undefined, "", " ", 7, "secret\0value"].map(value => ({ ...example, [key]: value }))),
      ...[0, -1, 1.5, NaN, Infinity, 0x100000000, "123"].map(pid => ({ ...example, pid })),
      { ...example, created: "2026-01-01T00:00:00Z" }, { ...example, created: example.created + "\n" }];
    for (const record of invalid) {
      await assert.rejects(inspectOwnedWeb(record as ApiProcessSnapshot, 12345), TypeError);
      await assert.rejects(stopOwnedWeb(record as ApiProcessSnapshot, 12345), TypeError);
    }
    for (const port of [0, -1, 65536, 0.5, NaN, Infinity, "12345"]) {
      await assert.rejects(inspectOwnedWeb(example, port as number), TypeError);
      await assert.rejects(stopOwnedWeb(example, port as number), TypeError);
    }
    await assert.rejects(inspectOwnedWeb(example, 12345, {} as ApiProcessSnapshot), TypeError);
    await assert.rejects(inspectOwnedWeb(example, 12345, example), TypeError);
    assert.equal(calls, 0);
  } finally { mocked.mock.restore(); syncBuiltinESMExports(); }
});

test("observation failures expose only a generic error", { skip: process.platform !== "win32" }, async () => {
  for (const response of ["not json: fixture-secret", '{"ok":false}', '{"ok":true,"result":{"state":"stopped"}}']) {
    const mocked = mock.method(childProcess, "execFile", (...args: any[]) => {
      args.at(-1)(null, response, "fixture-secret");
      return {} as ChildProcess;
    });
    syncBuiltinESMExports();
    try {
      await assert.rejects(inspectOwnedWeb(example, 12345), { message: "Unable to verify Windows web process ownership." });
    } finally { mocked.mock.restore(); syncBuiltinESMExports(); }
  }
});

test("isolated Windows ownership and retained-handle stop", { skip: process.platform !== "win32", timeout: 240000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "demian-web-process-fixture-"));
  const children: ChildProcess[] = [];
  const processHandles: ChildProcess[] = [];
  const fixture = join(root, "demian-web-process-fixture.mjs");
  await writeFile(fixture, `import net from 'node:net';
const server = net.createServer();
server.listen(Number(process.argv[2]), '127.0.0.1', () => process.send({port: server.address().port}));
process.on('message', message => { if (message === 'exit') server.close(() => process.exit(0)); });
`);
  async function start(port = 0) {
    const child = fork(fixture, [String(port)], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
    children.push(child);
    const [message] = await once(child, "message", { signal: AbortSignal.timeout(10000) });
    assert.ok(![3000, 3001, 3100, 8080, 14345].includes((message as { port: number }).port));
    // These cases require the recorded PID to remain unused after fixture exit.
    // Keep its native object alive: otherwise Windows may give a later CIM
    // helper the same PID, for which the production guard correctly says foreign.
    // PROCESS_INFORMATION.dwProcessId lifetime: https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/ns-processthreadsapi-process_information
    const retained = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", String.raw`
$ErrorActionPreference = 'Stop'
$held = [System.Diagnostics.Process]::GetProcessById([int]$env:DEMIAN_FIXTURE_HANDLE_PID)
try {
  $nativeHandle = $held.Handle
  [Console]::Out.WriteLine('held')
  [void][Console]::In.ReadLine()
} finally { $held.Dispose() }
`], { windowsHide: true, env: { ...process.env, DEMIAN_FIXTURE_HANDLE_PID: String(child.pid) }, stdio: ["pipe", "pipe", "ignore"] });
    processHandles.push(retained);
    const [ready] = await once(retained.stdout!, "data", { signal: AbortSignal.timeout(10000) });
    assert.equal(String(ready).trim(), "held");
    const record = await inspectApiProcess(child.pid!);
    assert.ok(record);
    return { child, record, port: (message as { port: number }).port };
  }
  async function exit(child: ChildProcess) {
    const done = once(child, "exit", { signal: AbortSignal.timeout(10000) });
    child.send("exit");
    await done;
  }
  try {
    const original = await start();
    assert.deepEqual(await inspectOwnedWeb(original.record, original.port), { state: "owned-live" });
    for (const forged of [
      { ...original.record, command: original.record.command + " --forged" },
      { ...original.record, created: "2000-01-01T00:00:00.0000000Z" },
      { ...original.record, name: "forged.exe" },
      { ...original.record, executable: original.record.executable + ".forged" },
    ]) {
      assert.deepEqual(await inspectOwnedWeb(forged, original.port), { state: "foreign" });
      await assert.rejects(stopOwnedWeb(forged, original.port), { message: "Unable to verify Windows web process ownership." });
      assert.equal(original.child.exitCode, null);
    }
    const foreign = await start();
    const forgedPid = { ...original.record, pid: foreign.record.pid };
    assert.deepEqual(await inspectOwnedWeb(forgedPid, foreign.port), { state: "foreign" });
    await assert.rejects(stopOwnedWeb(forgedPid, foreign.port));
    assert.deepEqual(await inspectOwnedWeb(original.record, foreign.port), { state: "foreign" });
    await assert.rejects(stopOwnedWeb(original.record, foreign.port));

    // Inject unsafe listener observations; actual fixtures bind only 127.0.0.1.
    // Everything else, including CIM and the retained handle, runs on Windows.
    const realExec = childProcess.execFile;
    for (const addresses of [["0.0.0.0"], ["::"], ["127.0.0.1", "127.0.0.1"]]) {
      const mocked = mock.method(childProcess, "execFile", (...args: any[]) => {
        const commandArgs = [...args[1]];
        const rows = addresses.map(address => ` [pscustomobject]@{ LocalAddress = '${address}'; LocalPort = ${original.port}; OwningProcess = ${original.record.pid} }`).join(";\n");
        commandArgs[commandArgs.length - 1] = commandArgs.at(-1).replace("try {\n  $inputData", `function Listeners { ${rows} }\ntry {\n  $inputData`);
        return (realExec as any)(args[0], commandArgs, ...args.slice(2));
      });
      syncBuiltinESMExports();
      try {
        assert.deepEqual(await inspectOwnedWeb(original.record, original.port), { state: "foreign" });
        await assert.rejects(stopOwnedWeb(original.record, original.port));
        assert.equal(original.child.exitCode, null);
      } finally { mocked.mock.restore(); syncBuiltinESMExports(); }
    }

    // Change the final identity/listener observation only after the handle is
    // retained. A refusal must leave the real fixture alive in both cases.
    for (const injected of [
      "$inputData.record.command = 'forged-final-command'",
      `function Listeners { [pscustomobject]@{ LocalAddress = '127.0.0.1'; LocalPort = ${original.port}; OwningProcess = ${foreign.record.pid} } }`,
    ]) {
      const mocked = mock.method(childProcess, "execFile", (...args: any[]) => {
        const commandArgs = [...args[1]];
        const source = commandArgs.at(-1) as string;
        assert.ok(!/Stop-Process/i.test(source));
        assert.ok(source.indexOf("$retainedHandle = $held.Handle") < source.indexOf("::TerminateProcess($retainedHandle, 1)"));
        assert.ok(!source.includes("$held.Kill()"));
        commandArgs[commandArgs.length - 1] = source.replace("$retainedHandle = $held.Handle", `$retainedHandle = $held.Handle\n${injected}`);
        return (realExec as any)(args[0], commandArgs, ...args.slice(2));
      });
      syncBuiltinESMExports();
      try {
        await assert.rejects(stopOwnedWeb(original.record, original.port));
        assert.equal(original.child.exitCode, null);
        assert.equal(foreign.child.exitCode, null);
      } finally { mocked.mock.restore(); syncBuiltinESMExports(); }
    }

    await exit(original.child);
    assert.deepEqual(await inspectOwnedWeb(original.record, original.port), { state: "exited-free" });
    assert.deepEqual(await stopOwnedWeb(original.record, original.port), { state: "exited" });
    // Realistic same-port replacement: exited original, then known successor.
    const replacement = await start(original.port);
    assert.deepEqual(await inspectOwnedWeb(original.record, original.port), { state: "foreign" });
    assert.deepEqual(await inspectOwnedWeb(original.record, original.port, foreign.record), { state: "foreign" });
    assert.deepEqual(await inspectOwnedWeb(original.record, original.port, { ...replacement.record, command: "forged" }), { state: "foreign" });
    assert.deepEqual(await inspectOwnedWeb(original.record, original.port, replacement.record), {
      state: "exited-occupied", listenerPid: replacement.record.pid,
    });
    assert.deepEqual(await inspectOwnedWeb(replacement.record, original.port, original.record), { state: "owned-live" });
    await assert.rejects(stopOwnedWeb(original.record, original.port));
    assert.equal(replacement.child.exitCode, null);
    assert.deepEqual(await stopOwnedWeb(replacement.record, original.port), { state: "stopped" });
    assert.deepEqual(await inspectOwnedWeb(replacement.record, original.port), { state: "exited-free" });
    assert.deepEqual(await inspectOwnedWeb(original.record, original.port, replacement.record), { state: "exited-free" });
    assert.deepEqual(await stopOwnedWeb(foreign.record, foreign.port), { state: "stopped" });

    // Exercise the rollback controller against real Windows observations and a
    // held-handle stop, including a successful stop whose response is lost.
    const candidate = await start(original.port);
    let restored: Awaited<ReturnType<typeof start>> | undefined;
    const journal: number[] = [];
    const commits: number[] = [];
    const recovery = await recoverPublicWeb({
      original: original.record,
      replacement: candidate.record,
      activateFallback: async () => { throw new Error("fixture activation conflict"); },
      journalIntent: async record => { journal.push(record.pid); },
      inspect: record => inspectOwnedWeb(record, original.port,
        record.pid === original.record.pid ? candidate.record : original.record),
      stop: async record => { await stopOwnedWeb(record, original.port); throw new Error("fixture lost stop response"); },
      startFrozenFallback: async () => { restored = await start(original.port); return restored.record; },
      commitPublic: async record => { commits.push(record.pid); },
    });
    assert.ok(restored);
    assert.deepEqual(recovery, { recoveredIdentity: restored.record, activationFailed: true, recoveryFailed: false, metadataUpdateFailed: false });
    assert.deepEqual(journal, [candidate.record.pid]);
    assert.deepEqual(commits, [restored.record.pid]);
    assert.deepEqual(await inspectOwnedWeb(restored.record, original.port), { state: "owned-live" });
    await stopOwnedWeb(restored.record, original.port);
  } finally {
    // Only ChildProcess objects created here may be cleaned up, never recorded PIDs.
    const cleanupErrors: unknown[] = [];
    for (const child of children) {
      try {
        if (child.exitCode === null && child.signalCode === null) {
          const done = once(child, "exit", { signal: AbortSignal.timeout(10000) });
          child.kill();
          await done;
        }
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    for (const retained of processHandles) {
      try {
        if (retained.exitCode === null && retained.signalCode === null) {
          const done = once(retained, "exit", { signal: AbortSignal.timeout(10000) });
          retained.stdin!.end();
          try {
            await done;
          } catch (error) {
            if (retained.exitCode === null && retained.signalCode === null) {
              const killed = once(retained, "exit", { signal: AbortSignal.timeout(10000) });
              retained.kill();
              await killed;
            }
            cleanupErrors.push(error);
          }
        }
        assert.equal(retained.exitCode, 0);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      assert.equal(dirname(resolve(root)), resolve(tmpdir()));
      assert.ok(basename(root).startsWith("demian-web-process-fixture-"));
      await rm(root, { recursive: true, force: true });
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Windows web fixture cleanup failed.");
  }
});
