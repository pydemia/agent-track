import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify, isDeepStrictEqual } from "node:util";
import { validatePublicWebInput, publicWebHelpers, assertRegularPublicFile } from "./public-web-input.mjs";
import { nativeWebDatabaseState } from "./native-web-database.mjs";
import { verifyFrozenRelease } from "./web-release-policy.mjs";
import { patchStartup } from "./patch-startup.mjs";
import { apiListeners, inspectApiProcess } from "./windows-api-process.mjs";
import { inspectOwnedWeb, stopOwnedWeb } from "./windows-web-process.mjs";
import { webLaunchRecordPath, matchesWebLaunch } from "./web-launch-policy.mjs";
import { recoverPublicWeb } from "./recover-webs.mjs";
import { executePublicWebTransition } from "./public-web-transition.mjs";
import { requestPublicGate } from "./public-web-gate.mjs";

const exec = promisify(execFile);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const nativeState = join(homedir(), ".demian/service");
const samePath = (a, b) => relative(resolve(a), resolve(b)) === "";
const safeError = () => new Error("Public web operation could not be verified");
async function bytes(file, limit = 2 * 1024 * 1024) {
  const handle = await open(file, "r");
  try { const stat = await handle.stat(); assert(stat.isFile() && stat.size <= limit); return await handle.readFile(); }
  finally { await handle.close(); }
}
async function digest(file) {
  try { return hash(await bytes(file)); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
async function json(file) { return JSON.parse((await bytes(file)).toString("utf8")); }
async function absent(file) { assert.equal(await digest(file), null, "Existing operation state preserved"); }
async function saveNew(file, data) {
  const handle = await open(file, "wx");
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
}

export async function readWebVerificationResponse(response, limit) {
  assert(Number.isSafeInteger(limit) && limit > 0 && limit <= 8 * 1024 * 1024);
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel().catch(() => undefined); throw safeError(); }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size);
  } finally { reader.releaseLock(); }
}

/** A failed preservation probe must not become a fallback availability dependency. */
export async function publicWebLaunchPrerequisites(phase, { ownership, preservation }) {
  assert(["candidate", "rollback"].includes(phase));
  await ownership();
  if (phase === "candidate") await preservation();
}

/** Read-only preflight; no files, services, credentials or routes are modified. */
export async function preflightPublicWeb(inputFile, expectedSha256) {
  assert(process.platform === "win32");
  assert(typeof expectedSha256 === "string" && /^[a-f0-9]{64}$/.test(expectedSha256) && expectedSha256.length === 64);
  const inputBytes = await bytes(inputFile); assert.equal(hash(inputBytes), expectedSha256);
  const input = validatePublicWebInput(JSON.parse(inputBytes.toString("utf8")), { serviceState: nativeState, repository });
  assert(samePath(await realpath(input.serviceState), nativeState));
  assert(samePath(await realpath(input.contextRoot), join(nativeState, "track-context")));
  assert.equal((await bytes(join(input.contextRoot, "purpose"))).toString("utf8").replaceAll("\r\n", "\n"), "agent-track-native-demian-context-v1\n");
  const expectedFiles = new Map(Object.entries(input.protectedFiles));
  for (const [file, expected] of expectedFiles) { await assertRegularPublicFile(file); assert.equal(await digest(file), expected); }
  await absent(input.activation.file);
  for (const file of Object.values(input.distribution)) {
    await assertRegularPublicFile(file.target, true);
    assert.equal(await digest(file.source), file.targetSha256);
    assert.equal(await digest(file.target), file.beforeSha256);
  }
  for (const [name, role] of Object.entries(input.roles)) {
    assert.deepEqual(await inspectApiProcess(role.identity.pid), role.identity);
    if (name !== "tunnel") assert.deepEqual(await apiListeners(role.port), [{ address: "127.0.0.1", port: role.port, pid: role.identity.pid }]);
  }
  const service = await json(join(nativeState, "service.json"));
  const domain = await json(join(nativeState, "domain/config.json"));
  assert.equal(domain.webPort, 3001); assert.equal(domain.publicUrl, "https://demian.pydemia.ai");
  assert.equal(domain.gatePort, 3100);
  assert.equal(new URL(service.apiUrl).href, "http://127.0.0.1:8080/");
  assert.equal(new URL(domain.webUpstream).href, "http://127.0.0.1:3001/");
  const originalBuildFile = join(service.repository, "apps/web/.next/BUILD_ID");
  const originalBuild = await bytes(originalBuildFile); assert.equal(originalBuild.toString("utf8").trim(), input.rollback.webBuildId);
  expectedFiles.set(originalBuildFile, hash(originalBuild));
  const spell = value => /\s/.test(value) ? [`"${value}"`] : [value, `"${value}"`];
  const originalEntry = service.repository + "/node_modules/next/dist/bin/next";
  assert(spell(process.execPath).some(exe => spell(originalEntry).some(entry =>
    input.roles.web.identity.command === `${exe} ${entry} start --hostname 127.0.0.1 --port 3001`)));
  const metadataFile = join(nativeState, "domain/processes.json");
  const metadataBytes = await bytes(metadataFile), metadata = JSON.parse(metadataBytes.toString("utf8"));
  assert.equal(metadata.children.filter(row => row.name === "public-web").length, 1);
  assert.equal(metadata.children.find(row => row.name === "public-web").pid, input.roles.web.identity.pid);
  const startupBytes = await bytes(input.startup.file);
  assert.equal(hash(startupBytes), input.startup.beforeSha256);
  const startup = Buffer.from(patchStartup(startupBytes.toString("utf8"), "public", { publicOnly: true }));
  assert.equal(hash(startup), input.startup.afterSha256);
  const manifests = new Map();
  for (const release of [input.candidate, input.rollback]) {
    assert(samePath(dirname(await realpath(release.releaseDir)), await realpath(join(input.contextRoot, "releases"))));
    const data = await bytes(join(release.releaseDir, "release.json")); assert.equal(hash(data), release.manifestSha256);
    const manifest = JSON.parse(data.toString("utf8")); assert.equal(manifest.webBuildId, release.webBuildId);
    await verifyFrozenRelease(release.releaseDir, manifest); manifests.set(release.releaseDir, manifest);
  }
  assert.equal(await digest(input.backup.resultFile), input.backup.resultSha256);
  const backup = await json(input.backup.resultFile);
  assert(backup.ok && backup.backup.authenticatedReadback && backup.backup.tamperRejected && !backup.backup.plaintextWrittenToDisk);
  assert(backup.restore.dataAndSchemaEqual && backup.restore.rolesAndPasswordHashEqual && backup.restore.sequenceStateEqual && backup.restore.fullSchemaSemanticsEqual && backup.restore.ownedContainerDisposed);
  assert(!backup.originalDatabaseRestored && !backup.originalContainerRestarted && !backup.cleanupFailed);
  assert.equal(backup.source.containerId, service.containerId); assert.equal(backup.source.imageId, service.imageId);
  assert.equal(backup.source.volume, service.volume); assert.equal(backup.source.port, service.databasePort);
  assert.equal(await digest(input.backup.cipherFile), input.backup.cipherSha256);
  assert.equal(backup.backup.cipherSha256, input.backup.cipherSha256);
  assert(/^[a-f0-9]{64}$/.test(service.containerId));
  assert.equal(service.databasePort, 11931); assert.equal(service.volume, "demian-local-postgres-data");
  const containerSnapshot = async () => {
    const format = '{"id":{{json .Id}},"image":{{json .Image}},"running":{{json .State.Running}},"started":{{json .State.StartedAt}},"ports":{{json .NetworkSettings.Ports}},"mounts":{{json .Mounts}}}';
    const output = await exec("docker.exe", ["inspect", "--format", format, service.containerId], { windowsHide: true, maxBuffer: 1024 * 1024, timeout: 15000 });
    return JSON.parse(output.stdout);
  };
  const container = await containerSnapshot();
  assert(container.running); assert.equal(container.id, service.containerId); assert.equal(container.image, service.imageId);
  assert.equal(container.mounts.filter(row => row.Type === "volume").length, 1);
  assert(container.mounts.some(row => row.Type === "volume" && row.Name === service.volume && row.Destination === "/var/lib/postgresql/data" && row.RW));
  assert.deepEqual(container.ports, { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "11931" }] });
  const secrets = await json(join(nativeState, "secrets.json"));
  const contextFile = join(homedir(), ".local/share/agent-track/demian-context-native.json");
  const context = await json(contextFile);
  assert.equal(context.nativeAuthMode, "trusted"); assert.equal(context.nativeRole, "owner"); assert.equal(context.sourceId, "demian-local");
  assert(context.webOrigins.includes(domain.publicUrl) && Array.isArray(context.sessions) && context.sessions.length > 0);
  const loginFile = join(nativeState, "domain/domain-login.json");
  const login = await json(loginFile); assert(typeof login.username === "string" && typeof login.password === "string");
  for (const file of [contextFile, context.tokenFile, loginFile, join(homedir(), ".local/share/agent-track/track-product.config.json")]) {
    await assertRegularPublicFile(file);
    const expected = await digest(file); assert(expected !== null); expectedFiles.set(file, expected);
  }
  const existingGate = await requestPublicGate("/", { Authorization: "Basic " + Buffer.from(login.username + ":" + login.password).toString("base64") });
  assert.equal(existingGate.status, 200); await readWebVerificationResponse(existingGate, 2 * 1024 * 1024);
  const { Client } = createRequire(join(service.repository, "package.json"))("pg");
  const databaseState = async () => {
    const pg = new Client({ host: "127.0.0.1", port: service.databasePort, user: "demian", database: "demian", password: secrets.databasePassword,
      options: "-c default_transaction_read_only=on", connectionTimeoutMillis: 5000, statement_timeout: 10000, application_name: "agent-track-public-web-preservation" });
    try { await pg.connect(); return await nativeWebDatabaseState(pg); } finally { await pg.end(); }
  };
  const compareDatabase = current => {
    for (const key of ["dataSha256", "schemaSha256", "sequenceSha256"]) assert.equal(current.data[key], input.backup.currentData[key]);
    assert.equal(current.security.sha256, input.backup.currentSecurity.sha256);
  };
  compareDatabase(await databaseState());
  for (const [file, expected] of expectedFiles) assert.equal(await digest(file), expected);
  return { input, inputSha256: expectedSha256, service, domain, metadata, metadataBytes, metadataFile, startup, startupBytes,
    manifests, expectedFiles, context, contextFile, login, databaseState, compareDatabase, container, containerSnapshot };
}

/** Explicit execution only; all mutable file targets are fixed by the validated plan. */
export async function executePublicWeb(inputFile, expectedSha256) {
  const p = await preflightPublicWeb(inputFile, expectedSha256), { input } = p;
  const operationDir = join(input.contextRoot, "operations", input.operationId);
  await mkdir(join(input.contextRoot, "operations"), { recursive: true });
  assert(samePath(await realpath(join(input.contextRoot, "operations")), join(input.contextRoot, "operations")));
  await mkdir(operationDir); await mkdir(join(operationDir, "runtime"));
  await saveNew(join(operationDir, "purpose"), "agent-track-public-web-operation-v1\n");
  await saveNew(join(operationDir, "input.json"), await bytes(inputFile));
  await saveNew(join(operationDir, "startup.before"), p.startupBytes);
  await saveNew(join(operationDir, "metadata.before"), p.metadataBytes);
  for (const name of publicWebHelpers) {
    const data = await bytes(input.distribution[name].source); assert.equal(hash(data), input.distribution[name].targetSha256);
    await saveNew(join(operationDir, "runtime", name), data);
  }
  const journalFile = join(operationDir, "journal.jsonl");
  const journalHandle = await open(journalFile, "ax");
  try {
  let sequence = 0;
  const journal = async (stage, details) => {
    await journalHandle.writeFile(JSON.stringify({ sequence: ++sequence, at: new Date().toISOString(), stage, ...(details ? { details } : {}) }) + "\n");
    await journalHandle.sync();
  };
  const fallbackId = randomUUID();
  const expectedFiles = p.expectedFiles;
  for (const row of Object.values(input.distribution)) expectedFiles.set(row.target, row.beforeSha256);
  expectedFiles.set(input.activation.file, null);
  const lockFile = join(input.contextRoot, "public-web.lock.json");
  const mutableFiles = [input.startup.file, p.metadataFile, input.activation.file, lockFile, ...Object.values(input.distribution).map(row => row.target)];
  const keyFor = file => [...expectedFiles.keys()].find(key => samePath(key, file));
  const writer = join(operationDir, "runtime/write-exclusive.ps1");
  const write = async (file, data) => {
    assert(mutableFiles.some(path => samePath(path, file)), "Unowned file target rejected");
    const key = keyFor(file); assert(key !== undefined, "Unpinned file target rejected");
    await assertRegularPublicFile(file, true);
    const before = expectedFiles.get(key), after = hash(data);
    if (before === after) { assert.equal(await digest(file), after); return; }
    assert.equal(await digest(writer), input.distribution["write-exclusive.ps1"].targetSha256);
    const payload = join(operationDir, "payload-" + randomUUID()); await saveNew(payload, data);
    await journal("write-intent", { file, beforeSha256: before, afterSha256: after, payload });
    const args = ["-NoProfile", "-NonInteractive", "-File", writer, "-Target", file, "-Payload", payload,
      ...(before === null ? ["-ExpectedMissing"] : ["-ExpectedSha256", before])];
    try { const result = JSON.parse((await exec("powershell.exe", args, { windowsHide: true, maxBuffer: 1024 * 1024 })).stdout); assert(result.updated && result.sha256 === after); }
    catch { if (await digest(file) !== after) throw safeError(); }
    assert.equal(await digest(file), after); expectedFiles.set(key, after);
    await journal("write-confirmed", { file, sha256: after });
  };
  let lockHash = await digest(lockFile);
  if (lockHash !== null) {
    const prior = await json(lockFile);
    assert(prior.purpose === "agent-track-public-web-lock-v1" && prior.state === "completed", "Existing operation lock preserved");
  }
  expectedFiles.set(lockFile, lockHash);
  const owner = await inspectApiProcess(process.pid); assert(owner);
  const lock = { purpose: "agent-track-public-web-lock-v1", operationId: input.operationId, inputSha256: expectedSha256, owner, state: "running" };
  await write(lockFile, Buffer.from(JSON.stringify(lock) + "\n")); lockHash = expectedFiles.get(lockFile);
  await journal("begin", { operationId: input.operationId, fallbackId, inputSha256: expectedSha256 });
  let replacement, fallback, verification, preservationUnverified = false;
  const containerPreserved = async () => {
    try { assert.deepEqual(await p.containerSnapshot(), p.container); }
    catch { preservationUnverified = true; throw safeError(); }
  };
  const matchesOriginal = record => isDeepStrictEqual(record, input.roles.web.identity);
  const inspect = record => inspectOwnedWeb(record, 3001, matchesOriginal(record) ? replacement : input.roles.web.identity);
  const backendStable = async () => {
    for (const [name, role] of Object.entries(input.roles)) if (name !== "web") {
      assert.deepEqual(await inspectApiProcess(role.identity.pid), role.identity);
      if (name !== "tunnel") assert.deepEqual(await apiListeners(role.port), [{ address: "127.0.0.1", port: role.port, pid: role.identity.pid }]);
    }
    for (const [file, expected] of expectedFiles) if (!mutableFiles.some(path => samePath(path, file))) assert.equal(await digest(file), expected);
  };
  const checkPreserved = async () => {
    await containerPreserved();
    await backendStable();
    for (const [file, expected] of expectedFiles) assert.equal(await digest(file), expected);
    p.compareDatabase(await p.databaseState());
  };
  const find = async (release, operationId) => {
    for (const state of ["ready", "starting"]) {
      const file = webLaunchRecordPath(input.contextRoot, "public", operationId, state);
      if (await digest(file) === null) continue;
      const record = await json(file);
      assert(record.operationId === operationId && record.profile === "public" && record.port === 3001 && record.state === state &&
        samePath(record.releaseDir, release.releaseDir) && record.manifestSha256 === release.manifestSha256 && record.buildId === release.webBuildId);
      const identity = record.identity ?? await inspectApiProcess(record.pid);
      if (!identity) return undefined;
      assert(matchesWebLaunch(identity, record.pid, process.execPath, join(release.releaseDir, "apps/web/server.js"), operationId));
      if ((await inspectOwnedWeb(identity, 3001)).state !== "owned-live") return undefined;
      return { ...identity, launch: record };
    }
    return undefined;
  };
  const start = async (release, operationId) => {
    await publicWebLaunchPrerequisites(release === input.candidate ? "candidate" : "rollback", { ownership: backendStable, preservation: containerPreserved });
    for (const name of publicWebHelpers) assert.equal(await digest(join(operationDir, "runtime", name)), input.distribution[name].targetSha256);
    try { await exec(process.execPath, [join(operationDir, "runtime/run-web.mjs"), "--profile", "public", "--release", release.releaseDir, "--operation-id", operationId], { windowsHide: true, maxBuffer: 2 * 1024 * 1024 }); }
    catch { /* Reconcile the same operation; never launch a second child. */ }
    const record = await find(release, operationId); assert(record, "Owned launch receipt unavailable");
    if (release === input.candidate) replacement = record; else fallback = record;
    assert.equal(record.launch.state, "ready", "Unready child retained for guarded recovery");
    return record;
  };
  const activation = release => Buffer.from(JSON.stringify({ version: 1, profile: "public", enabled: true, operationId: input.operationId,
    releaseDir: release.releaseDir, contextFile: p.contextFile, manifestSha256: release.manifestSha256 }, null, 2) + "\n");
  const commitMetadata = async record => {
    const next = structuredClone(p.metadata);
    if (!matchesOriginal(record)) {
      assert(record.launch && record.launch.profile === "public" && record.launch.port === 3001);
      const index = next.children.findIndex(row => row.name === "public-web");
      next.children[index] = { ...next.children[index], pid: record.pid, startedAt: record.launch.startedAt, entry: record.launch.entry,
        cwd: dirname(record.launch.entry), releaseDir: record.launch.releaseDir, buildId: record.launch.buildId, manifestSha256: record.launch.manifestSha256, identity: { ...record, launch: undefined } };
      next.trackContextWeb = { operationId: input.operationId, pid: record.pid, buildId: record.launch.buildId, releaseDir: record.launch.releaseDir };
    }
    await write(p.metadataFile, Buffer.from(JSON.stringify(next, null, 2) + "\n"));
  };
  const verifyCandidate = async record => {
    assert.equal(record.launch?.state, "ready"); await backendStable();
    const basic = "Basic " + Buffer.from(p.login.username + ":" + p.login.password).toString("base64");
    const headers = { Host: "demian.pydemia.ai", Authorization: basic };
    const root = await requestPublicGate("/", headers);
    assert.equal(root.status, 200); const html = (await readWebVerificationResponse(root, 2 * 1024 * 1024)).toString("utf8"); assert(html.includes("/_next/static/"));
    const manifest = p.manifests.get(input.candidate.releaseDir);
    const asset = Object.keys(manifest.payloadFiles).find(name => name.startsWith("apps/web/.next/static/") && name.endsWith(".js")); assert(asset);
    const response = await requestPublicGate("/_next/" + encodeURI(asset.slice("apps/web/.next/".length)), headers);
    assert.equal(response.status, 200); assert.equal(hash(await readWebVerificationResponse(response, 4 * 1024 * 1024)), manifest.payloadFiles[asset]);
    const session = p.context.sessions.find(row => row.sessionId === "6e26fd8b-76ff-43ec-8b55-1c42fd86da94") ?? p.context.sessions[0];
    const contextHeaders = { ...headers, Origin: p.domain.publicUrl, "X-Track-Expected-Actor": p.context.nativeActorId, "X-Demian-Organization-Id": p.context.nativeOrganizationId };
    const context = await requestPublicGate("/track-context/sessions/" + session.sessionId, contextHeaders);
    const body = JSON.parse((await readWebVerificationResponse(context, 1024 * 1024)).toString("utf8")); assert.equal(context.status, 200); assert.equal(body.state, "connected"); assert.equal(body.summary?.context.sessionId, session.sessionId);
    assert(body.summary.counts.runs > 0 && body.summary.trackUrl);
    const denied = await requestPublicGate("/track-context/sessions/" + session.sessionId, { ...contextHeaders, "X-Track-Expected-Actor": "00000000-0000-4000-8000-000000000099" });
    assert.equal(denied.status, 403); await denied.body?.cancel();
    await verifyFrozenRelease(input.candidate.releaseDir, manifest);
    verification = { rootStatus: root.status, assetBytesMatched: true, contextStatus: context.status, contextState: body.state, sessionId: session.sessionId,
      runs: body.summary.counts.runs, sessions: body.summary.counts.sessions, wrongActorDenied: denied.status, existingGatePreserved: true };
  };
  let result;
    result = await executePublicWebTransition({ original: input.roles.web.identity,
      prepare: async () => {
        for (const name of publicWebHelpers) await write(input.distribution[name].target, await bytes(join(operationDir, "runtime", name)));
        await write(input.startup.file, p.startup);
      }, checkPreserved, inspect,
      journal: (stage, record) => journal(stage, record), stop: record => stopOwnedWeb(record, 3001),
      startCandidate: () => start(input.candidate, input.operationId),
      findCandidate: async () => { replacement = await find(input.candidate, input.operationId); return replacement; },
      verifyCandidate,
      commitCandidate: async record => { await write(input.activation.file, activation(input.candidate)); await commitMetadata(record); },
      recover: async record => {
        replacement = record ?? replacement ?? await find(input.candidate, input.operationId).catch(() => undefined);
        return recoverPublicWeb({ original: input.roles.web.identity, replacement, inspect,
          journalIntent: row => journal("recovery-stop-intent", row), stop: row => stopOwnedWeb(row, 3001),
          activateFallback: () => write(input.activation.file, activation(input.rollback)),
          startFrozenFallback: () => start(input.rollback, fallbackId), commitPublic: commitMetadata });
      }, report: value => saveNew(join(operationDir, "result.json"), JSON.stringify({ ...value, verification, preservationUnverified }, null, 2) + "\n") });
    const safe = result.committed || result.recovery && !result.recovery.recoveryFailed && !result.recovery.activationFailed && !result.recovery.metadataUpdateFailed;
    await write(lockFile, Buffer.from(JSON.stringify({ ...lock, state: safe || !result.stopAttempted ? "completed" : "needs_attention", committed: result.committed }) + "\n")).catch(() => { result.reportFailed = true; });
    return { operationId: input.operationId, operationDir, ...result, verification, preservationUnverified };
  } finally { await journalHandle.close(); }
}

async function main() {
  const args = process.argv.slice(2);
  const modes = ["--preflight", "--execute"].filter(flag => args.includes(flag)); assert.equal(modes.length, 1);
  const input = args[args.indexOf("--input") + 1], expected = args[args.indexOf("--input-sha256") + 1];
  assert(args.includes("--input") && args.includes("--input-sha256") && input && expected);
  if (modes[0] === "--preflight") {
    const p = await preflightPublicWeb(resolve(input), expected);
    console.log(JSON.stringify({ preflightReady: true, operationId: p.input.operationId, profile: "public", port: 3001,
      candidate: p.input.candidate.webBuildId, rollback: p.input.rollback.webBuildId, servicesPreserved: true, databaseMatchesBackup: true, writes: 0 }));
  } else {
    const result = await executePublicWeb(resolve(input), expected);
    console.log(JSON.stringify({ operationId: result.operationId, committed: result.committed, stage: result.stage, recovery: result.recovery ? {
      recovered: !!result.recovery.recoveredIdentity, activationFailed: result.recovery.activationFailed, recoveryFailed: result.recovery.recoveryFailed, metadataUpdateFailed: result.recovery.metadataUpdateFailed } : null,
      reportingFailed: result.reportFailed || result.journalFailed, preservationUnverified: result.preservationUnverified, verification: result.verification }));
    if (!result.committed || result.reportFailed || result.journalFailed) process.exitCode = 1;
  }
}
if (process.argv[1] && samePath(process.argv[1], fileURLToPath(import.meta.url))) {
  main().catch(() => { console.error(JSON.stringify({ committed: false, message: "Public web operation refused; inspect the owned operation journal if execution began" })); process.exitCode = 1; });
}
