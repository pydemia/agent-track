param([Parameter(Mandatory=$true)][string]$Target)
$ErrorActionPreference = 'Stop'
$stream = New-Object System.IO.FileStream($Target, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
try { [Console]::Out.WriteLine('locked'); [Console]::Out.Flush(); $null=[Console]::ReadLine() }
finally { $stream.Dispose() }
