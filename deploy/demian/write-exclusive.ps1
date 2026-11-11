param([Parameter(Mandatory=$true)][string]$Target, [Parameter(Mandatory=$true)][string]$Payload, [string]$ExpectedSha256, [switch]$ExpectedMissing, [switch]$TestFailAfterWrite)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This native metadata writer requires Windows file sharing locks.' }
if (-not [System.IO.Path]::IsPathRooted($Target) -or -not [System.IO.Path]::IsPathRooted($Payload)) { throw 'Absolute owned paths are required.' }
$bytes = [System.IO.File]::ReadAllBytes($Payload)
if ($bytes.Length -gt 2097152) { throw 'Native metadata payload limit.' }
if ($TestFailAfterWrite) {
    $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    $fullTarget = [System.IO.Path]::GetFullPath($Target)
    if ($env:AGENT_TRACK_METADATA_TEST -ne '1' -or -not $fullTarget.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -or -not ([System.IO.Path]::GetDirectoryName($fullTarget) -match 'demian-exclusive-metadata-[^\\]+$')) { throw 'Fault injection is restricted to owned temporary fixtures.' }
}
$stream = $null
$newFile = $null
$mutated = $false
$restored = $false
$hasher = [System.Security.Cryptography.SHA256]::Create()
try {
    if ($ExpectedMissing) {
        # Absence needs create-only publication, so never expose a partial target.
        $newFile = Join-Path ([System.IO.Path]::GetDirectoryName($Target)) ('.' + [System.IO.Path]::GetFileName($Target) + '.' + [Guid]::NewGuid().ToString('N') + '.new')
        $stream = New-Object System.IO.FileStream($newFile, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
        $stream.Write($bytes, 0, $bytes.Length)
        if ($TestFailAfterWrite) { throw 'Fixture failure after staged write.' }
        $stream.Flush($true)
        $stream.Dispose(); $stream = $null
        [System.IO.File]::Move($newFile, $Target)
    } else {
        $stream = New-Object System.IO.FileStream($Target, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
        if ($stream.Length -gt 2097152) { throw 'Native metadata input limit.' }
        $previous = New-Object byte[] ([int]$stream.Length)
        $offset = 0
        while ($offset -lt $previous.Length) { $count = $stream.Read($previous, $offset, $previous.Length - $offset); if ($count -le 0) { throw 'Incomplete native metadata read.' }; $offset += $count }
        $actual = [BitConverter]::ToString($hasher.ComputeHash($previous)).Replace('-', '').ToLowerInvariant()
        if ($actual -ne $ExpectedSha256) { throw 'Native metadata changed independently; preserved.' }
        try {
            $mutated = $true
            $stream.Position = 0
            $stream.Write($bytes, 0, $bytes.Length)
            $stream.SetLength($bytes.Length)
            if ($TestFailAfterWrite) { throw 'Fixture failure after target mutation.' }
            $stream.Flush($true)
        } catch {
            try {
                $stream.Position = 0
                $stream.Write($previous, 0, $previous.Length)
                $stream.SetLength($previous.Length)
                $stream.Flush($true)
                $restored = $true
            } catch { $restored = $false }
            throw 'Native write failed after mutation.'
        }
    }
    @{updated=$true;sha256=[BitConverter]::ToString($hasher.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant()} | ConvertTo-Json -Compress
} catch {
    @{updated=$false;targetMutated=$mutated;restored=$restored;restorationFailed=($mutated -and -not $restored)} | ConvertTo-Json -Compress
    exit 1
} finally {
    if ($stream) { $stream.Dispose() }
    $hasher.Dispose()
    if ($newFile -and [System.IO.File]::Exists($newFile)) { [System.IO.File]::Delete($newFile) }
}
