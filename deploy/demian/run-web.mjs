import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, open, readFile, realpath, writeFile } from "node:fs/promises";
import net from "node:net";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { verifyFrozenRelease, webProfilePort } from "./web-release-policy.mjs";
import { launchRecordedWeb } from "./owned-child.mjs";

const execute = promisify(execFile);
const sha = data => createHash("sha256").update(data).digest("hex");
const state = join(homedir(), ".demian/service");
const root = join(state, "track-context");
const args = process.argv.slice(2);
const profile = args[args.indexOf("--profile") + 1];
assert(["qa", "local", "public"].includes(profile));
const release = await realpath(args[args.indexOf("--release") + 1]);
const releases = await realpath(join(root, "releases"));
const rel = relative(releases, release);
assert(rel && rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel));
assert.equal((await readFile(join(root, "purpose"), "utf8")).replaceAll("\r\n", "\n"), "agent-track-native-demian-context-v1\n");
const manifestBytes = await readFile(join(release, "release.json"));
const manifest = JSON.parse(manifestBytes.toString("utf8"));
await verifyFrozenRelease(release, manifest);
const service = JSON.parse(await readFile(join(state, "service.json"), "utf8"));
const domain = JSON.parse(await readFile(join(state, "domain/config.json"), "utf8"));
const port = webProfilePort(profile, domain.webPort);
const secret = JSON.parse(await readFile(join(state, "secrets.json"), "utf8"));
const occupied = await new Promise(resolve => {
  const client = net.connect({ host: "127.0.0.1", port });
  client.once("connect", () => { client.destroy(); resolve(true); });
  client.once("error", () => resolve(false));
});
assert(!occupied, "Existing listener preserved; inspect it before starting another web.");
const entry = join(release, "apps/web/server.js");
assert(manifest.payloadFiles["apps/web/server.js"]);
const env = Object.fromEntries(["SystemRoot", "WINDIR", "PATH", "PATHEXT", "TEMP", "TMP", "COMSPEC"].filter(name => process.env[name]).map(name => [name, process.env[name]]));
Object.assign(env, {
  HOME: join(state, "runtime-home"), USERPROFILE: join(state, "runtime-home"), APPDATA: join(state, "runtime-home/AppData/Roaming"), LOCALAPPDATA: join(state, "runtime-home/AppData/Local"),
  NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: String(port), DEMIAN_AUTH_MODE: "trusted", DEMIAN_API_TOKEN: secret.apiToken,
  DEMIAN_API_INTERNAL_URL: service.apiUrl, DEMIAN_WEB_PUBLIC_URL: profile === "qa" ? "http://127.0.0.1:3002" : profile === "local" ? service.webUrl : domain.publicUrl,
  DEMIAN_TRACK_CONTEXT_FILE: join(homedir(), ".local/share/agent-track/demian-context-native.json"),
});
await mkdir(join(root, "logs"), { recursive: true });
await mkdir(join(root, "processes"), { recursive: true });
const stdout = await open(join(root, "logs", profile + ".log"), "a");
const stderr = await open(join(root, "logs", profile + ".error.log"), "a");
let ready;
try {
  ready = await launchRecordedWeb({ executable: process.execPath, args: [entry], cwd: join(release, "apps/web"), env, stdoutFd: stdout.fd, stderrFd: stderr.fd,
    record: { profile, port, entry, releaseDir: release, buildId: manifest.webBuildId, manifestSha256: sha(manifestBytes) },
    persist: record => writeFile(join(root, "processes", profile + ".json"), JSON.stringify(record, null, 2) + "\n"),
    verify: async (record, child) => {
      for (let attempt = 0; attempt < 15; attempt++) {
        try {
          const result = await execute("powershell.exe", ["-NoProfile", "-File", join(dirname(fileURLToPath(import.meta.url)), "inspect-web.ps1"), "-TargetProcessId", String(child.pid), "-Port", String(port), "-Entry", entry, "-StartedAt", record.startedAt], { windowsHide: true });
          if (JSON.parse(result.stdout).matched) return true;
        } catch { /* The owned child may still be binding its listener. */ }
        if (child.exitCode !== null) return false;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      return false;
    },
  });
} finally { await stdout.close(); await stderr.close(); }
console.log(JSON.stringify({ started: true, profile, port, pid: ready.pid, record: ready, webBuildId: manifest.webBuildId, loopbackOnly: true, nativeApiWorkerDatabaseChanged: false }));
