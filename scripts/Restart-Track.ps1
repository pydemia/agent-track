$ErrorActionPreference = 'Stop'
$stateDir = Join-Path $env:USERPROFILE '.local/share/agent-track'
$pidPath = Join-Path $stateDir 'track-product.pid'
if (Test-Path -LiteralPath $pidPath) {
    $candidate = [int](Get-Content -LiteralPath $pidPath)
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $candidate" -ErrorAction SilentlyContinue
    if ($process) {
        $listener = Get-NetTCPConnection -LocalPort 14345 -State Listen -ErrorAction SilentlyContinue
        if ($process.Name -ne 'node.exe' -or $process.CommandLine -notlike '*apps/api/main.ts*' -or $listener.OwningProcess -ne $candidate) {
            throw 'Track process identity mismatch; existing process preserved.'
        }
        Stop-Process -Id $candidate
    }
}
& (Join-Path $PSScriptRoot 'Start-Track.ps1')
