@echo off
cd /d "%~dp0server"
set NODE_ENV=production
node dist\index.js
if errorlevel 1 pause
