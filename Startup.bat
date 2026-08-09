@echo off
setlocal

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Startup.ps1" %*
exit /b %ERRORLEVEL%
