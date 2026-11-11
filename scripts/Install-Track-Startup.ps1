$ErrorActionPreference = 'Stop'
$watch = Join-Path $PSScriptRoot 'Watch-Track.ps1'
$startup = [Environment]::GetFolderPath('Startup')
$vbs = Join-Path $startup 'Agent Track.vbs'
$command = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + $watch + '"'
$script = 'CreateObject("WScript.Shell").Run "' + $command.Replace('"', '""') + '", 0, False'
[System.IO.File]::WriteAllText($vbs, $script, [System.Text.Encoding]::ASCII)
Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $watch + '"')) -WindowStyle Hidden | Out-Null
Write-Output 'Installed current-user Track watcher. Existing startup entries preserved.'
