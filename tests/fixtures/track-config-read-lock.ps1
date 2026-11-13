param([Parameter(Mandatory=$true)][string]$Root, [Parameter(Mandatory=$true)][string]$Node)
$ErrorActionPreference = 'Stop'
$resolvedRoot = [System.IO.Path]::GetFullPath($Root)
$target = [System.IO.Path]::GetFullPath((Join-Path $resolvedRoot 'config.json'))
$replacement = [System.IO.Path]::GetFullPath((Join-Path $resolvedRoot 'replacement.json'))
if ([System.IO.Path]::GetDirectoryName($target) -cne $resolvedRoot -or [System.IO.Path]::GetDirectoryName($replacement) -cne $resolvedRoot) { throw 'Fixture path escaped.' }
$original = [System.IO.File]::ReadAllText($target)
[System.IO.File]::WriteAllText($replacement, 'replacement')
$guard = [System.IO.File]::Open($target, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
try {
    if ([System.IO.File]::ReadAllText($target) -cne $original) { throw 'Fixture read failed.' }
    & $Node '-e' "require('node:fs').readFileSync(process.argv[1])" $target
    if ($LASTEXITCODE -ne 0) { throw 'Node phase reader failed.' }
    $writeDenied = $false
    try { [System.IO.File]::WriteAllText($target, 'foreign write') } catch [System.IO.IOException] { $writeDenied = $true }
    $replaceDenied = $false
    try { [System.IO.File]::Replace($replacement, $target, [NullString]::Value) } catch [System.IO.IOException] { $replaceDenied = $true }
    if (-not $writeDenied -or -not $replaceDenied -or [System.IO.File]::ReadAllText($target) -cne $original) { throw 'Config startup guard failed.' }
} finally { $guard.Dispose() }
[System.IO.File]::Replace($replacement, $target, [NullString]::Value)
if ([System.IO.File]::ReadAllText($target) -cne 'replacement') { throw 'Replace after release failed.' }
[System.IO.File]::WriteAllText($target, 'after guard')
@{nodeReaderAllowed=$true;writeDenied=$writeDenied;replaceDenied=$replaceDenied;guardReleased=$true} | ConvertTo-Json -Compress
