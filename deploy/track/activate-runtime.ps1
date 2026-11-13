param([Parameter(Mandatory=$true)][string]$InputFile, [Parameter(Mandatory=$true)][string]$InputSha256)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$stateDir = Join-Path $env:USERPROFILE '.local/share/agent-track'
if ($InputSha256 -cnotmatch '^[a-f0-9]{64}$' -or -not [System.IO.Path]::IsPathRooted($InputFile)) { throw 'Invalid Track operation input.' }
$hasher = [System.Security.Cryptography.SHA256]::Create()
try { $actual = [BitConverter]::ToString($hasher.ComputeHash([System.IO.File]::ReadAllBytes($InputFile))).Replace('-','').ToLowerInvariant() } finally { $hasher.Dispose() }
if ($actual -cne $InputSha256) { throw 'Track operation input changed.' }
$plan = Get-Content -LiteralPath $InputFile -Raw | ConvertFrom-Json
if ($plan.version -notin @(1,2) -or $plan.scope -ne 'track-product-14345' -or $plan.operationId -cnotmatch '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$') { throw 'Invalid Track operation scope.' }
$operationDir = Join-Path (Join-Path $stateDir 'operations') $plan.operationId
if ([System.IO.Path]::GetFullPath($plan.operationDir) -ne [System.IO.Path]::GetFullPath($operationDir)) { throw 'Track operation directory mismatch.' }
$node = (Get-Command node.exe).Source
$phaseScript = Join-Path $PSScriptRoot 'runtime-operation.mjs'
function Invoke-Phase([string]$phase) {
    $output = & $node $phaseScript '--phase' $phase '--input' $InputFile '--input-sha256' $InputSha256 2> (Join-Path $operationDir ('phase-' + $phase + '.stderr.log'))
    if ($LASTEXITCODE -ne 0) { throw ('Track phase failed: ' + $phase) }
    $null = $output | ConvertFrom-Json
    Write-Host ('Track phase completed: ' + $phase)
}
function Invoke-ProductStart([string]$phase) {
    # Keep the checked config readable but deny replacement/writes until startup returns.
    $configGuard = [System.IO.File]::Open((Join-Path $stateDir 'track-product.config.json'), [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
    try {
        Invoke-Phase $phase
        & (Join-Path $repoRoot 'scripts/Start-Track.ps1') -ProductOnly | Out-Null
    } finally { $configGuard.Dispose() }
}
Push-Location -LiteralPath $repoRoot
try {
    Invoke-Phase 'preflight'
    $mutex = New-Object System.Threading.Mutex($false, 'Local\Pydemia.AgentTrack.Start')
    if (-not $mutex.WaitOne(10000)) { $mutex.Dispose(); throw 'Track launch is already in progress.' }
    try {
        $row = Get-CimInstance Win32_Process -Filter "ProcessId = $PID" -ErrorAction Stop
        $driver = @{pid=[int]$row.ProcessId;name=[string]$row.Name;executable=[string]$row.ExecutablePath;created=$row.CreationDate.ToUniversalTime().ToString('o');command=[string]$row.CommandLine}
        $driverFile = Join-Path $operationDir 'driver.json'
        $handle = New-Object System.IO.FileStream($driverFile, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
        try { $encoded = [System.Text.Encoding]::UTF8.GetBytes(($driver | ConvertTo-Json -Compress)); $handle.Write($encoded,0,$encoded.Length); $handle.Flush($true) } finally { $handle.Dispose() }
        $stopAttempted = $false
        try {
            Invoke-Phase 'maintenance'
            Invoke-Phase 'drain'
            $stopAttempted = $true
            Invoke-Phase 'stop'
            Invoke-Phase 'candidate'
            Invoke-ProductStart 'candidate-start'
            Invoke-Phase 'verify'
            Invoke-Phase 'restore-config'
            Invoke-Phase 'finalize'
            @{committed=$true;operationId=$plan.operationId;originalConfigRestored=$true;bridgesRestarted=$false} | ConvertTo-Json -Compress
        } catch {
            $commitFile = Join-Path $operationDir 'committed.json'
            if (Test-Path -LiteralPath $commitFile) {
                $commit = Get-Content -LiteralPath $commitFile -Raw | ConvertFrom-Json
                if ($commit.committed -eq $true -and $commit.operationId -ceq $plan.operationId -and $commit.inputSha256 -ceq $InputSha256) {
                    @{committed=$true;reportingFailed=$true;operationId=$plan.operationId} | ConvertTo-Json -Compress
                    exit 1
                }
            }
            $recoveryFailed = $false
            $configRestoreFailed = $false
            if ($stopAttempted) {
                try {
                    Invoke-Phase 'rollback'
                    Invoke-ProductStart 'rollback-start'
                    Invoke-Phase 'rollback-ready'
                } catch { $recoveryFailed = $true }
            }
            try { Invoke-Phase 'restore-config' } catch { $configRestoreFailed = $true }
            try { Invoke-Phase 'report-failure' } catch { }
            @{committed=$false;operationId=$plan.operationId;stopAttempted=$stopAttempted;recoveryFailed=$recoveryFailed;configRestoreFailed=$configRestoreFailed} | ConvertTo-Json -Compress
            exit 1
        }
    } finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
} finally { Pop-Location }
