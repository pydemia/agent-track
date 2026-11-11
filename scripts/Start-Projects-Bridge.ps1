$ErrorActionPreference = 'Stop'
$bridgeMutex = New-Object System.Threading.Mutex($false, 'Local\Pydemia.AgentTrack.ProjectsBridge')
if (-not $bridgeMutex.WaitOne(10000)) { throw 'Projects bridge start is already in progress.' }
try {
    $stateDir = Join-Path $env:USERPROFILE '.local/share/agent-track'
    $bridgePidPath = Join-Path $stateDir 'track-projects-forward.pid'
    $bridge = $null
    if (Test-Path -LiteralPath $bridgePidPath) {
        $candidate = [int](Get-Content -LiteralPath $bridgePidPath)
        $bridge = Get-CimInstance Win32_Process -Filter "ProcessId = $candidate" -ErrorAction SilentlyContinue
        if ($bridge -and ($bridge.Name -ne 'ssh.exe' -or $bridge.CommandLine -notlike '*14349:127.0.0.1:14324*')) { $bridge = $null }
    }
    $listeners = @(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 14349 -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -gt 0) {
        if (-not $bridge -or $listeners.Count -ne 1 -or $listeners[0].OwningProcess -ne $bridge.ProcessId) {
            throw 'Unrecorded Projects listener preserved.'
        }
        Write-Output 'Private Projects read bridge ready.'
        return
    }
    if ($bridge) { Write-Output 'Existing Projects SSH process is connecting; preserved for the next check.'; return }
    $process = Start-Process -FilePath (Get-Command ssh.exe).Source -ArgumentList @('-N', '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=20', '-o', 'ServerAliveCountMax=3', '-L', '127.0.0.1:14349:127.0.0.1:14324', 'pydemia-server') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $stateDir 'track-projects-forward.stdout.log') -RedirectStandardError (Join-Path $stateDir 'track-projects-forward.stderr.log')
    for ($attempt = 0; $attempt -lt 15; $attempt++) {
        $process.Refresh()
        if ($process.HasExited) { throw 'Projects SSH startup failed; inspect its private log.' }
        $listeners = @(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 14349 -State Listen -ErrorAction SilentlyContinue)
        if ($listeners.Count -eq 1 -and $listeners[0].OwningProcess -eq $process.Id) {
            $process.Id | Set-Content -LiteralPath $bridgePidPath
            Write-Output 'Private Projects read bridge ready.'
            return
        }
        Start-Sleep -Milliseconds 200
    }
    # Keep the verified live handle so a transient SSH connection cannot cause duplicates.
    $process.Id | Set-Content -LiteralPath $bridgePidPath
    Write-Output 'Projects SSH process remains active; listener will be checked again.'
} finally { $bridgeMutex.ReleaseMutex(); $bridgeMutex.Dispose() }
