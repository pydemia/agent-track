import { execFileSync } from "node:child_process";
import { mkdir, open, writeFile, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import net from "node:net";
import { loadApiStartup, matchesApiProcess, apiStartupDisposition, apiStartupEnvironment, apiStartupHash, verifyApiDatabase } from "./api-start-policy.mjs";
import { inspectApiProcess, apiListeners } from "./windows-api-process.mjs";
import { launchRecordedWeb } from "./owned-child.mjs";

const failure = () => new Error("Demian API-only startup failed; existing services were preserved");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const ready = async port => {
  try { const response = await fetch(`http://127.0.0.1:${port}/health/ready`, { redirect: "error", signal: AbortSignal.timeout(1500) });
    const ok = response.status === 200; void response.body?.cancel().catch(() => {}); return ok;
  } catch { return false; }
};
const databaseReady = port => new Promise(resolve => {
  const socket = net.connect({ host: "127.0.0.1", port }); socket.setTimeout(1000);
  const finish = value => { socket.destroy(); resolve(value); };
  socket.once("connect", () => finish(true)); socket.once("error", () => finish(false)); socket.once("timeout", () => finish(false));
});

function originalDatabaseReady(service) {
  let observed;
  try {
    const format = '{"id":{{json .Id}},"image":{{json .Image}},"running":{{json .State.Running}},"ports":{{json .NetworkSettings.Ports}},"mounts":{{json .Mounts}}}';
    observed = JSON.parse(execFileSync("docker.exe", ["inspect", "--format", format, service.containerId],
      { encoding: "utf8", windowsHide: true, timeout: 3000, maxBuffer: 131072, stdio: ["ignore", "pipe", "pipe"] }).trim());
  } catch { return false; }
  return verifyApiDatabase(service, observed);
}

/** The PowerShell entry holds an OS file-sharing lock for this whole operation. */
export async function ensureApiStarted(root, checkOnly = false) {
  const loaded = await loadApiStartup(root), { plan, active, activePath, activeSha256, configSha256 } = loaded;
  if (process.platform !== "win32" || process.env.DEMIAN_API_STARTUP_LOCK_OWNER !== String(process.ppid)) throw failure();
  const current = await inspectApiProcess(active.process?.pid);
  const listeners = await apiListeners(8080);
  if (apiStartupDisposition(active.process, current, listeners, plan) === "adopt") {
    await verifyApiAdoption({ record: active.process, plan, current, listeners, checkReady: async () => originalDatabaseReady(loaded.service) && await ready(8080) });
    return { ok: true, action: "reused", pid: current.pid, port: 8080, workerStarted: false };
  }
  // A live recorded API with no listener may still be starting or shutting down.
  // A recycled unrelated PID is preserved and does not prevent a new port owner.
  if (checkOnly) throw failure();
  const deadline = performance.now() + 60_000;
  while (!originalDatabaseReady(loaded.service) || !await databaseReady(11931)) { if (performance.now() >= deadline) throw failure(); await pause(1000); }
  const refreshed = await loadApiStartup(root);
  if (refreshed.activeSha256 !== activeSha256 || refreshed.configSha256 !== configSha256 || (await apiListeners(8080)).length) throw failure();
  const env = apiStartupEnvironment(plan, refreshed.secrets);
  return launchApiAttempt({ root, plan, active, env, revalidate: async () => {
    const final = await loadApiStartup(root);
    if (final.activeSha256 !== activeSha256 || final.configSha256 !== configSha256 || !originalDatabaseReady(final.service)) throw failure();
  }, publish: async (record, attempt) => {
    const payload = join(attempt, "active.new.json"); await writeFile(payload, JSON.stringify(record, null, 2) + "\n", { flag: "wx" });
    // Compare-and-write under a native sharing lock. Neither stale PID nor shell
    // command text can redirect cleanup toward another process.
    const raw = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", join(plan.operatorDirectory, "write-api-record.ps1"),
      "-Target", activePath, "-Payload", payload, "-ExpectedSha256", activeSha256], { encoding: "utf8", windowsHide: true, timeout: 10000, maxBuffer: 131072, stdio: ["ignore", "pipe", "pipe"] });
    const receipt = JSON.parse(raw.replace(/^\uFEFF/, "").trim());
    if (receipt.updated !== true || receipt.sha256 !== apiStartupHash(await readFile(payload))) throw failure();
  } });
}

export async function verifyApiAdoption({ record, plan, current, listeners, checkReady, port = 8080 }) {
  if (apiStartupDisposition(record, current, listeners, plan) !== "adopt" || !await checkReady()) throw failure();
  const final = await inspectApiProcess(record.pid), bound = await apiListeners(port);
  if (apiStartupDisposition(record, final, bound, plan) !== "adopt") throw failure();
}

/** Separate child transaction also permits real, isolated loopback fixture verification. */
export async function launchApiAttempt({ root, plan, active, env, revalidate, publish, port = 8080 }) {
  if (process.platform !== "win32" || !Number.isInteger(port) || port < 1 || port > 65535) throw failure();
  const attempt = join(root, "demian-api-startup-attempts", new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID());
  await mkdir(attempt, { recursive: true });
  const stdout = await open(join(attempt, "stdout.log"), "wx"); let stderr;
  let owned;
  try {
    stderr = await open(join(attempt, "stderr.log"), "wx");
    const result = await launchRecordedWeb({ executable: plan.executable, args: [plan.entry], cwd: plan.repository, env,
      stdoutFd: stdout.fd, stderrFd: stderr.fd, record: { profile: "api-only" },
      persist: async record => {
        if (record.state === "starting") {
          owned = await inspectApiProcess(record.pid);
          if (!matchesApiProcess(owned, owned, plan)) throw failure();
          await writeFile(join(attempt, "owned-process.json"), JSON.stringify(owned, null, 2) + "\n", { flag: "wx" });
        } else {
          await revalidate();
          const bound = await apiListeners(port);
          if (!bound.length || bound.some(row => row.pid !== record.pid || row.address !== "127.0.0.1") ||
              !matchesApiProcess(owned, await inspectApiProcess(record.pid), plan)) throw failure();
          await publish({ ...active, recordedAt: new Date().toISOString(), process: owned, automaticStartupConfigured: true,
            startup: { version: 1, attemptDirectory: attempt, apiOnly: true, workerStarted: false } }, attempt);
        }
      },
      verify: async (record, child) => {
        const deadline = performance.now() + 15000;
        while (performance.now() < deadline) {
          if (child.exitCode !== null || child.signalCode !== null) return false;
          const bound = await apiListeners(port);
          if (bound.some(row => row.pid !== record.pid || row.address !== "127.0.0.1")) return false;
          if (bound.length && await ready(port)) return true; await pause(250);
        }
        return false;
      } });
    return { ok: true, action: "started", pid: result.pid, port, workerStarted: false };
  } finally { await stdout.close(); if (stderr) await stderr.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const args = process.argv.slice(2), check = args[2] === "--check";
    if (args[0] !== "--state-root" || !args[1] || args.length !== (check ? 3 : 2)) throw failure();
    console.log(JSON.stringify(await ensureApiStarted(args[1], check)));
  } catch { console.error("Demian API-only startup unavailable; existing services preserved. Inspect private startup configuration and attempt logs."); process.exitCode = 1; }
}
