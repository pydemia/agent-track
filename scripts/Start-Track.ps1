$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$stateDir = Join-Path $env:USERPROFILE '.local/share/agent-track'
$configPath = Join-Path $stateDir 'track-product.config.json'
if (-not (Test-Path -LiteralPath $configPath)) { throw 'Private Track product config is required.' }
$running = $false
try { $running = (Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 14345 -State Listen -ErrorAction Stop).Count -gt 0 } catch { }
if (-not $running) {
    $env:TRACK_CONFIG = $configPath
    $process = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList @('--import', 'tsx', 'apps/api/main.ts') -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $stateDir 'track-product.stdout.log') -RedirectStandardError (Join-Path $stateDir 'track-product.stderr.log')
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
Write-Output 'Track product and private reverse bridge started; public access requires Entra.'
