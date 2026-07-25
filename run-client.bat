@echo off
cd /d "%~dp0"
set NODE_ENV=production
set API_PORT=4000
set CLIENT_PORT=3000
node serve-client.cjs
if errorlevel 1 pause
