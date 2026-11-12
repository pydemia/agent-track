param(
    [Parameter(Mandatory=$true)][string]$Target,
    [Parameter(Mandatory=$true)][string]$Payload,
    [Parameter(Mandatory=$true)][string]$ExpectedSha256,
    [ValidateSet('after-stage','after-replace')][string]$TestPause
)
$ErrorActionPreference = 'Stop'
$lock = $null
$staged = $null
$hasher = [Security.Cryptography.SHA256]::Create()
try {
    if ($env:OS -ne 'Windows_NT' -or -not [IO.Path]::IsPathRooted($Target) -or -not [IO.Path]::IsPathRooted($Payload) -or $ExpectedSha256 -notmatch '^[a-f0-9]{64}$') { throw 'Invalid record write.' }
    $fullTarget = [IO.Path]::GetFullPath($Target)
    $parent = [IO.Path]::GetDirectoryName($fullTarget)
    if ($TestPause) {
        $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
        if ($env:AGENT_TRACK_API_RECORD_TEST -ne '1' -or -not $fullTarget.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($parent) -notmatch '^demian-api-atomic-[a-zA-Z0-9]+$') { throw 'Fault injection restricted to owned temporary fixture.' }
    }
    foreach ($file in @($Target,$Payload)) {
        $item = Get-Item -LiteralPath $file
        if ($item.PSIsContainer -or $item.Length -gt 131072 -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Record size or link mismatch.' }
    }
    # All API record writers share this stable OS lock. The data file itself is
    # never truncated: a process interruption leaves either complete version.
    $lock = New-Object IO.FileStream(($fullTarget + '.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    $previous = [IO.File]::ReadAllBytes($fullTarget)
    $actual = [BitConverter]::ToString($hasher.ComputeHash($previous)).Replace('-', '').ToLowerInvariant()
    if ($actual -ne $ExpectedSha256) { throw 'Record changed independently.' }
    $bytes = [IO.File]::ReadAllBytes($Payload)
    # Both old and new records must be complete JSON before publication.
    [Text.Encoding]::UTF8.GetString($previous) | ConvertFrom-Json | Out-Null
    [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json | Out-Null
    $staged = Join-Path $parent ('.' + [IO.Path]::GetFileName($fullTarget) + '.' + [Guid]::NewGuid().ToString('N') + '.new')
    $stream = New-Object IO.FileStream($staged, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true) } finally { $stream.Dispose() }
    if ($TestPause -eq 'after-stage') { [Console]::Out.WriteLine('{"phase":"staged"}'); [Console]::Out.Flush(); while ($true) { Start-Sleep -Seconds 1 } }
    # A non-null backup path also avoids Windows PowerShell converting a null
    # string argument into an invalid empty backup filename. Preserve the last
    # complete record beside this attempt's payload for private recovery.
    $backup = Join-Path ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($Payload))) ('.' + [IO.Path]::GetFileName($fullTarget) + '.' + [Guid]::NewGuid().ToString('N') + '.previous')
    [IO.File]::Replace($staged, $fullTarget, $backup)
    $staged = $null
    if ($TestPause -eq 'after-replace') { [Console]::Out.WriteLine('{"phase":"replaced"}'); [Console]::Out.Flush(); while ($true) { Start-Sleep -Seconds 1 } }
    @{updated=$true;sha256=[BitConverter]::ToString($hasher.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant()} | ConvertTo-Json -Compress
} catch {
    Write-Output '{"updated":false}'
    exit 1
} finally {
    if ($lock) { $lock.Dispose() }
    $hasher.Dispose()
    if ($staged -and [IO.File]::Exists($staged)) { [IO.File]::Delete($staged) }
}
