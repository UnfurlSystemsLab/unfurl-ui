@echo off
setlocal

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Stop.ps1" %*
exit /b %ERRORLEVEL%
