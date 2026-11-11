import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import test from "node:test";
import { loadWebRelease, verifyFrozenRelease, type FrozenWebManifest } from "../deploy/demian/web-release-policy.mjs";

const hash = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
async function fixture() {
  const state = resolve(await mkdtemp(join(tmpdir(), "demian-release-policy-")));
  const release = join(state, "track-context/releases/qa");
  await mkdir(join(release, "apps/web/.next"), { recursive: true });
  await writeFile(join(release, "apps/web/server.js"), "// Frozen fixture entry\n");
  await writeFile(join(release, "apps/web/.next/BUILD_ID"), "qa-build\n");
  const manifest: FrozenWebManifest = { version: 1, webBuildId: "qa-build", payloadFiles: { "apps/web/server.js": hash("// Frozen fixture entry\n"), "apps/web/.next/BUILD_ID": hash("qa-build\n") } };
  const data = JSON.stringify(manifest);
  await writeFile(join(release, "release.json"), data);
  await writeFile(join(state, "track-context/active.json"), JSON.stringify({ version: 1, enabled: true, releaseDir: release, contextFile: join(state, "private-config.json"), manifestSha256: hash(data) }));
  return { state, release, manifest, cleanup: async () => {
    assert.ok(state.startsWith(resolve(tmpdir()) + sep) && state.split(sep).at(-1)?.startsWith("demian-release-policy-"));
    await rm(state, { recursive: true, force: true });
  } };
}

test("native startup accepts an exact frozen file set and pinned build", async () => {
  const f = await fixture();
  try {
    await verifyFrozenRelease(f.release, f.manifest);
    const release = await loadWebRelease(f.state);
    assert.equal(release?.entry, join(await realpath(f.release), "apps/web/server.js"));
    assert.equal(release?.buildId, "qa-build");
  } finally { await f.cleanup(); }
});

test("Windows frozen release accepts a different drive-letter case for the same files", { skip: process.platform !== "win32" }, async () => {
  const f = await fixture();
  try {
    assert.match(f.release, /^[A-Za-z]:\\/);
    const canonical = await realpath(f.release);
    const drive = canonical[0] === canonical[0]!.toUpperCase() ? canonical[0]!.toLowerCase() : canonical[0]!.toUpperCase();
    const alias = drive + canonical.slice(1);
    assert.notEqual(alias, canonical);
    await verifyFrozenRelease(alias, f.manifest);
  } finally { await f.cleanup(); }
});

test("unmanifested public files and edited frozen modules are rejected", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.release, "apps/web/extra.js"), "// unexpected\n");
    await assert.rejects(verifyFrozenRelease(f.release, f.manifest), /file set mismatch/);
    await rm(join(f.release, "apps/web/extra.js"));
    await writeFile(join(f.release, "apps/web/server.js"), "// altered\n");
    await assert.rejects(verifyFrozenRelease(f.release, f.manifest), /file mismatch/);
  } finally { await f.cleanup(); }
});

test("release directory links and foreign manifest paths are rejected", async () => {
  const f = await fixture();
  try {
    const ownedTarget = join(f.state, "owned-link-target");
    await mkdir(ownedTarget);
    await symlink(ownedTarget, join(f.release, "foreign"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(verifyFrozenRelease(f.release, f.manifest), /release link/);
    await rm(join(f.release, "foreign"));
    await assert.rejects(verifyFrozenRelease(f.release, { ...f.manifest, payloadFiles: { ...f.manifest.payloadFiles, "../outside.js": hash("foreign") } }), /file set mismatch/);
  } finally { await f.cleanup(); }
});

test("missing opt-in retains the original native web without side effects", async () => {
  const f = await fixture();
  try {
    await rm(join(f.state, "track-context/active.json"));
    assert.equal(await loadWebRelease(f.state), null);
    assert.equal(await readFile(join(f.release, "apps/web/server.js"), "utf8"), "// Frozen fixture entry\n");
  } finally { await f.cleanup(); }
});
