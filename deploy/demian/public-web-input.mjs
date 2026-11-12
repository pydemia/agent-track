import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { lstat, realpath } from "node:fs/promises";

export const publicWebHelpers = Object.freeze(["run-web.mjs", "owned-child.mjs", "web-release-policy.mjs", "windows-api-process.mjs", "windows-web-process.mjs", "web-launch-policy.mjs", "write-exclusive.ps1"]);
const fail = () => new Error("Public web input could not be verified");
const hash = value => typeof value === "string" && value.length === 64 && /^[a-f0-9]{64}$/.test(value);
const absolute = value => typeof value === "string" && isAbsolute(value) && !/[\x00-\x1f\x7f"]/.test(value);
const same = (a, b) => absolute(a) && absolute(b) && relative(resolve(a), resolve(b)) === "";
const within = (root, value) => same(root, value) === false && absolute(value) && !relative(root, value).startsWith("..") && !isAbsolute(relative(root, value));
const uuid = value => typeof value === "string" && value.length === 36 && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value) && value !== "00000000-0000-0000-0000-000000000000";

/** Reject linked files or redirected parents before a guarded native write. */
export async function assertRegularPublicFile(file, allowMissing = false) {
  if (!absolute(file)) throw fail();
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || !same(await realpath(file), file)) throw fail();
  } catch (error) {
    if (error.code !== "ENOENT" || !allowMissing || !same(await realpath(dirname(file)), dirname(file))) throw fail();
  }
}

/** The caller fixes native state/repository boundaries; input cannot widen them. */
export function validatePublicWebInput(value, { serviceState, repository }) {
  if (!value || value.version !== 1 || !uuid(value.operationId) ||
      !isDeepStrictEqual(value.scope, { profiles: ["public"], port: 3001, neverOperatePorts: [3000, 8080, 3100, 14345] }) ||
      !same(value.serviceState, serviceState) || !same(value.contextRoot, join(serviceState, "track-context")) ||
      value.executionImplemented !== false) throw fail();
  const root = value.contextRoot;
  for (const [role, port] of Object.entries({ web: 3001, api: 8080, gate: 3100, track: 14345, tunnel: undefined })) {
    const row = value.roles?.[role], p = row?.identity;
    if (!row || row.port !== port || !p || !Number.isSafeInteger(p.pid) || p.pid < 1 ||
        ![p.name, p.created, p.command].every(v => typeof v === "string" && v.length > 0 && !v.includes("\0")) || !absolute(p.executable)) throw fail();
  }
  if (Object.keys(value.roles).sort().join() !== "api,gate,track,tunnel,web" || new Set(Object.values(value.roles).map(v => v.identity.pid)).size !== 5) throw fail();
  if (Object.keys(value.distribution ?? {}).sort().join() !== [...publicWebHelpers].sort().join()) throw fail();
  for (const name of publicWebHelpers) {
    const file = value.distribution[name];
    if (!same(file.source, join(repository, "deploy/demian", name)) || !same(file.target, join(root, name)) ||
        !(file.beforeSha256 === null || hash(file.beforeSha256)) || !hash(file.targetSha256)) throw fail();
  }
  const protectedNames = ["service.json", "secrets.json", "worker.json", "worker-process.json", "start.mjs", "start.ps1", "start-worker.mjs", "start-domain.mjs", "domain/config.json", "domain/processes.json"];
  if (!value.protectedFiles || Object.keys(value.protectedFiles).length !== protectedNames.length) throw fail();
  for (const name of protectedNames) {
    const found = Object.entries(value.protectedFiles).find(([path]) => same(path, join(serviceState, name)));
    if (!found || !hash(found[1])) throw fail();
  }
  if (!same(value.startup?.file, join(serviceState, "start-domain.mjs")) || !hash(value.startup.beforeSha256) || !hash(value.startup.afterSha256) ||
      !same(value.activation?.file, join(root, "active-public.json")) || value.activation.expectedMissing !== true) throw fail();
  for (const release of [value.candidate, value.rollback]) {
    if (!release || !within(join(root, "releases"), release.releaseDir) || !hash(release.manifestSha256) ||
        typeof release.webBuildId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(release.webBuildId)) throw fail();
  }
  const backups = resolve(serviceState, "../../.local/share/agent-track/backups");
  if (same(value.candidate.releaseDir, value.rollback.releaseDir) ||
      !same(value.backup?.resultFile, join(repository, ".runtime/source-availability/demian-web-cutover-backup-result.json")) ||
      !absolute(value.backup.cipherFile) || !same(dirname(dirname(value.backup.cipherFile)), backups) ||
      !basename(dirname(value.backup.cipherFile)).startsWith("demian-preservation-") || basename(value.backup.cipherFile) !== "database.atpg1.aes256gcm" ||
      !hash(value.backup.resultSha256) || !hash(value.backup.cipherSha256) ||
      !["dataSha256", "schemaSha256", "sequenceSha256"].every(key => hash(value.backup.currentData?.[key])) ||
      !hash(value.backup.currentSecurity?.sha256)) throw fail();
  return value;
}
