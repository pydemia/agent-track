param([Parameter(Mandatory=$true)][string]$StateRoot, [switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$lock = $null
$previousLockOwner = $env:DEMIAN_API_STARTUP_LOCK_OWNER
try {
    if ($env:OS -ne 'Windows_NT' -or -not [IO.Path]::IsPathRooted($StateRoot)) { throw 'Invalid platform or state root.' }
    $root = [IO.Path]::GetFullPath($StateRoot)
    $configPath = Join-Path $root 'demian-api-startup.json'
    if ((Get-Item -LiteralPath $configPath).Length -gt 131072) { throw 'Startup profile size limit.' }
    $plan = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    if ($plan.version -ne 1 -or $plan.ownerSid -ne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) { throw 'Startup profile owner mismatch.' }
    if (-not [IO.Path]::IsPathRooted($plan.executable) -or -not [IO.Path]::IsPathRooted($plan.operatorDirectory)) { throw 'Absolute startup paths required.' }
    $operator = [IO.Path]::GetFullPath($plan.operatorDirectory)
    $operatorsRoot = [IO.Path]::GetFullPath((Join-Path $root 'demian-api-operators')) + [IO.Path]::DirectorySeparatorChar
    if (-not $operator.StartsWith($operatorsRoot, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFullPath($PSScriptRoot) -ne $operator) { throw 'Unexpected startup operator.' }
    foreach ($name in @('Start-Api.ps1','start-api.mjs','api-start-policy.mjs','windows-api-process.mjs','owned-child.mjs','write-api-record.ps1')) {
        $expected = $plan.operatorFiles.$name
        if ($expected -notmatch '^[a-f0-9]{64}$' -or (Get-FileHash -LiteralPath (Join-Path $operator $name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw 'Startup operator hash mismatch.' }
    }
    if ((Get-FileHash -LiteralPath $plan.executable -Algorithm SHA256).Hash.ToLowerInvariant() -ne $plan.executableSha256) { throw 'Node executable changed.' }
    # FileShare.None is held across sessions and released by the OS on a crash.
    $lock = New-Object IO.FileStream((Join-Path $root 'demian-api-startup.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    $env:DEMIAN_API_STARTUP_LOCK_OWNER = [string]$PID
    $arguments = @((Join-Path $operator 'start-api.mjs'), '--state-root', $root)
    if ($CheckOnly) { $arguments += '--check' }
    & $plan.executable @arguments
    $resultCode = $LASTEXITCODE
    if ($resultCode -ne 0) { throw 'API-only launcher failed.' }
} catch {
    Write-Output 'Demian API-only startup unavailable; existing services preserved.'
    exit 1
} finally {
    if ($null -ne $previousLockOwner) { $env:DEMIAN_API_STARTUP_LOCK_OWNER = $previousLockOwner }
    else { Remove-Item Env:/DEMIAN_API_STARTUP_LOCK_OWNER -ErrorAction SilentlyContinue }
    if ($lock) { $lock.Dispose() }
}
