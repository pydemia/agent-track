@echo off
powershell.exe -NoProfile -Command "$c=Get-Content -Raw -LiteralPath (Join-Path $env:USERPROFILE '.local/share/agent-track/trail-credentials.json') | ConvertFrom-Json; Set-Clipboard -Value $c.password"
echo Password copied. Username: pydemia
pause
