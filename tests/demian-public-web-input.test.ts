import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, realpath, link, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { assertRegularPublicFile, publicWebHelpers, validatePublicWebInput, type PublicWebInput } from "../deploy/demian/public-web-input.mjs";
import { readWebVerificationResponse } from "../deploy/demian/promote-public-web.mjs";

const home = resolve("fixture-native-home"), state = join(home, ".demian/service"), repository = join(home, "track");
const root = join(state, "track-context"), h = "a".repeat(64);
function fixture(): PublicWebInput {
  const role = (pid: number, port?: number) => ({ identity: { pid, name: "node.exe", executable: process.execPath, created: "2026-01-01T00:00:00.0000000Z", command: "fixture" }, ...(port === undefined ? {} : { port }) });
  return { version: 1, capturedAt: "2026-01-01T00:00:00Z", operationId: "11111111-1111-4111-8111-111111111111", executionImplemented: false,
    scope: { profiles: ["public"], port: 3001, neverOperatePorts: [3000, 8080, 3100, 14345] }, serviceState: state, contextRoot: root,
    roles: { web: role(1, 3001), api: role(2, 8080), gate: role(3, 3100), track: role(4, 14345), tunnel: role(5) },
    protectedFiles: Object.fromEntries(["service.json", "secrets.json", "worker.json", "worker-process.json", "start.mjs", "start.ps1", "start-worker.mjs", "start-domain.mjs", "domain/config.json", "domain/processes.json"].map(file => [join(state, file), h])),
    distribution: Object.fromEntries(publicWebHelpers.map(name => [name, { source: join(repository, "deploy/demian", name), target: join(root, name), beforeSha256: null, targetSha256: h }])),
    startup: { file: join(state, "start-domain.mjs"), beforeSha256: h, afterSha256: h }, activation: { file: join(root, "active-public.json"), expectedMissing: true },
    candidate: { releaseDir: join(root, "releases/candidate"), manifestSha256: h, webBuildId: "candidate" },
    rollback: { releaseDir: join(root, "releases/rollback"), manifestSha256: h, webBuildId: "rollback" },
    backup: { resultFile: join(repository, ".runtime/source-availability/demian-web-cutover-backup-result.json"), resultSha256: h,
      cipherFile: join(home, ".local/share/agent-track/backups/demian-preservation-fixture/database.atpg1.aes256gcm"), cipherSha256: h,
      currentData: { dataSha256: h, schemaSha256: h, sequenceSha256: h }, currentSecurity: { sha256: h } } };
}

test("public plan fixes scope, roles, helper destinations, startup and backup boundaries", () => {
  const input = fixture(); assert.equal(validatePublicWebInput(input, { serviceState: state, repository }), input);
  const mutations: Array<(p: PublicWebInput) => void> = [
    p => { p.scope.port = 3000 as 3001; }, p => { p.scope.profiles.push("local" as "public"); },
    p => { p.scope.neverOperatePorts = []; }, p => { p.operationId += "\n"; },
    p => { p.roles.web.identity.pid = p.roles.api.identity.pid; }, p => { p.roles.gate.port = 3000; },
    p => { p.serviceState = home; }, p => { p.contextRoot = home; },
    p => { p.distribution["run-web.mjs"]!.target = join(state, "service.json"); },
    p => { p.distribution["run-web.mjs"]!.source = join(home, "untrusted.mjs"); },
    p => { p.distribution["unexpected.mjs"] = { ...p.distribution["run-web.mjs"]! }; },
    p => { delete p.protectedFiles[join(state, "worker.json")]; },
    p => { p.startup.file = join(state, "start.mjs"); }, p => { p.activation.file = join(root, "active.json"); },
    p => { p.candidate.releaseDir = join(root, "releases/../foreign"); },
    p => { p.rollback.releaseDir = p.candidate.releaseDir; },
    p => { p.backup.resultFile = join(state, "secrets.json"); },
    p => { p.backup.cipherFile = join(home, "foreign/database.atpg1.aes256gcm"); },
    p => { p.backup.currentSecurity.sha256 = "bad"; },
  ];
  for (const mutate of mutations) { const changed = fixture(); mutate(changed); assert.throws(() => validatePublicWebInput(changed, { serviceState: state, repository })); }
});

test("regular target checks reject hard links and redirected parent directories without touching either project", async () => {
  // Runner TEMP may itself use a redirected or short Windows path. The normal
  // fixture must be canonical; only the explicit redirect below is untrusted.
  const tempRoot = await realpath(tmpdir());
  const temp = await realpath(await mkdtemp(join(tempRoot, "demian-public-input-")));
  try {
    const own = join(temp, "own"), foreign = join(temp, "foreign"); await mkdir(own); await mkdir(foreign);
    const file = join(own, "target.json"), other = join(foreign, "target.json"); await writeFile(file, "own"); await writeFile(other, "foreign");
    await assertRegularPublicFile(file); await assertRegularPublicFile(join(own, "missing.json"), true);
    await assert.rejects(assertRegularPublicFile(join(own, "missing.json")));
    await link(file, join(own, "hardlink.json")); await assert.rejects(assertRegularPublicFile(file));
    const redirect = join(own, "redirect"); await symlink(foreign, redirect, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(assertRegularPublicFile(join(redirect, "target.json")));
    await assert.rejects(assertRegularPublicFile(join(redirect, "missing.json"), true));
    assert.equal(await readFile(file, "utf8"), "own"); assert.equal(await readFile(other, "utf8"), "foreign");
  } finally { assert.equal(dirname(temp), tempRoot); assert(basename(temp).startsWith("demian-public-input-")); await rm(temp, { recursive: true, force: true }); }
});

test("verification HTTP reads cap bodies and cancel an overflowing response without echoing its contents", async () => {
  assert.equal((await readWebVerificationResponse(new Response("abc"), 3)).toString(), "abc");
  assert.equal((await readWebVerificationResponse(new Response(null), 3)).length, 0);
  let cancelled = false;
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("PRIVATE_FIXTURE_BODY")); }, cancel() { cancelled = true; } }));
  await assert.rejects(readWebVerificationResponse(response, 2), { message: "Public web operation could not be verified" });
  assert.equal(cancelled, true);
});
