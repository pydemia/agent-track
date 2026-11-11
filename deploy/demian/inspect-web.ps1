param([Parameter(Mandatory=$true)][int]$TargetProcessId, [Parameter(Mandatory=$true)][int]$Port, [Parameter(Mandatory=$true)][string]$Entry, [string]$StartedAt, [switch]$Stop, [switch]$AllowExited)
$ErrorActionPreference = 'Stop'
$nativeProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $TargetProcessId"
$listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
$identity = $nativeProcess -and $nativeProcess.Name -eq 'node.exe' -and $nativeProcess.CommandLine.Contains($Entry)
if ($identity -and $StartedAt) { $identity = [Math]::Abs(($nativeProcess.CreationDate.ToUniversalTime() - [DateTimeOffset]::Parse($StartedAt).UtcDateTime).TotalSeconds) -lt 5 }
if ($Stop -and -not $StartedAt) { throw 'Stopping a web process also requires its recorded start time.' }
$matched = $identity -and $listeners.Count -eq 1 -and $listeners[0].OwningProcess -eq $TargetProcessId -and $listeners[0].LocalAddress -eq '127.0.0.1'
if ($AllowExited -and $listeners.Count -eq 0) {
    if ($Stop -and $identity) { Stop-Process -Id $TargetProcessId -ErrorAction Stop }
    @{matched=[bool]$identity;stopped=[bool]($Stop -and $identity);exited=$true;portFree=$true} | ConvertTo-Json -Compress
    exit 0
}
if (-not $matched) { exit 1 }
if ($Stop) { Stop-Process -Id $TargetProcessId -ErrorAction Stop }
@{matched=[bool]$matched;stopped=[bool]$Stop} | ConvertTo-Json -Compress
