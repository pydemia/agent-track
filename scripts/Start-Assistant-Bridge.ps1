$ErrorActionPreference = 'Stop'
$bridgeMutex = New-Object System.Threading.Mutex($false, 'Local\Pydemia.AgentTrack.AssistantBridge')
if (-not $bridgeMutex.WaitOne(10000)) { throw 'Assistant bridge start is already in progress.' }
try {
    $stateDir = Join-Path $env:USERPROFILE '.local/share/agent-track/assistant-native'
    if (-not (Test-Path -LiteralPath (Join-Path $stateDir 'client.json'))) { return }
    $recordPath = Join-Path $stateDir 'forward.process.json'
    $forwardSpec = '127.0.0.1:14418:127.0.0.1:14318'
    $bridge = $null
    if (Test-Path -LiteralPath $recordPath) {
        $record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
        if ($record.version -ne 1 -or $record.forward -ne $forwardSpec -or $record.hostAlias -ne 'pydemia-server') {
            throw 'Assistant bridge ownership record differs; existing process preserved.'
        }
        $observed = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$record.processId)" -ErrorAction SilentlyContinue
        if ($observed) {
            if ($observed.Name -ne 'ssh.exe' -or
                $observed.CreationDate.ToUniversalTime().Ticks -ne ([DateTimeOffset]$record.createdAt).UtcDateTime.Ticks -or
                -not [StringComparer]::OrdinalIgnoreCase.Equals($observed.ExecutablePath, $record.executable) -or
                -not $observed.CommandLine.Contains($forwardSpec) -or
                -not $observed.CommandLine.EndsWith('pydemia-server')) {
                throw 'Assistant bridge process ownership changed; process preserved.'
            }
            $bridge = $observed
        }
    }
    $listeners = @(Get-NetTCPConnection -LocalPort 14418 -State Listen -ErrorAction SilentlyContinue)
    if ($listeners.Count -gt 0) {
        if (-not $bridge -or $listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne '127.0.0.1' -or $listeners[0].OwningProcess -ne $bridge.ProcessId) {
            throw 'Unrecorded Assistant listener preserved.'
        }
        Write-Output 'Private Assistant loopback bridge ready; reader authentication is separate.'
        return
    }
    if ($bridge) { Write-Output 'Existing Assistant SSH process is connecting; preserved for the next check.'; return }
    $process = Start-Process -FilePath (Get-Command ssh.exe).Source -ArgumentList @('-N', '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=20', '-o', 'ServerAliveCountMax=3', '-L', $forwardSpec, 'pydemia-server') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $stateDir 'forward.stdout.log') -RedirectStandardError (Join-Path $stateDir 'forward.stderr.log')
    $observed = Get-CimInstance Win32_Process -Filter "ProcessId = $($process.Id)" -ErrorAction Stop
    if (-not $observed -or $observed.Name -ne 'ssh.exe' -or -not $observed.CommandLine.Contains($forwardSpec)) { throw 'Assistant SSH startup could not establish ownership.' }
    $record = @{version=1;processId=$process.Id;createdAt=$observed.CreationDate.ToUniversalTime().ToString('o');executable=$observed.ExecutablePath;forward=$forwardSpec;hostAlias='pydemia-server'}
    [IO.File]::WriteAllText($recordPath, ($record | ConvertTo-Json))
    for ($attempt = 0; $attempt -lt 15; $attempt++) {
        $process.Refresh()
        if ($process.HasExited) { throw 'Assistant SSH startup failed; inspect its private log.' }
        $listeners = @(Get-NetTCPConnection -LocalPort 14418 -State Listen -ErrorAction SilentlyContinue)
        if ($listeners.Count -eq 1 -and $listeners[0].LocalAddress -eq '127.0.0.1' -and $listeners[0].OwningProcess -eq $process.Id) {
            Write-Output 'Private Assistant loopback bridge ready; reader authentication is separate.'
            return
        }
        Start-Sleep -Milliseconds 200
    }
    Write-Output 'Assistant SSH process remains active; listener will be checked again.'
} finally { $bridgeMutex.ReleaseMutex(); $bridgeMutex.Dispose() }
