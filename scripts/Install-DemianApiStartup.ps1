param(
    [string]$StateRoot = (Join-Path $env:USERPROFILE '.local/share/agent-track'),
    [string]$ServiceState = (Join-Path $env:USERPROFILE '.demian/service'),
    [switch]$PrepareOnly,
    [switch]$RegisterPrepared
)
$ErrorActionPreference = 'Stop'
$taskName = 'Pydemia Demian API Only'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$source = Join-Path $repo 'deploy/demian'
$root = [IO.Path]::GetFullPath($StateRoot)
$serviceRoot = [IO.Path]::GetFullPath($ServiceState)
$planPath = Join-Path $root 'demian-api-startup.json'
$installedTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($installedTask) { throw 'Existing startup task preserved. Inspect it before replacing.' }
if ((Test-Path -LiteralPath $planPath) -and -not $RegisterPrepared) { throw 'Existing startup profile preserved. Use RegisterPrepared only after inspecting it.' }
if ($RegisterPrepared -and -not (Test-Path -LiteralPath $planPath)) { throw 'No prepared startup profile exists.' }
if ($root -match '["\x00-\x1f\x7f]' -or $serviceRoot -match '["\x00-\x1f\x7f]') { throw 'Invalid startup path.' }
$activePath = Join-Path $root 'demian-api-active.json'
if ((Get-Item -LiteralPath $activePath).Length -gt 131072) { throw 'Active record size limit.' }
$active = Get-Content -LiteralPath $activePath -Raw | ConvertFrom-Json
if ($active.state -ne 'active' -or $active.bundleSha256 -notmatch '^[a-f0-9]{64}$') { throw 'Verified active API record required.' }
$files = @('Start-Api.ps1','start-api.mjs','api-start-policy.mjs','windows-api-process.mjs','owned-child.mjs','write-api-record.ps1')
$operatorPins = [ordered]@{}
foreach ($name in $files) { $operatorPins[$name] = (Get-FileHash -LiteralPath (Join-Path $source $name) -Algorithm SHA256).Hash.ToLowerInvariant() }
$manifestBytes = [Text.Encoding]::UTF8.GetBytes(($operatorPins | ConvertTo-Json -Compress))
$hasher = [Security.Cryptography.SHA256]::Create()
try { $operatorId = [BitConverter]::ToString($hasher.ComputeHash($manifestBytes)).Replace('-', '').ToLowerInvariant() }
finally { $hasher.Dispose() }
$operator = Join-Path $root ('demian-api-operators/operator-' + $operatorId)
if (Test-Path -LiteralPath $operator) {
    foreach ($name in $files) { if ((Get-FileHash -LiteralPath (Join-Path $operator $name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $operatorPins[$name]) { throw 'Existing frozen operator differs; preserved.' } }
} else {
    New-Item -ItemType Directory -Path $operator | Out-Null
    foreach ($name in $files) { Copy-Item -LiteralPath (Join-Path $source $name) -Destination (Join-Path $operator $name) }
}
$profilePins = [ordered]@{}
foreach ($name in @('service.json','secrets.json')) { $profilePins[$name] = (Get-FileHash -LiteralPath (Join-Path $serviceRoot $name) -Algorithm SHA256).Hash.ToLowerInvariant() }
$plan = [ordered]@{
    version=1; ownerSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    executable=$active.process.executable
    executableSha256=(Get-FileHash -LiteralPath $active.process.executable -Algorithm SHA256).Hash.ToLowerInvariant()
    entry=$active.entry; bundleSha256=$active.bundleSha256
    repository=(Get-Content -LiteralPath (Join-Path $serviceRoot 'service.json') -Raw | ConvertFrom-Json).repository
    serviceState=$serviceRoot; profilePins=$profilePins; operatorDirectory=$operator; operatorFiles=$operatorPins
}
$encoding = New-Object Text.UTF8Encoding($false)
if ($RegisterPrepared) {
    $previous = Get-Content -LiteralPath $planPath -Raw | ConvertFrom-Json
    foreach ($name in @('version','ownerSid','executable','executableSha256','entry','bundleSha256','repository','serviceState','operatorDirectory')) {
        if ([string]$previous.$name -cne [string]$plan[$name]) { throw 'Prepared startup profile changed; preserved.' }
    }
    foreach ($name in $files) { if ($previous.operatorFiles.$name -ne $operatorPins[$name]) { throw 'Prepared operator changed; preserved.' } }
    foreach ($name in @('service.json','secrets.json')) { if ($previous.profilePins.$name -ne $profilePins[$name]) { throw 'Prepared service profile changed; preserved.' } }
} else {
    $stream = New-Object IO.FileStream($planPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $bytes = $encoding.GetBytes(($plan | ConvertTo-Json -Depth 8)); $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true) }
    finally { $stream.Dispose() }
}
$entry = Join-Path $operator 'Start-Api.ps1'
& powershell.exe -NoProfile -NonInteractive -File $entry -StateRoot $root -CheckOnly
if ($LASTEXITCODE -ne 0) { throw 'Prepared launcher failed read-only adoption check. No startup task registered.' }
if ($PrepareOnly) { Write-Output 'API-only startup prepared and current API reused; task registration deferred.'; return }
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -File "' + $entry + '" -StateRoot "' + $root + '"'
$action = New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe') -Argument $arguments -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $plan.ownerSid
$principal = New-ScheduledTaskPrincipal -UserId $plan.ownerSid -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -RestartInterval (New-TimeSpan -Minutes 1) -RestartCount 3 -ExecutionTimeLimit ([TimeSpan]::Zero)
# Create-only: no -Force and no existing user's task replaced.
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Reuse or start the pinned loopback Demian API only. Does not start Docker, Web, worker, or model execution.' | Out-Null
Write-Output 'Current-user API-only logon task registered; no password stored. Current API preserved.'
