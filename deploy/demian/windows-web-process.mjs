import { execFile } from "node:child_process";

const failure = () => new Error("Unable to verify Windows web process ownership.");

function snapshot(record) {
  if (!record || !Number.isSafeInteger(record.pid) || record.pid < 1 || record.pid > 0xffffffff ||
      ["name", "executable", "created", "command"].some(key =>
        typeof record[key] !== "string" || !record[key].trim() || record[key].includes("\0")) ||
      record.created.length !== 28 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$/.test(record.created) ||
      !Number.isFinite(Date.parse(record.created)) ||
      new Date(record.created).toISOString() !== record.created.slice(0, 23) + "Z") throw new TypeError("Invalid Windows web process record.");
  return Object.fromEntries(["pid", "name", "executable", "created", "command"].map(key => [key, record[key]]));
}

// Records never enter command text. Case-sensitive ordinal comparisons preserve
// the exact CIM snapshot, including its seven-digit UTC creation timestamp.
const script = String.raw`
$ErrorActionPreference = 'Stop'
$held = $null
function Read-Identity($id) {
  return Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $id" -ErrorAction Stop
}
function Matches($row, $expected) {
  if ($null -eq $row) { return $false }
  return ([long]$row.ProcessId -eq [long]$expected.pid -and
    [string]::Equals([string]$row.Name, [string]$expected.name, [StringComparison]::Ordinal) -and
    [string]::Equals([string]$row.ExecutablePath, [string]$expected.executable, [StringComparison]::Ordinal) -and
    [string]::Equals($row.CreationDate.ToUniversalTime().ToString('o'), [string]$expected.created, [StringComparison]::Ordinal) -and
    [string]::Equals([string]$row.CommandLine, [string]$expected.command, [StringComparison]::Ordinal))
}
function Listeners {
  # Server-side filtering avoids observing unrelated native service ports.
  # MSFT_NetTCPConnection State 2 is Listen; an empty CIM result is a free port.
  Get-CimInstance -Namespace root/StandardCimv2 -ClassName MSFT_NetTCPConnection -Filter "LocalPort = $($inputData.port) AND State = 2" -ErrorAction Stop
}
function Owns($rows, $expected) {
  return ($rows.Count -eq 1 -and $rows[0].LocalAddress -ceq '127.0.0.1' -and
    [long]$rows[0].OwningProcess -eq [long]$expected.pid)
}
function Observe {
  $row = Read-Identity $inputData.record.pid
  $listeners = @(Listeners)
  if ($null -ne $row) {
    if ((Matches $row $inputData.record) -and (Owns $listeners $inputData.record) -and
        (Matches (Read-Identity $inputData.record.pid) $inputData.record)) {
      return @{ state = 'owned-live' }
    }
    return @{ state = 'foreign' }
  }
  if ($null -ne (Read-Identity $inputData.record.pid)) { return @{ state = 'foreign' } }
  if ($listeners.Count -eq 0) { return @{ state = 'exited-free' } }
  if ($null -ne $inputData.other -and (Owns $listeners $inputData.other) -and
      (Matches (Read-Identity $inputData.other.pid) $inputData.other)) {
    $again = @(Listeners)
    if ((Owns $again $inputData.other) -and
        (Matches (Read-Identity $inputData.other.pid) $inputData.other) -and
        $null -eq (Read-Identity $inputData.record.pid)) {
      return @{ state = 'exited-occupied'; listenerPid = [long]$inputData.other.pid }
    }
  }
  return @{ state = 'foreign' }
}
try {
  $inputData = $env:DEMIAN_WEB_PROCESS_INPUT | ConvertFrom-Json
  if ($inputData.mode -eq 'inspect') {
    $result = Observe
  } else {
    $initial = Observe
    if ($initial.state -eq 'exited-free') { $result = @{ state = 'exited' } }
    elseif ($initial.state -ne 'owned-live') { throw 'refused' }
    else {
      Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AgentTrackWebNativeProcess {
  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool TerminateProcess(IntPtr process, uint exitCode);
}
'@ -ErrorAction Stop
      $held = [System.Diagnostics.Process]::GetProcessById([int]$inputData.record.pid)
      # Force opening and retaining the native handle before final CIM reads.
      $retainedHandle = $held.Handle
      if ($held.HasExited) { throw 'refused' }
      if (-not (Matches (Read-Identity $inputData.record.pid) $inputData.record)) { throw 'refused' }
      $finalListeners = @(Listeners)
      if (-not (Owns $finalListeners $inputData.record)) { throw 'refused' }
      if (-not (Matches (Read-Identity $inputData.record.pid) $inputData.record)) { throw 'refused' }
      if ($held.HasExited) { throw 'refused' }
      # Pass the already retained native handle directly; no fresh PID lookup.
      if (-not [AgentTrackWebNativeProcess]::TerminateProcess($retainedHandle, 1)) { throw 'refused' }
      if (-not $held.WaitForExit(5000)) { throw 'refused' }
      if ((Observe).state -ne 'exited-free') { throw 'refused' }
      $result = @{ state = 'stopped' }
    }
  }
  @{ ok = $true; result = $result } | ConvertTo-Json -Compress -Depth 4
} catch {
  @{ ok = $false } | ConvertTo-Json -Compress
} finally {
  if ($null -ne $held) { $held.Dispose() }
}
`;

async function run(mode, record, port, other) {
  const expected = snapshot(record);
  const peer = other === undefined ? undefined : snapshot(other);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new TypeError("Invalid Windows web port.");
  if (peer?.pid === expected.pid) throw new TypeError("Ambiguous Windows web process records.");
  if (process.platform !== "win32") throw failure();
  try {
    const stdout = await new Promise((resolve, reject) => execFile("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024, encoding: "utf8",
      env: { ...process.env, DEMIAN_WEB_PROCESS_INPUT: JSON.stringify({ mode, record: expected, port, other: peer }) },
    }, (error, stdout) => error ? reject(error) : resolve(stdout)));
    const response = JSON.parse(stdout.trim());
    const result = response?.result;
    const states = mode === "inspect" ? ["owned-live", "exited-free", "exited-occupied", "foreign"] : ["stopped", "exited"];
    if (response?.ok !== true || !states.includes(result?.state)) throw failure();
    if (result.state === "exited-occupied" && (!peer || result.listenerPid !== peer.pid)) throw failure();
    return result;
  } catch { throw failure(); }
}

/** Inspect a full frozen CIM identity and exclusively loopback-bound listener. */
export function inspectOwnedWeb(record, port, otherRecord) { return run("inspect", record, port, otherRecord); }

/** Stop only the exact identity using a retained native process handle. */
export function stopOwnedWeb(record, port) { return run("stop", record, port); }
