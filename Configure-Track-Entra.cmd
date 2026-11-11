@echo off
echo Paste the Agent Track client secret Value when prompted. Input is hidden.
ssh -t pydemia-server "python3 ~/.local/share/agent-track-sso/configure.py track 4d28c8bb-ab49-489e-aa85-b0934479620b"
pause
