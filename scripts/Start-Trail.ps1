$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$stateDir = Join-Path $env:USERPROFILE '.local/share/agent-track'
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
& icacls.exe $stateDir /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
if (-not (Test-Path (Join-Path $stateDir 'trail-credentials.json'))) {
    $passwordBytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($passwordBytes)
    @{ username = 'pydemia'; password = [Convert]::ToBase64String($passwordBytes) } | ConvertTo-Json | Set-Content (Join-Path $stateDir 'trail-credentials.json') -Encoding utf8
}
if (-not (Test-Path (Join-Path $stateDir 'trail-sso.json'))) {
    throw 'Run the SSO bootstrap first. Public Basic fallback is disabled.'
}
& (Join-Path $PSScriptRoot 'Start-Project-Boards.ps1')
$gatewayUp = $false
try { Invoke-WebRequest 'http://127.0.0.1:5332/' -TimeoutSec 2 | Out-Null } catch { $gatewayUp = [int]$_.Exception.Response.StatusCode -eq 401 }
if (-not $gatewayUp) {
    Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList @(( '"' + (Join-Path $PSScriptRoot 'trail-gateway.mjs') + '"' )) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $stateDir 'gateway.stdout.log') -RedirectStandardError (Join-Path $stateDir 'gateway.stderr.log') | Out-Null
}
Write-Output 'AgentTrail Entra gateway started. Local administrator Basic auth is available only on 127.0.0.1:5332.'
