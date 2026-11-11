import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, realpath, writeFile, copyFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { patchStartup } from "./patch-startup.mjs";
import { verifyFrozenRelease } from "./web-release-policy.mjs";
import { recoverWebProfiles } from "./recover-webs.mjs";

const exec = promisify(execFile);
const sha = data => createHash("sha256").update(data).digest("hex");
const state = join(homedir(), ".demian/service");
const root = join(state, "track-context");
const helpers = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(helpers, "../..");
let stage = "preflight";
const json = async file => JSON.parse(await readFile(file, "utf8"));
const save = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + "\n");
const command = async (file, args) => {
  try { return (await exec(file, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 })).stdout; }
  catch { throw new Error("Native operation failed at " + stage); }
};

async function fileSet(directory) {
  const files = {};
  async function walk(path) {
    for (const row of await readdir(path, { withFileTypes: true })) {
      assert(!row.isSymbolicLink());
      const file = join(path, row.name);
      if (row.isDirectory()) await walk(file);
      else { assert(row.isFile()); files[relative(directory, file).split(sep).join("/")] = sha(await readFile(file)); }
    }
  }
  await walk(directory); return files;
}

async function copyFrozenDirectory(source, target) {
  const files = await fileSet(source);
  for (const name of Object.keys(files)) {
    const output = resolve(target, name);
    assert(output.startsWith(resolve(target) + sep));
    await mkdir(dirname(output), { recursive: true });
    await copyFile(join(source, name), output);
    assert.equal(sha(await readFile(output)), files[name]);
  }
  assert.deepEqual(await fileSet(source), files);
}

async function ownedWeb(record, stop = false, allowExited = false) {
  const args = ["-NoProfile", "-File", join(helpers, "inspect-web.ps1"), "-TargetProcessId", String(record.pid), "-Port", String(record.port), "-Entry", record.entry, "-StartedAt", record.startedAt];
  if (stop) args.push("-Stop");
  if (allowExited) args.push("-AllowExited");
  const checked = JSON.parse(await command("powershell.exe", args));
  assert(allowExited && checked.exited && checked.portFree || checked.matched && (!stop || checked.stopped));
  return checked;
}

async function startWeb(profile, release) {
  const output = JSON.parse(await command(process.execPath, [join(helpers, "run-web.mjs"), "--profile", profile, "--release", release]));
  assert(output.started && output.profile === profile);
  assert(output.record?.state === "ready" && output.record.profile === profile && output.record.releaseDir === release && output.record.pid === output.pid);
  return output.record;
}

async function writeExclusive(file, expected, data, backup) {
  assert(expected === null || /^[a-f0-9]{64}$/.test(expected));
  const payload = join(backup, "write-" + randomUUID() + ".payload");
  await writeFile(payload, data, { flag: "wx" });
  try {
    const args = ["-NoProfile", "-File", join(helpers, "write-exclusive.ps1"), "-Target", file, "-Payload", payload];
    if (expected === null) args.push("-ExpectedMissing"); else args.push("-ExpectedSha256", expected);
    const result = JSON.parse((await exec("powershell.exe", args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 })).stdout);
    assert(result.updated && result.sha256 === sha(data));
  } catch (error) {
    let outcome;
    try { outcome = JSON.parse(error.stdout); } catch { /* No mutation state was reported. */ }
    const failure = { target: file, targetMutated: outcome?.targetMutated ?? null, previousRestored: outcome?.restored ?? null, unresolvedRestoration: outcome?.restorationFailed ?? null };
    await save(join(backup, "write-failure-" + randomUUID() + ".json"), failure).catch(() => undefined);
    console.error(JSON.stringify({ nativeMetadataWriteFailed: true, ...failure }));
    throw new Error("Native guarded write failed");
  } finally { await unlink(payload).catch(() => undefined); }
}

async function processIdentities(ids) {
  assert(ids.every(id => Number.isInteger(id) && id > 0));
  return JSON.parse(await command("powershell.exe", ["-NoProfile", "-Command", `@(${ids.join(",")}) | ForEach-Object { $taskProcess=Get-CimInstance Win32_Process -Filter \"ProcessId = $_\"; if(-not $taskProcess){exit 1}; [pscustomobject]@{pid=$taskProcess.ProcessId;created=$taskProcess.CreationDate.ToUniversalTime().ToString('o');name=$taskProcess.Name} } | ConvertTo-Json -Compress`]));
}

async function main() {
  const execute = process.argv.includes("--execute");
  const preflight = process.argv.includes("--preflight");
  assert(execute !== preflight, "Choose explicit preflight or execute");
  const releaseArg = process.argv[process.argv.indexOf("--release") + 1];
  const release = await realpath(releaseArg);
  const releases = await realpath(join(root, "releases"));
  assert(relative(releases, release) && dirname(release) === releases);
  assert.equal((await readFile(join(root, "purpose"), "utf8")).replaceAll("\r\n", "\n"), "agent-track-native-demian-context-v1\n");
  const meta = await json(join(release, "release.json"));
  stage = "verify frozen candidate";
  await verifyFrozenRelease(release, meta);
  const baseline = await json(join(repoRoot, ".runtime/demian-context/baseline.json"));
  const serviceFile = join(state, "service.json"); const localFile = join(state, "processes.json"); const publicFile = join(state, "domain/processes.json");
  const serviceBytes = await readFile(serviceFile); const service = JSON.parse(serviceBytes.toString("utf8"));
  const localBytes = await readFile(localFile); const local = JSON.parse(localBytes.toString("utf8"));
  const publicBytes = await readFile(publicFile); const domainProcesses = JSON.parse(publicBytes.toString("utf8"));
  const metadataExpected = new Map([[serviceFile, sha(serviceBytes)], [localFile, sha(localBytes)], [publicFile, sha(publicBytes)]]);
  const saveMetadata = async (file, value) => {
    const data = JSON.stringify(value, null, 2) + "\n";
    await writeExclusive(file, metadataExpected.get(file), data, backup); metadataExpected.set(file, sha(data));
  };
  const nativeRepo = service.repository;
  stage = "verify unchanged native source build";
  assert.equal((await readFile(join(nativeRepo, "apps/web/.next/BUILD_ID"), "utf8")).trim(), baseline.nativeBuildId);
  for (const [name, expected] of Object.entries(baseline.nativeStaticFiles)) assert.equal(sha(await readFile(join(nativeRepo, "apps/web/.next", name))), expected);
  assert.equal(service.source.webBuildId, baseline.nativeBuildId);
  const entry = nativeRepo + "/node_modules/next/dist/bin/next";
  const old = {
    local: { ...local.children.find(row => row.name === "web"), port: 3000, entry },
    public: { ...domainProcesses.children.find(row => row.name === "public-web"), port: 3001, entry },
  };
  stage = "verify original web ownership";
  await ownedWeb(old.local); await ownedWeb(old.public);
  const preserved = {
    apiPid: local.children.find(row => row.name === "api").pid,
    gatePid: domainProcesses.children.find(row => row.name === "auth-gate").pid,
    tunnelPid: domainProcesses.children.find(row => row.name === "domain-tunnel").pid,
    workerMetadata: sha(await readFile(join(state, "worker-process.json"))),
    apiBundle: sha(await readFile(join(nativeRepo, "apps/api/dist/main.mjs"))),
  };
  const worker = await json(join(state, "worker-process.json"));
  const backendIds = [preserved.apiPid, preserved.gatePid, preserved.tunnelPid, worker.pid];
  assert(new Set([...backendIds, old.local.pid, old.public.pid]).size === 6);
  stage = "verify original backend processes";
  preserved.processes = await processIdentities(backendIds);
  const activeFile = join(root, "active.json");
  try { await readFile(activeFile); throw new Error("Existing active release preserved"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const candidates = [];
  for (const [profile, name] of [["local", "start.mjs"], ["public", "start-domain.mjs"]]) {
    const before = await readFile(join(state, name));
    candidates.push({ name, before, after: Buffer.from(patchStartup(before.toString("utf8"), profile)) });
  }
  if (preflight) {
    console.log(JSON.stringify({ preflightReady: true, baseBuildId: baseline.nativeBuildId, targetBuildId: meta.webBuildId, originalWebPids: [old.local.pid, old.public.pid], preserved, startupPatchesValidated: candidates.length, nativeMutations: 0 }));
    return;
  }
  const backup = join(root, "backups", new Date().toISOString().replace(/[:.]/g, "-"));
  await mkdir(backup, { recursive: true });
  await writeFile(join(backup, "service.json"), serviceBytes); await writeFile(join(backup, "processes.json"), localBytes); await writeFile(join(backup, "domain-processes.json"), publicBytes);
  for (const item of candidates) await writeFile(join(backup, item.name), item.before);
  stage = "prepare independent original web rollback";
  const fallback = join(releases, "base-" + baseline.nativeBuildId + "-" + new Date().toISOString().replace(/[:.]/g, "-"));
  try { await realpath(fallback); throw new Error("Existing fallback release preserved"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  await mkdir(fallback);
  await copyFrozenDirectory(join(nativeRepo, "apps/web/.next/standalone"), fallback);
  await copyFrozenDirectory(join(nativeRepo, "apps/web/.next/static"), join(fallback, "apps/web/.next/static"));
  await copyFrozenDirectory(join(nativeRepo, "apps/web/public"), join(fallback, "apps/web/public"));
  const fallbackMeta = { version: 1, webBuildId: baseline.nativeBuildId, payloadFiles: await fileSet(fallback) };
  await save(join(fallback, "release.json"), fallbackMeta);
  await verifyFrozenRelease(fallback, fallbackMeta);
  stage = "online native database backup";
  const dbInfo = JSON.parse(await command("docker", ["inspect", service.container]))[0];
  assert.equal(dbInfo.Id, service.containerId); assert(dbInfo.State.Running);
  const dumpPath = join(backup, "native-postgres.dump"); const dump = await open(dumpPath, "wx");
  try {
    const child = spawn("docker", ["exec", service.container, "pg_dump", "-U", "demian", "-d", "demian", "-Fc"], { windowsHide: true, stdio: ["ignore", dump.fd, "ignore"] });
    await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(new Error("Native backup failed"))); });
  } finally { await dump.close(); }
  const restoreList = spawn("docker", ["exec", "-i", service.container, "pg_restore", "--list"], { windowsHide: true, stdio: ["pipe", "ignore", "ignore"] });
  const listed = new Promise((resolve, reject) => { restoreList.once("error", reject); restoreList.once("exit", code => code === 0 ? resolve() : reject(new Error("Native backup validation failed"))); });
  restoreList.stdin.end(await readFile(dumpPath)); await listed;
  const contextFile = join(homedir(), ".local/share/agent-track/demian-context-native.json");
  let activeExpected = null;
  const activate = async directory => {
    const data = JSON.stringify({ version: 1, enabled: true, releaseDir: directory, contextFile, manifestSha256: sha(await readFile(join(directory, "release.json"))) }, null, 2) + "\n";
    await writeExclusive(activeFile, activeExpected, data, backup); activeExpected = sha(data);
  };
  const updateProfileMetadata = async (profile, record, buildId) => {
    const original = profile === "local" ? local : domainProcesses;
    const childName = profile === "local" ? "web" : "public-web";
    const updated = { ...original, at: new Date().toISOString(), children: original.children.map(row => row.name === childName ? { ...row, pid: record.pid, startedAt: record.startedAt, trackContextBuildId: buildId } : row) };
    await saveMetadata(profile === "local" ? localFile : publicFile, updated);
  };
  const updateSharedMetadata = async buildId => {
    await saveMetadata(serviceFile, { ...service, source: { ...service.source, webBuildId: buildId, trackContextRelease: buildId } });
  };
  const updateMetadata = async (records, buildId) => {
    await updateProfileMetadata("local", records.local, buildId);
    await updateProfileMetadata("public", records.public, buildId);
    await updateSharedMetadata(buildId);
  };
  const stopped = new Set(); const started = {};
  const patchedBootstrap = new Set();
  let complete = false;
  try {
    stage = "install optional startup dispatch";
    assert.equal(sha(await readFile(serviceFile)), sha(serviceBytes));
    for (const item of candidates) { await writeExclusive(join(state, item.name), sha(item.before), item.after, backup); patchedBootstrap.add(item.name); }
    await copyFile(join(helpers, "web-release-policy.mjs"), join(root, "web-release-policy.mjs"));
    await activate(release);
    stage = "replace only the two native web processes";
    for (const profile of ["local", "public"]) { await ownedWeb(old[profile], true, true); stopped.add(profile); }
    for (const profile of ["local", "public"]) started[profile] = await startWeb(profile, release);
    stage = "verify native context and unchanged backend identities";
    const request = await fetch("http://127.0.0.1:3000/track-context/sessions/6e26fd8b-76ff-43ec-8b55-1c42fd86da94", { headers: { "X-Track-Expected-Actor": "00000000-0000-0000-0000-000000000010", "X-Demian-Organization-Id": "00000000-0000-0000-0000-000000000001" }, signal: AbortSignal.timeout(5000) });
    const context = await request.json(); assert.equal(request.status, 200); assert.equal(context.state, "connected"); assert(context.summary.counts.runs >= 3);
    const publicRequest = await fetch("http://127.0.0.1:3001/track-context/sessions/6e26fd8b-76ff-43ec-8b55-1c42fd86da94", { headers: { host: "demian.pydemia.ai", "X-Track-Expected-Actor": "00000000-0000-0000-0000-000000000010", "X-Demian-Organization-Id": "00000000-0000-0000-0000-000000000001" }, signal: AbortSignal.timeout(5000) });
    const publicContext = await publicRequest.json(); assert.equal(publicRequest.status, 200); assert.equal(publicContext.state, "connected"); assert(publicContext.summary.counts.runs >= 3);
    const publicPage = await fetch("http://127.0.0.1:3001/sessions/6e26fd8b-76ff-43ec-8b55-1c42fd86da94", { headers: { host: "demian.pydemia.ai" }, signal: AbortSignal.timeout(5000) });
    assert.equal(publicPage.status, 200); assert((await publicPage.text()).includes("Demian"));
    assert.equal(sha(await readFile(join(state, "worker-process.json"))), preserved.workerMetadata);
    assert.equal(sha(await readFile(join(nativeRepo, "apps/api/dist/main.mjs"))), preserved.apiBundle);
    assert.deepEqual(await processIdentities(backendIds), preserved.processes);
    assert.equal(JSON.parse(await command("docker", ["inspect", service.container]))[0].Id, dbInfo.Id);
    const gate = await fetch("http://127.0.0.1:3100/track-context/sessions/6e26fd8b-76ff-43ec-8b55-1c42fd86da94", { headers: { host: "demian.pydemia.ai" }, signal: AbortSignal.timeout(3000) });
    assert.equal(gate.status, 401); assert(gate.headers.get("www-authenticate")?.startsWith("Basic "));
    await ownedWeb(started.local); await ownedWeb(started.public);
    await updateMetadata(started, meta.webBuildId);
    const result = { verifiedAt: new Date().toISOString(), webBuildId: meta.webBuildId, localWebPid: started.local.pid, publicWebPid: started.public.pid, preserved, originalSourceBuildUnmodified: true, databaseBackupValidated: true, apiWorkerDatabaseGateTunnelPreserved: true, nativeContextRuns: context.summary.counts.runs, publicUpstreamContextRuns: publicContext.summary.counts.runs, publicUpstreamPageWorking: true, publicBasicGatePreserved: true, browserProductionVerification: "pending", backup };
    await save(join(backup, "result.json"), result); await save(join(root, "promotion-result.json"), result);
    complete = true; console.log(JSON.stringify(result));
  } finally {
    if (!complete && !stopped.size) {
      // No app was stopped. Restore only bootstrap files still equal to this
      // operation's patch, and leave any independently changed files intact.
      if (activeExpected !== null) {
        const disabled = JSON.stringify({ version: 1, enabled: false }) + "\n";
        await writeExclusive(activeFile, activeExpected, disabled, backup); activeExpected = sha(disabled);
      }
      for (const item of candidates) {
        if (patchedBootstrap.has(item.name) && sha(await readFile(join(state, item.name))) === sha(item.after)) await writeExclusive(join(state, item.name), sha(item.after), item.before, backup);
      }
      const startupRestored = (await Promise.all(candidates.map(async item => sha(await readFile(join(state, item.name))) === sha(item.before)))).every(Boolean);
      await save(join(backup, "rollback.json"), { noWebStopped: true, originalStartupRestored: startupRestored, unresolvedStartupRestoration: !startupRestored, databaseRestoredOrDowngraded: false });
    }
    if (!complete && stopped.size) {
      stage = "restore independently frozen original web";
      const recovery = await recoverWebProfiles({ activateFallback: () => activate(fallback), replacements: started, originals: old, stopped,
        stop: record => ownedWeb(record, true, true), start: profile => startWeb(profile, fallback), inspectOriginal: record => ownedWeb(record, false, true),
        commitProfile: (profile, record) => updateProfileMetadata(profile, record, baseline.nativeBuildId),
      });
      await save(join(backup, "recovery-state.json"), { ...recovery, sharedReleaseMetadataUpdated: false, databaseRestoredOrDowngraded: false });
      assert(!recovery.failedProfiles.length, "Inspect the independently recovered profiles; other listeners preserved.");
      assert(!recovery.metadataUpdateFailures.length, "Inspect the independently recovered process metadata.");
      await updateSharedMetadata(baseline.nativeBuildId);
      await save(join(backup, "recovery-state.json"), { ...recovery, sharedReleaseMetadataUpdated: true, databaseRestoredOrDowngraded: false });
      await save(join(backup, "rollback.json"), { originalWebRestoredFromFrozenBase: true, databaseRestoredOrDowngraded: false });
    }
  }
}

let operationLock; let lockBytes;
try {
  if (process.argv.includes("--execute")) {
    assert.equal((await readFile(join(root, "purpose"), "utf8")).replaceAll("\r\n", "\n"), "agent-track-native-demian-context-v1\n");
    operationLock = await open(join(root, "promotion.lock"), "wx");
    lockBytes = JSON.stringify({ pid: process.pid, entry: fileURLToPath(import.meta.url), startedAt: new Date().toISOString() });
    await operationLock.writeFile(lockBytes);
  }
  await main();
} catch { console.error(JSON.stringify({ promotion: "failed", stage, inspectPrivateOperationState: true })); process.exitCode = 1; }
finally {
  if (operationLock) {
    await operationLock.close();
    if ((await readFile(join(root, "promotion.lock"), "utf8")) === lockBytes) await unlink(join(root, "promotion.lock"));
  }
}
