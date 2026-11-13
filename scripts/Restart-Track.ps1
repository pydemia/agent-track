$ErrorActionPreference = 'Stop'
$restartMutex = New-Object System.Threading.Mutex($false, 'Local\Pydemia.AgentTrack.Start')
if (-not $restartMutex.WaitOne(10000)) { throw 'Track start is already in progress.' }
try {
$stateDir = Join-Path $env:USERPROFILE '.local/share/agent-track'
$pidPath = Join-Path $stateDir 'track-product.pid'
if (Test-Path -LiteralPath $pidPath) {
    $candidate = [int](Get-Content -LiteralPath $pidPath)
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $candidate" -ErrorAction SilentlyContinue
    if ($process) {
        $listener = Get-NetTCPConnection -LocalPort 14345 -State Listen -ErrorAction SilentlyContinue
        if ($process.Name -ne 'node.exe' -or $process.CommandLine.Replace('\','/') -notlike '*apps/api/main.ts*' -or @($listener).Count -ne 1 -or $listener.LocalAddress -ne '127.0.0.1' -or $listener.OwningProcess -ne $candidate) {
            throw 'Track process identity mismatch; existing process preserved.'
        }
        $recordPath = Join-Path $stateDir 'track-product-process.json'
        if (Test-Path -LiteralPath $recordPath) {
            $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
            if ($record.pid -ne $candidate -or $record.name -cne $process.Name -or $record.executable -cne $process.ExecutablePath -or $record.command -cne $process.CommandLine -or $record.created -cne $process.CreationDate.ToUniversalTime().ToString('o')) {
                throw 'Track generation differs from its process receipt; existing process preserved.'
            }
        }
        $owned = @{pid=[int]$process.ProcessId;name=[string]$process.Name;executable=[string]$process.ExecutablePath;created=$process.CreationDate.ToUniversalTime().ToString('o');command=[string]$process.CommandLine}
        $previousStopIdentity = $env:TRACK_RESTART_IDENTITY
        try {
            $env:TRACK_RESTART_IDENTITY = $owned | ConvertTo-Json -Compress
            $stopHelper = Join-Path (Split-Path -Parent $PSScriptRoot) 'deploy/demian/windows-web-process.mjs'
            # Pass module text through stdin; Windows PowerShell native argv quoting
            # must not strip its JavaScript string delimiters.
            $stopModule = 'import {pathToFileURL} from "node:url"; const {stopOwnedWeb} = await import(pathToFileURL(process.argv[2])); try { await stopOwnedWeb(JSON.parse(process.env.TRACK_RESTART_IDENTITY),14345); } catch { console.error("Track owned stop refused"); process.exitCode=1; }'
            $stopModule | & (Get-Command node.exe).Source --input-type=module - $stopHelper
            if ($LASTEXITCODE -ne 0) { throw 'Track owned stop refused; inspect its process identity.' }
        } finally { $env:TRACK_RESTART_IDENTITY = $previousStopIdentity }
    }
}
if (@(Get-NetTCPConnection -LocalPort 14345 -State Listen -ErrorAction SilentlyContinue).Count -gt 0) {
    throw 'An unrecorded listener remains; existing process preserved.'
}
& (Join-Path $PSScriptRoot 'Start-Track.ps1') -ProductOnly
} finally { $restartMutex.ReleaseMutex(); $restartMutex.Dispose() }
