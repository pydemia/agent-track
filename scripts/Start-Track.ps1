$ErrorActionPreference = 'Stop'
$startMutex = New-Object System.Threading.Mutex($false, 'Local\Pydemia.AgentTrack.Start')
if (-not $startMutex.WaitOne(10000)) { throw 'Track start is already in progress.' }
try {
$repoRoot = Split-Path -Parent $PSScriptRoot
$stateDir = Join-Path $env:USERPROFILE '.local/share/agent-track'
$configPath = Join-Path $stateDir 'track-product.config.json'
if (-not (Test-Path -LiteralPath $configPath)) { throw 'Private Track product config is required.' }
$running = $false
try { $listeners = @(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 14345 -State Listen -ErrorAction Stop); $running = $listeners.Count -gt 0 } catch { }
if ($running) {
    $productPidPath = Join-Path $stateDir 'track-product.pid'
    if (-not (Test-Path -LiteralPath $productPidPath) -or [int](Get-Content -LiteralPath $productPidPath) -ne $listeners[0].OwningProcess) {
        throw 'Track listener differs from the recorded PID; existing process preserved.'
    }
}
if (-not $running) {
    $env:TRACK_CONFIG = $configPath
    $process = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList @('--import', 'tsx', 'apps/api/main.ts') -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $stateDir 'track-product.stdout.log') -RedirectStandardError (Join-Path $stateDir 'track-product.stderr.log')
    $ready = $false
    for ($attempt = 0; $attempt -lt 10; $attempt++) {
        $process.Refresh()
        if ($process.HasExited) { throw 'Track product startup failed; inspect its private log.' }
        $listening = @(Get-NetTCPConnection -LocalPort 14345 -State Listen -ErrorAction SilentlyContinue)
        if ($listening.Count -eq 1 -and $listening[0].OwningProcess -eq $process.Id) { $ready = $true; break }
        Start-Sleep -Milliseconds 200
    }
    if (-not $ready) { throw 'Track did not acquire its expected listener; PID was not recorded.' }
    $process.Id | Set-Content (Join-Path $stateDir 'track-product.pid')
}
$forwardPidPath = Join-Path $stateDir 'track-forward.pid'
$forward = $null
if (Test-Path -LiteralPath $forwardPidPath) {
    $candidate = [int](Get-Content -LiteralPath $forwardPidPath)
    $forward = Get-CimInstance Win32_Process -Filter "ProcessId = $candidate" -ErrorAction SilentlyContinue
    if ($forward -and ($forward.Name -ne 'ssh.exe' -or $forward.CommandLine -notlike '*14346:127.0.0.1:14345*')) { $forward = $null }
}
if (-not $forward) {
    $process = Start-Process -FilePath (Get-Command ssh.exe).Source -ArgumentList @('-N', '-T', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=20', '-o', 'ServerAliveCountMax=3', '-R', '127.0.0.1:14346:127.0.0.1:14345', 'pydemia-server') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $stateDir 'track-forward.stdout.log') -RedirectStandardError (Join-Path $stateDir 'track-forward.stderr.log')
    $process.Id | Set-Content -LiteralPath $forwardPidPath
}
$privateConfig = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if (@($privateConfig.sources | Where-Object { $_.kind -eq 'projects' -and $_.baseUrl -eq 'http://127.0.0.1:14349' -and $_.projectsCredentialFile }).Count -gt 0) {
    & (Join-Path $PSScriptRoot 'Start-Projects-Bridge.ps1')
}
if (Test-Path -LiteralPath (Join-Path $stateDir 'projects-context-bridge.json')) {
    & (Join-Path $PSScriptRoot 'Start-Projects-Context-Bridge.ps1')
}
Write-Output 'Track product and private reverse bridge started; public access requires Entra.'
} finally { $startMutex.ReleaseMutex(); $startMutex.Dispose() }
