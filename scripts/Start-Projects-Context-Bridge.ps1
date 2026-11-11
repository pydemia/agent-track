$ErrorActionPreference = 'Stop'
$bridgeMutex = New-Object System.Threading.Mutex($false, 'Local\Pydemia.AgentTrack.ProjectsContextBridge')
if (-not $bridgeMutex.WaitOne(10000)) { throw 'Context bridge start is already in progress.' }
try {
    $stateDir = Join-Path $env:USERPROFILE '.local/share/agent-track'
    $optIn = Join-Path $stateDir 'projects-context-bridge.json'
    if (-not (Test-Path -LiteralPath $optIn)) { return }
    $policy = Get-Content -LiteralPath $optIn -Raw | ConvertFrom-Json
    if ($policy.version -ne 1 -or $policy.enabled -ne $true) { return }
    $socketTarget = '/home/pydemia/git/projects/state/.agent-track/context.sock:127.0.0.1:14345'
    $helper = Join-Path (Split-Path -Parent $PSScriptRoot) 'deploy/projects/context-socket.py'
    $pidPath = Join-Path $stateDir 'track-projects-context.pid'
    $bridge = $null
    if (Test-Path -LiteralPath $pidPath) {
        $candidate = [int](Get-Content -LiteralPath $pidPath)
        $candidateProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $candidate" -ErrorAction SilentlyContinue
        if ($candidateProcess -and $candidateProcess.Name -eq 'ssh.exe' -and $candidateProcess.CommandLine.Contains($socketTarget)) { $bridge = $candidateProcess }
    }
    $observed = Get-Content -LiteralPath $helper -Raw | ssh -o BatchMode=yes -o ConnectTimeout=10 pydemia-server python3 - probe
    if ($LASTEXITCODE -ne 0) { throw 'Private context socket probe failed.' }
    $socket = ($observed -join "`n") | ConvertFrom-Json
    if ($bridge) {
        if ($socket.socketState -eq 'active') { Write-Output 'Private Projects context socket ready.' }
        else { Write-Output 'Existing context SSH process remains active; socket will be checked again.' }
        return
    }
    if ($socket.socketState -eq 'active') { throw 'Unrecorded context socket listener preserved.' }
    $prepared = Get-Content -LiteralPath $helper -Raw | ssh -o BatchMode=yes -o ConnectTimeout=10 pydemia-server python3 - prepare
    if ($LASTEXITCODE -ne 0) { throw 'Private context socket preparation failed.' }
    $socket = ($prepared -join "`n") | ConvertFrom-Json
    if ($socket.socketState -notin @('absent', 'stale-removed')) { throw 'Context socket changed during preparation; listener preserved.' }
    $process = Start-Process -FilePath (Get-Command ssh.exe).Source -ArgumentList @('-N', '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ExitOnForwardFailure=yes', '-o', 'StreamLocalBindUnlink=no', '-o', 'StreamLocalBindMask=0177', '-o', 'ServerAliveInterval=20', '-o', 'ServerAliveCountMax=3', '-R', $socketTarget, 'pydemia-server') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $stateDir 'track-projects-context.stdout.log') -RedirectStandardError (Join-Path $stateDir 'track-projects-context.stderr.log')
    $process.Id | Set-Content -LiteralPath $pidPath
    Write-Output 'Private context SSH process started; readiness will be checked by the watcher.'
} finally { $bridgeMutex.ReleaseMutex(); $bridgeMutex.Dispose() }
