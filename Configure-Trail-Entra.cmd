@echo off
echo Paste the AgentTrail client secret Value when prompted. Input is hidden.
ssh -t pydemia-server "python3 ~/.local/share/agent-track-sso/configure.py trail 8e026114-f50c-454c-9d70-76490df3dfd0"
pause
