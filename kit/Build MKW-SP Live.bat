@echo off
rem Builds MKW-SP Live from your own WiiCompiled install. See README.txt.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0files\build.ps1" %*
echo.
pause
