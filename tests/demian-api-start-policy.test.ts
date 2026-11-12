import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { apiStartupDisposition, apiStartupEnvironment, apiStartupHash, hashStartupFile, loadApiStartup, matchesApiProcess, readStartupFile, validateApiStartupConfig, verifyApiDatabase,
  type ApiStartupConfig } from "../deploy/demian/api-start-policy.mjs";

const names = ["Start-Api.ps1", "start-api.mjs", "api-start-policy.mjs", "windows-api-process.mjs", "owned-child.mjs", "write-api-record.ps1"];
const at = "2026-11-12T07:44:46.0665280Z";
async function fixture(t: test.TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "demian-api-startup-")));
  t.after(async () => { assert.equal(dirname(resolve(root)), await realpath(tmpdir())); assert(basename(root).startsWith("demian-api-startup-")); await rm(root, { recursive: true, force: true }); });
  const release = join(root, "demian-api-releases", "qa"), operator = join(root, "demian-api-operators", "qa"), state = join(root, "service");
  await Promise.all([mkdir(release, { recursive: true }), mkdir(operator, { recursive: true }), mkdir(state)]);
  const entry = join(release, "main.mjs"); await writeFile(entry, "// Frozen synthetic entry; never executed\n");
  const service = JSON.stringify({ apiUrl: "http://127.0.0.1:8080", databasePort: 11931, repository: root, webUrl: "http://127.0.0.1:3000",
    containerId: "a".repeat(64), imageId: "sha256:" + "b".repeat(64), volume: "fixture-volume" });
  const secrets = JSON.stringify({ apiToken: "fixture-private-token-123456", databasePassword: "fixture-password" });
  await writeFile(join(state, "service.json"), service); await writeFile(join(state, "secrets.json"), secrets);
  const operatorFiles: Record<string, string> = {};
  for (const name of names) { const text = `// synthetic ${name}\n`; await writeFile(join(operator, name), text); operatorFiles[name] = apiStartupHash(text); }
  const plan: ApiStartupConfig = { version: 1, ownerSid: "S-1-5-21-1-2-3-1001", executable: process.execPath,
    executableSha256: await hashStartupFile(process.execPath, 128 * 1024 * 1024), entry,
    bundleSha256: apiStartupHash("// Frozen synthetic entry; never executed\n"), repository: root, serviceState: state,
    profilePins: { "service.json": apiStartupHash(service), "secrets.json": apiStartupHash(secrets) }, operatorDirectory: operator, operatorFiles };
  const save = () => writeFile(join(root, "demian-api-startup.json"), JSON.stringify(plan)); await save();
  const record = { state: "active", entry, bundleSha256: plan.bundleSha256, process: { pid: 1 } };
  await writeFile(join(root, "demian-api-active.json"), JSON.stringify(record));
  return { root, plan, record, save };
}

test("API startup accepts only pinned executable, bundle, operator and original private profile", async t => {
  const f = await fixture(t), loaded = await loadApiStartup(f.root);
  assert.equal(loaded.plan.entry, f.plan.entry); assert.equal(loaded.activeSha256, apiStartupHash(JSON.stringify(f.record)));
  assert.equal(loaded.plan.version, 1);
  await writeFile(f.plan.entry, "// changed\n"); await assert.rejects(loadApiStartup(f.root), { message: "Demian API startup profile could not be verified" });
});

test("API startup refuses changed operator, service profile, credential bytes and source pointer", async t => {
  for (const change of ["operator", "service", "credential", "pointer"] as const) {
    const f = await fixture(t);
    if (change === "operator") await writeFile(join(f.plan.operatorDirectory, "start-api.mjs"), "PRIVATE_BAD_ENTRY");
    if (change === "service") await writeFile(join(f.plan.serviceState, "service.json"), "PRIVATE_CHANGED_PROFILE");
    if (change === "credential") await writeFile(join(f.plan.serviceState, "secrets.json"), "PRIVATE_ROTATED");
    if (change === "pointer") await writeFile(join(f.root, "demian-api-active.json"), JSON.stringify({ ...f.record, entry: join(f.root, "foreign.mjs") }));
    await assert.rejects(loadApiStartup(f.root), error => { assert(error instanceof Error); assert.equal(error.message, "Demian API startup profile could not be verified"); assert.doesNotMatch(error.message, /PRIVATE_/); return true; });
  }
});

test("API startup rejects unknown fields, missing pins, foreign release paths and oversized metadata", async t => {
  const f = await fixture(t);
  for (const patch of [{ workerEnabled: true }, { ownerSid: "foreign" }, { profilePins: {} }, { operatorFiles: {} }, { entry: "relative/main.mjs" }, { executableSha256: "bad" }]) {
    assert.throws(() => validateApiStartupConfig({ ...f.plan, ...patch }), { message: "Demian API startup profile could not be verified" });
  }
  f.plan.entry = join(f.root, "main.mjs"); await writeFile(f.plan.entry, "// outside frozen root\n"); await f.save();
  await assert.rejects(loadApiStartup(f.root));
  const file = join(f.root, "oversized"); await writeFile(file, "x".repeat(101));
  await assert.rejects(readStartupFile(file, 100)); await assert.rejects(hashStartupFile(file, 100));
});

test("API process ownership requires exact PID, creation, executable and single pinned entry", () => {
  const plan = { executable: process.execPath, entry: resolve("frozen/main.mjs") };
  const record = { pid: 123, name: "node.exe", executable: plan.executable, created: at, command: `"${plan.executable}" ${plan.entry}` };
  assert(matchesApiProcess(record, { ...record }, plan));
  for (const patch of [{ pid: 456 }, { created: "2026-11-12T07:44:47.0665280Z" }, { executable: resolve("foreign/node.exe") },
    { command: record.command + " --worker" }, { command: `"${plan.executable}" "${plan.entry}" --eval arbitrary` }, { name: "unrelated.exe" }]) {
    assert.equal(matchesApiProcess(record, { ...record, ...patch }, plan), false);
  }
  assert.equal(matchesApiProcess(record, null, plan), false);
  assert.equal(matchesApiProcess({ ...record, created: "2026-11-12T07:44:46.066Z" }, record, plan), false);
  const simple = { executable: resolve("tools/node.exe"), entry: resolve("plain/main.mjs") };
  const plain = { ...record, executable: simple.executable, command: `${simple.executable} ${simple.entry}` };
  if (!/\s/.test(simple.executable + simple.entry)) assert(matchesApiProcess(plain, plain, simple));
  const spaced = { ...simple, entry: resolve("entry with spaces/main.mjs") };
  const broken = { ...plain, command: `${simple.executable} ${spaced.entry}` };
  assert.equal(matchesApiProcess(broken, broken, spaced), false);
});

test("child profile preserves isolated home and owner auth without inherited optional runtime or global env writes", async t => {
  const f = await fixture(t), ambient = { PATH: "fixture-path", HOME: "original-home", USERPROFILE: "original-profile", NODE_OPTIONS: "--require private",
    DEMIAN_WORK_RUNTIME_CONFIG_FILE: "private-runtime", DEMIAN_ASSISTANT_PEER_CONFIG_FILE: "private-peer", PORT: "9999" };
  const before = structuredClone(ambient), env = apiStartupEnvironment(f.plan, { apiToken: "fixture-private-token", databasePassword: "pass:@/#" }, ambient);
  assert.deepEqual(ambient, before); assert.equal(env.HOME, join(f.plan.serviceState, "runtime-home")); assert.equal(env.USERPROFILE, env.HOME);
  assert.equal(env.PORT, "8080"); assert.equal(env.HOST, "127.0.0.1"); assert.equal(env.DEMIAN_AUTH_MODE, "trusted");
  assert.equal(env.NODE_OPTIONS, undefined); assert.equal(env.DEMIAN_WORK_RUNTIME_CONFIG_FILE, undefined); assert.equal(env.DEMIAN_ASSISTANT_PEER_CONFIG_FILE, undefined);
  assert.match(env.DATABASE_URL!, /pass%3A%40%2F%23@127\.0\.0\.1:11931\/demian$/);
  assert.throws(() => apiStartupEnvironment(f.plan, { apiToken: "short", databasePassword: "x" }));
});

test("startup adopts only its exact loopback listener and never replaces an unknown or starting process", () => {
  const plan = { executable: process.execPath, entry: resolve("frozen/main.mjs") };
  const record = { pid: 123, name: "node.exe", executable: plan.executable, created: at, command: `"${plan.executable}" ${plan.entry}` };
  assert.equal(apiStartupDisposition(record, record, [{ pid: 123, address: "127.0.0.1" }], plan), "adopt");
  assert.equal(apiStartupDisposition(record, null, [], plan), "start");
  assert.equal(apiStartupDisposition(record, { ...record, created: "2026-11-12T09:00:00.0000000Z" }, [], plan), "start");
  for (const [actual, rows] of [[record, []], [null, [{ pid: 456, address: "127.0.0.1" }]],
    [record, [{ pid: 123, address: "0.0.0.0" }]], [record, [{ pid: 123, address: "::" }]],
    [record, [{ pid: 123, address: "127.0.0.1" }, { pid: 456, address: "127.0.0.1" }]]] as const) {
    assert.throws(() => apiStartupDisposition(record, actual, [...rows], plan));
  }
});

test("API startup accepts only the original database container, image, volume and loopback publication", () => {
  const service = { containerId: "a".repeat(64), imageId: "sha256:" + "b".repeat(64), volume: "fixture-volume" };
  const observed = { id: service.containerId, image: service.imageId, running: true,
    mounts: [{ Type: "volume", Name: service.volume, Destination: "/var/lib/postgresql/data" }],
    ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "11931" }] } };
  assert.equal(verifyApiDatabase(service, observed), true); assert.equal(verifyApiDatabase(service, { ...observed, running: false, ports: {} }), false);
  for (const patch of [{ id: "c".repeat(64) }, { image: "foreign" }, { mounts: [] },
    { ports: { "5432/tcp": [{ HostIp: "0.0.0.0", HostPort: "11931" }] } }, { ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "5432" }] } }]) {
    assert.throws(() => verifyApiDatabase(service, { ...observed, ...patch }), { message: "Demian API startup profile could not be verified" });
  }
});
