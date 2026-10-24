@echo off
REM Opens BullScope in your browser with live news. Close this window to stop it.
cd /d "%~dp0"
python serve.py
pause
