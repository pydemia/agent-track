$ErrorActionPreference = 'Stop'
$stateDir = Join-Path $env:USERPROFILE '.local/share/agent-track'
$pidPath = Join-Path $stateDir 'gateway.pid'
if (-not (Test-Path $pidPath)) { return }
$gatewayProcessId = [int](Get-Content $pidPath -Raw)
$target = Get-CimInstance Win32_Process -Filter "ProcessId=$gatewayProcessId"
$entry = Join-Path $PSScriptRoot 'trail-gateway.mjs'
if (-not $target) { return }
if (-not $target.CommandLine.Contains($entry)) { throw 'PID no longer belongs to this gateway.' }
Get-CimInstance Win32_Process -Filter "ParentProcessId=$gatewayProcessId" | Where-Object Name -eq 'ssh.exe' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Stop-Process -Id $gatewayProcessId -Force
Write-Output 'Stopped the AgentTrail gateway and its SSH forwarder. Local boards remain running.'
