@echo off
rem 2026-10-15 23:10 KST: CodexCode - launch the PC capture console.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Open-KvmConsole.ps1" %*
if errorlevel 1 pause
