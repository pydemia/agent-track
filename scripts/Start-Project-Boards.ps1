$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$gitRoot = Split-Path -Parent $repoRoot
$stateDir = Join-Path $env:USERPROFILE '.local/share/agent-track'
$entry = Join-Path $gitRoot 'agenttrail/bin/agenttrail.mjs'
$nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
$config = Get-Content -LiteralPath (Join-Path $repoRoot 'deploy/trail-projects.json') -Raw | ConvertFrom-Json
$names = @{}
$ports = @{}
foreach ($project in $config.projects) {
    if ($project.name -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_-]*$') { throw 'Invalid project directory name.' }
    if ($names.ContainsKey($project.name) -or $ports.ContainsKey([int]$project.port)) { throw 'Duplicate project or port.' }
    if ($project.port -lt 5330 -or $project.port -gt 5344 -or $project.port -eq 5332) { throw 'Port must fit the native discovery range and exclude the gateway.' }
    $names[$project.name] = $true
    $ports[[int]$project.port] = $true
    if (-not (Test-Path -LiteralPath (Join-Path $gitRoot $project.name) -PathType Container)) { throw "Project directory missing: $($project.name)" }
}
foreach ($project in $config.projects) {
    $projectPath = Join-Path $gitRoot $project.name
    $url = "http://127.0.0.1:$($project.port)"
    $who = $null
    try { $who = Invoke-RestMethod "$url/whoami" -TimeoutSec 2 } catch {}
    if ($who -and $who.repoPath -ne $projectPath) { throw "Port $($project.port) belongs to another project." }
    if (-not $who) {
        try {
            $probe = Invoke-WebRequest "$url/" -UseBasicParsing -TimeoutSec 1
            throw "Port $($project.port) is occupied."
        } catch {
            if ($_.Exception.Response -or $_.Exception.Message -like '*is occupied*') { throw }
        }
        $arguments = @(('"' + $entry + '"'), ('"' + $projectPath + '"'), '--port', [string]$project.port, '--no-open')
        $child = Start-Process -FilePath $nodeExe -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $stateDir "$($project.name)-board.stdout.log") -RedirectStandardError (Join-Path $stateDir "$($project.name)-board.stderr.log")
        for ($attempt = 0; $attempt -lt 40; $attempt++) {
            try { $who = Invoke-RestMethod "$url/whoami" -TimeoutSec 1; break } catch { Start-Sleep -Milliseconds 150 }
        }
        if (-not $who -or $who.repoPath -ne $projectPath -or $who.port -ne $project.port) { throw "Board failed to bind the expected port: $($project.name)" }
        $child.Id | Set-Content -LiteralPath (Join-Path $stateDir "$($project.name)-board.pid")
    }
    Write-Output "$($project.name): $url"
}
