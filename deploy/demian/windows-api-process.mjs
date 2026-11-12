import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PROCESS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
try {
  $process = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $env:DEMIAN_API_PROCESS_PID" -ErrorAction Stop
  if ($null -eq $process) {
    [ordered]@{ ok = $true; process = $null } | ConvertTo-Json -Compress -Depth 4
    exit 0
  }
  $created = $process.CreationDate.ToUniversalTime().ToString('o')
  $snapshot = [ordered]@{
    pid = [int]$process.ProcessId
    name = [string]$process.Name
    executable = [string]$process.ExecutablePath
    created = [string]$created
    command = [string]$process.CommandLine
  }
  [ordered]@{ ok = $true; process = $snapshot } | ConvertTo-Json -Compress -Depth 4
  exit 0
} catch {
  [ordered]@{ ok = $false } | ConvertTo-Json -Compress -Depth 2
  exit 0
}`;

const LISTENERS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
try {
  $requestedPort = [int]$env:DEMIAN_API_PROCESS_PORT
  $connections = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -eq $requestedPort })
  $listeners = @($connections | ForEach-Object {
    [ordered]@{
      address = [string]$_.LocalAddress
      port = [int]$_.LocalPort
      pid = [int]$_.OwningProcess
    }
  })
  [ordered]@{ ok = $true; listeners = @($listeners) } | ConvertTo-Json -Compress -Depth 4
  exit 0
} catch {
  [ordered]@{ ok = $false } | ConvertTo-Json -Compress -Depth 2
  exit 0
}`;

function positiveSafeInteger(value, max, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new TypeError(`Invalid ${label}.`);
  }
}

async function runPowerShell(script, envKey, value, failureMessage) {
  if (process.platform !== "win32") throw new Error("Windows process metadata is only available on Windows.");
  let stdout;
  try {
    ({ stdout } = await execFileAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
      encoding: "utf8",
      env: { ...process.env, [envKey]: String(value) },
    }));
  } catch {
    throw new Error(failureMessage);
  }
  try {
    const result = JSON.parse(stdout.trim());
    if (!result || result.ok !== true) throw new Error();
    return result;
  } catch {
    throw new Error(failureMessage);
  }
}

/** Read process identity metadata through bounded Windows CIM inspection. */
export async function inspectApiProcess(pid) {
  positiveSafeInteger(pid, Number.MAX_SAFE_INTEGER, "process ID");
  const result = await runPowerShell(PROCESS_SCRIPT, "DEMIAN_API_PROCESS_PID", pid, "Unable to inspect Windows process metadata.");
  if (result.process === null) return null;
  const row = result.process;
  if (!row || row.pid !== pid || row.pid < 1 || typeof row.name !== "string" || typeof row.executable !== "string" || typeof row.created !== "string" || typeof row.command !== "string") {
    throw new Error("Unable to inspect Windows process metadata.");
  }
  return { pid: row.pid, name: row.name, executable: row.executable, created: row.created, command: row.command };
}

/** Return listener address and owning PID metadata for a TCP port. */
export async function apiListeners(port) {
  positiveSafeInteger(port, 65_535, "port");
  const result = await runPowerShell(LISTENERS_SCRIPT, "DEMIAN_API_PROCESS_PORT", port, "Unable to inspect Windows TCP listeners.");
  if (!Array.isArray(result.listeners) || result.listeners.some(row => !row || typeof row.address !== "string" || row.port !== port || !Number.isSafeInteger(row.pid) || row.pid < 1)) {
    throw new Error("Unable to inspect Windows TCP listeners.");
  }
  return result.listeners.map(({ address, port: listenerPort, pid }) => ({ address, port: listenerPort, pid }));
}
