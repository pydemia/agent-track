import { createHash } from "node:crypto";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep, basename } from "node:path";

const fail = () => new Error("Demian API startup profile could not be verified");
const absolute = value => typeof value === "string" && isAbsolute(value) && !/[\x00-\x1f\x7f"\r\n]/.test(value);
const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const apiStartupHash = bytes => createHash("sha256").update(bytes).digest("hex");

export async function hashStartupFile(file, limit) {
  const handle = await open(file, "r");
  try {
    const stat = await handle.stat(); if (!stat.isFile() || stat.size > limit) throw fail();
    const hash = createHash("sha256"), buffer = Buffer.alloc(65536); let used = 0;
    while (true) { const { bytesRead } = await handle.read(buffer, 0, buffer.length, null); if (!bytesRead) break;
      used += bytesRead; if (used > limit) throw fail(); hash.update(buffer.subarray(0, bytesRead)); }
    return hash.digest("hex");
  } finally { await handle.close(); }
}

export async function readStartupFile(file, limit = 131072) {
  const handle = await open(file, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) throw fail();
    const bytes = Buffer.alloc(limit + 1); let size = 0;
    while (size < bytes.length) { const { bytesRead } = await handle.read(bytes, size, bytes.length - size, null); if (!bytesRead) break; size += bytesRead; }
    if (size > limit) throw fail();
    return bytes.subarray(0, size);
  } finally { await handle.close(); }
}

export function validateApiStartupConfig(value) {
  const keys = ["version", "ownerSid", "executable", "executableSha256", "entry", "bundleSha256", "repository", "serviceState", "profilePins", "operatorDirectory", "operatorFiles"];
  if (!value || Array.isArray(value) || Object.keys(value).sort().join() !== keys.sort().join() || value.version !== 1 ||
      !/^S-1-5-[0-9-]{1,160}$/.test(value.ownerSid) || ![value.executable, value.entry, value.repository, value.serviceState, value.operatorDirectory].every(absolute) ||
      !digest(value.executableSha256) || !digest(value.bundleSha256) || basename(value.entry) !== "main.mjs") throw fail();
  const exactPins = (pins, names) => pins && !Array.isArray(pins) && Object.keys(pins).sort().join() === names.sort().join() && Object.values(pins).every(digest);
  if (!exactPins(value.profilePins, ["service.json", "secrets.json"]) ||
      !exactPins(value.operatorFiles, ["Start-Api.ps1", "start-api.mjs", "api-start-policy.mjs", "windows-api-process.mjs", "owned-child.mjs", "write-api-record.ps1"])) throw fail();
  return value;
}

/** Existing process records are evidence only when the live Windows identity agrees exactly. */
export function matchesApiProcess(record, actual, plan) {
  if (!record || !actual || !Number.isSafeInteger(record.pid) || record.pid < 1) return false;
  const samePath = (a, b) => absolute(a) && absolute(b) && relative(resolve(a), resolve(b)) === "";
  const spellings = value => /\s/.test(value) ? [`"${value}"`] : [value, `"${value}"`];
  const allowedCommands = spellings(plan.executable).flatMap(executable => spellings(plan.entry).map(entry => `${executable} ${entry}`));
  return record.pid === actual.pid && typeof record.name === "string" && record.name.toLowerCase() === "node.exe" &&
    typeof actual.name === "string" && actual.name.toLowerCase() === "node.exe" &&
    samePath(record.executable, plan.executable) && samePath(actual.executable, plan.executable) &&
    typeof record.created === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{7}Z$/.test(record.created) &&
    actual.created === record.created && record.command === actual.command && allowedCommands.includes(actual.command);
}

export function apiStartupDisposition(record, actual, listeners, plan) {
  const owned = matchesApiProcess(record, actual, plan);
  if (listeners.length) {
    if (!owned || listeners.some(row => row.pid !== actual.pid || row.address !== "127.0.0.1")) throw fail();
    return "adopt";
  }
  if (owned) throw fail(); // Do not duplicate a live but not-yet-listening API.
  return "start"; // Missing/recycled PID is never terminated.
}

export async function loadApiStartup(stateRoot) {
  try {
    if (!absolute(stateRoot)) throw fail();
    stateRoot = await realpath(stateRoot);
    const configBytes = await readStartupFile(join(stateRoot, "demian-api-startup.json"));
    const plan = validateApiStartupConfig(JSON.parse(configBytes.toString("utf8")));
    const inside = async (parent, file) => {
      const root = await realpath(parent), canonical = await realpath(file), rel = relative(root, canonical);
      if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel) || relative(resolve(file), canonical) !== "") throw fail();
      return canonical;
    };
    await inside(join(stateRoot, "demian-api-releases"), plan.entry);
    await inside(join(stateRoot, "demian-api-operators"), join(plan.operatorDirectory, "start-api.mjs"));
    for (const [file, expected] of Object.entries(plan.operatorFiles)) {
      const target = await inside(plan.operatorDirectory, join(plan.operatorDirectory, file));
      if (apiStartupHash(await readStartupFile(target, 2 * 1024 * 1024)) !== expected) throw fail();
    }
    if (relative(await realpath(process.execPath), await realpath(plan.executable)) !== "" ||
        await hashStartupFile(plan.executable, 128 * 1024 * 1024) !== plan.executableSha256 ||
        await hashStartupFile(plan.entry, 32 * 1024 * 1024) !== plan.bundleSha256) throw fail();
    const profile = {};
    for (const [file, expected] of Object.entries(plan.profilePins)) {
      const bytes = await readStartupFile(join(plan.serviceState, file));
      if (apiStartupHash(bytes) !== expected) throw fail();
      profile[file] = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
    }
    const service = profile["service.json"];
    if (service.apiUrl !== "http://127.0.0.1:8080" || service.databasePort !== 11931 ||
        relative(resolve(service.repository), resolve(plan.repository)) !== "" || service.webUrl !== "http://127.0.0.1:3000" ||
        !/^[a-f0-9]{64}$/.test(service.containerId) || !/^sha256:[a-f0-9]{64}$/.test(service.imageId) ||
        typeof service.volume !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(service.volume)) throw fail();
    const activePath = join(stateRoot, "demian-api-active.json"), activeBytes = await readStartupFile(activePath);
    const active = JSON.parse(activeBytes.toString("utf8"));
    if (active.state !== "active" || active.entry !== plan.entry || active.bundleSha256 !== plan.bundleSha256) throw fail();
    return { stateRoot, plan, service, secrets: profile["secrets.json"], active, activePath,
      activeSha256: apiStartupHash(activeBytes), configSha256: apiStartupHash(configBytes) };
  } catch { throw fail(); }
}

export function verifyApiDatabase(service, observed) {
  if (!observed || observed.id !== service.containerId || observed.image !== service.imageId ||
      !Array.isArray(observed.mounts) || !observed.mounts.some(row => row.Type === "volume" && row.Name === service.volume && row.Destination === "/var/lib/postgresql/data")) throw fail();
  if (observed.running === false) return false;
  if (observed.running !== true || !Array.isArray(observed.ports?.["5432/tcp"]) || observed.ports["5432/tcp"].length !== 1 ||
      observed.ports["5432/tcp"][0].HostIp !== "127.0.0.1" || observed.ports["5432/tcp"][0].HostPort !== "11931") throw fail();
  return true;
}

/** Child-only environment: no inherited worker/peer/deployment selectors or OAuth overrides. */
export function apiStartupEnvironment(plan, secrets, ambient = process.env) {
  if (typeof secrets?.apiToken !== "string" || secrets.apiToken.length < 16 || secrets.apiToken.length > 16384 ||
      typeof secrets.databasePassword !== "string" || !secrets.databasePassword || secrets.databasePassword.length > 4096) throw fail();
  const env = Object.fromEntries(["SystemRoot", "WINDIR", "PATH", "PATHEXT", "TEMP", "TMP", "COMSPEC"]
    .filter(key => typeof ambient[key] === "string").map(key => [key, ambient[key]]));
  const home = join(plan.serviceState, "runtime-home");
  return Object.assign(env, { HOME: home, USERPROFILE: home, APPDATA: join(home, "AppData/Roaming"), LOCALAPPDATA: join(home, "AppData/Local"),
    NODE_ENV: "production", HOST: "127.0.0.1", PORT: "8080", DEMIAN_AUTH_MODE: "trusted", DEMIAN_API_TOKEN: secrets.apiToken,
    DATABASE_URL: `postgresql://demian:${encodeURIComponent(secrets.databasePassword)}@127.0.0.1:11931/demian`,
    DEMIAN_WORKSPACE_ROOT: join(plan.serviceState, "workspaces"), DEMIAN_MOUNT_ROOTS: "[]", DEMIAN_CORS_ORIGINS: "http://127.0.0.1:3000" });
}
