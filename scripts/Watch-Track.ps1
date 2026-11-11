$ErrorActionPreference = 'Stop'
$mutex = New-Object System.Threading.Mutex($false, 'Local\Pydemia.AgentTrack.Watcher')
if (-not $mutex.WaitOne(0)) { exit 0 }
try {
    while ($true) {
        try { & (Join-Path $PSScriptRoot 'Start-Track.ps1') | Out-Null } catch { }
        Start-Sleep -Seconds 20
    }
} finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
