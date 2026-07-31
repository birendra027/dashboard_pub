@echo off
title PlugBoard - Setup
cd /d "%~dp0"
REM --- Ensure a supported Node.js is present, installing it if necessary ---
set "NODE_MIN=20"
set "NODE_MAJOR=0"
for /f "tokens=1 delims=." %%v in ('node -v 2^>nul') do set "NODE_MAJOR=%%v"
set "NODE_MAJOR=%NODE_MAJOR:v=%"
if %NODE_MAJOR% GEQ %NODE_MIN% goto NODE_OK
REM A supported Node may already be installed but shadowed on PATH by an older one.
set "PATH=%ProgramFiles%\nodejs;%PATH%"
set "NODE_MAJOR=0"
for /f "tokens=1 delims=." %%v in ('node -v 2^>nul') do set "NODE_MAJOR=%%v"
set "NODE_MAJOR=%NODE_MAJOR:v=%"
if %NODE_MAJOR% GEQ %NODE_MIN% goto NODE_OK
set "NODE_WHY=Node.js was not found"
if not "%NODE_MAJOR%"=="0" set "NODE_WHY=Node.js v%NODE_MAJOR% is too old (this app needs v%NODE_MIN% or newer)"
echo   %NODE_WHY% - installing the Node.js LTS build...
if not exist "%~dp0logs" mkdir "%~dp0logs" >nul 2>nul
>>"%~dp0logs\launcher.log" echo [node] %NODE_WHY% - installing the Node.js LTS build.
net session >nul 2>&1
if %errorlevel%==0 goto NODE_INSTALL
echo.
echo   Installing Node.js requires administrator permission.
echo   Please approve the prompt that appears...
powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
exit /b
:NODE_INSTALL
echo Downloading the pinned Node.js 20.18.1 (LTS) installer...
set "NODE_MSI=%PUBLIC%\node-lts-x64.msi"
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.18.1/node-v20.18.1-x64.msi' -OutFile $env:NODE_MSI -UseBasicParsing } catch { exit 1 }"
if not exist "%NODE_MSI%" ( echo   Could not download Node.js. Install it from https://nodejs.org ^& pause ^& exit /b 1 )
powershell -NoProfile -Command "Start-Process msiexec -ArgumentList '/i',$env:NODE_MSI,'/qn','/norestart' -Verb RunAs -Wait"
del "%NODE_MSI%" >nul 2>nul
set "PATH=%ProgramFiles%\nodejs;%PATH%"
set "NODE_MAJOR=0"
for /f "tokens=1 delims=." %%v in ('node -v 2^>nul') do set "NODE_MAJOR=%%v"
set "NODE_MAJOR=%NODE_MAJOR:v=%"
if %NODE_MAJOR% GEQ %NODE_MIN% goto NODE_OK
echo   Node.js was installed but this window can't see it yet.
echo   Please close this window and run Start-PlugBoard.bat again.
pause
exit /b 0
:NODE_OK
for /f "tokens=*" %%v in ('node -v') do echo Node.js detected ^(%%v^).
node "%~dp0launcher.cjs" setup
echo Done. Use Start-PlugBoard.vbs to run.
pause
