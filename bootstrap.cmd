@echo off
cd /d "%~dp0"
REM --- Ensure Node.js is present, installing it if necessary ---
where node >nul 2>nul
if not errorlevel 1 goto NODE_OK
net session >nul 2>&1
if %errorlevel%==0 goto NODE_INSTALL
echo.
echo   Node.js needs to be installed - this requires administrator permission.
echo   Please approve the prompt that appears...
powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
exit /b
:NODE_INSTALL
where winget >nul 2>nul
if errorlevel 1 goto NODE_MSI
echo Installing Node.js LTS via winget...
winget install -e --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>nul
if not errorlevel 1 goto NODE_OK
:NODE_MSI
echo Downloading the Node.js LTS installer...
set "NODE_MSI=%PUBLIC%\node-lts-x64.msi"
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.18.1/node-v20.18.1-x64.msi' -OutFile $env:NODE_MSI -UseBasicParsing } catch { exit 1 }"
if not exist "%NODE_MSI%" ( echo   Could not download Node.js. Install it from https://nodejs.org ^& pause ^& exit /b 1 )
powershell -NoProfile -Command "Start-Process msiexec -ArgumentList '/i',$env:NODE_MSI,'/qn','/norestart' -Verb RunAs -Wait"
del "%NODE_MSI%" >nul 2>nul
set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>nul
if not errorlevel 1 goto NODE_OK
echo   Node.js was installed but this window can't see it yet.
echo   Please close this window and run Start-PlugBoard.bat again.
pause
exit /b 0
:NODE_OK
for /f "tokens=*" %%v in ('node -v') do echo Node.js detected ^(%%v^).
node "%~dp0launcher.cjs" %*
