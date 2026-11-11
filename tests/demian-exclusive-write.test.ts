import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
async function fixture() {
  const directory = resolve(await mkdtemp(join(tmpdir(), "demian-exclusive-metadata-")));
  const target = join(directory, "target.json"), payload = join(directory, "payload.json");
  await writeFile(target, "before"); await writeFile(payload, "after");
  const write = (hash = digest("before")) => exec("powershell.exe", ["-NoProfile", "-File", resolve("deploy/demian/write-exclusive.ps1"), "-Target", target, "-Payload", payload, "-ExpectedSha256", hash], { windowsHide: true });
  return { directory, target, payload, write, cleanup: async () => {
    assert.ok(directory.startsWith(resolve(tmpdir()) + sep) && directory.split(sep).at(-1)?.startsWith("demian-exclusive-metadata-"));
    await rm(directory, { recursive: true, force: true });
  } };
}

test("Windows native metadata comparison and update reject stale ownership", { skip: process.platform !== "win32" }, async () => {
  const f = await fixture();
  try {
    const first = JSON.parse((await f.write()).stdout); assert.equal(first.updated, true); assert.equal(first.sha256, digest("after"));
    await assert.rejects(f.write()); assert.equal(await readFile(f.target, "utf8"), "after");
  } finally { await f.cleanup(); }
});

test("Windows exclusive sharing prevents a concurrent metadata writer", { skip: process.platform !== "win32" }, async () => {
  const f = await fixture();
  const holder = spawn("powershell.exe", ["-NoProfile", "-File", resolve("tests/fixtures/hold-native-metadata.ps1"), "-Target", f.target], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { const [chunk] = await Promise.race([once(holder.stdout, "data"), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Fixture lock failed readiness")), 5000); })]); assert.match(String(chunk), /locked/); }
    finally { if (timer) clearTimeout(timer); }
    await assert.rejects(f.write());
  } finally {
    if (holder.exitCode === null && holder.signalCode === null) { const ended = once(holder, "exit"); holder.stdin.end("release\n"); await ended; }
    assert.equal(await readFile(f.target, "utf8"), "before");
    await f.cleanup();
  }
});

test("Windows failed mutation restores the original bytes under the same exclusive handle", { skip: process.platform !== "win32" }, async () => {
  const f = await fixture();
  try {
    await writeFile(f.payload, "replacement metadata that extends the original file");
    await assert.rejects(exec("powershell.exe", ["-NoProfile", "-File", resolve("deploy/demian/write-exclusive.ps1"), "-Target", f.target, "-Payload", f.payload, "-ExpectedSha256", digest("before"), "-TestFailAfterWrite"], { windowsHide: true, env: { ...process.env, AGENT_TRACK_METADATA_TEST: "1" } }), error => {
      const failure = JSON.parse((error as { stdout: string }).stdout);
      return failure.updated === false && failure.targetMutated === true && failure.restored === true && failure.restorationFailed === false;
    });
    assert.equal(await readFile(f.target, "utf8"), "before");
  } finally { await f.cleanup(); }
});

test("Windows failed create-only publication keeps the target absent", { skip: process.platform !== "win32" }, async () => {
  const f = await fixture();
  try {
    await rm(f.target);
    await assert.rejects(exec("powershell.exe", ["-NoProfile", "-File", resolve("deploy/demian/write-exclusive.ps1"), "-Target", f.target, "-Payload", f.payload, "-ExpectedMissing", "-TestFailAfterWrite"], { windowsHide: true, env: { ...process.env, AGENT_TRACK_METADATA_TEST: "1" } }));
    await assert.rejects(readFile(f.target), error => typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT");
  } finally { await f.cleanup(); }
});

test("Windows create-only publication preserves an independently existing target", { skip: process.platform !== "win32" }, async () => {
  const f = await fixture();
  try {
    await assert.rejects(exec("powershell.exe", ["-NoProfile", "-File", resolve("deploy/demian/write-exclusive.ps1"), "-Target", f.target, "-Payload", f.payload, "-ExpectedMissing"], { windowsHide: true }));
    assert.equal(await readFile(f.target, "utf8"), "before");
  } finally { await f.cleanup(); }
});
