import { createHash } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const sha = data => createHash("sha256").update(data).digest("hex");
const within = (parent, child) => {
  const rel = relative(parent, child);
  return !!rel && !rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel);
};

/** A frozen release is an exact file set, not just a list of checked files. */
export async function verifyFrozenRelease(release, manifest) {
  if (manifest.version !== 1 || typeof manifest.webBuildId !== "string" || !manifest.payloadFiles || Object.keys(manifest.payloadFiles).length > 10000) throw new Error("Invalid release manifest");
  const actual = [];
  const walk = async directory => {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (item.isSymbolicLink()) throw new Error("Unexpected release link");
      const file = join(directory, item.name);
      if (item.isDirectory()) await walk(file);
      else if (item.isFile()) {
        const name = relative(release, file).split(sep).join("/");
        if (name !== "release.json") actual.push(name);
        if (actual.length > 10000) throw new Error("Release file limit");
      } else throw new Error("Unexpected release entry");
    }
  };
  await walk(release);
  const expected = Object.keys(manifest.payloadFiles).sort();
  if (JSON.stringify(actual.sort()) !== JSON.stringify(expected)) throw new Error("Release file set mismatch");
  for (const name of expected) {
    const file = resolve(release, name);
    // path.relative follows the host filesystem's drive-letter casing rules;
    // a junction/symlink resolving to another path still fails this comparison.
    if (!within(release, file) || relative(file, await realpath(file)) !== "" || sha(await readFile(file)) !== manifest.payloadFiles[name]) throw new Error("Release file mismatch");
  }
  if (!manifest.payloadFiles["apps/web/server.js"] || !manifest.payloadFiles["apps/web/.next/BUILD_ID"]) throw new Error("Missing native entry");
  if ((await readFile(join(release, "apps/web/.next/BUILD_ID"), "utf8")).trim() !== manifest.webBuildId) throw new Error("Build ID mismatch");
}

/** Optional startup override; failure retains the original native web. */
export async function loadWebRelease(serviceState) {
  try {
    const root = join(serviceState, "track-context");
    let active;
    try { active = JSON.parse(await readFile(join(root, "active.json"), "utf8")); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
    if (active.version !== 1 || active.enabled !== true) return null;
    if (!isAbsolute(active.releaseDir) || !isAbsolute(active.contextFile)) throw new Error("Invalid active release");
    const releases = await realpath(join(root, "releases"));
    const release = await realpath(active.releaseDir);
    if (!within(releases, release)) throw new Error("Release outside private root");
    const data = await readFile(join(release, "release.json"));
    if (data.length > 2 * 1024 * 1024 || sha(data) !== active.manifestSha256) throw new Error("Invalid release manifest");
    const manifest = JSON.parse(data.toString("utf8"));
    await verifyFrozenRelease(release, manifest);
    const entry = join(release, "apps/web/server.js");
    return { entry, cwd: join(release, "apps/web"), contextFile: active.contextFile, buildId: manifest.webBuildId };
  } catch {
    console.error("Optional Track context web unavailable; starting the original native web.");
    return null;
  }
}
