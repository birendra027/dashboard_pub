@echo off
setlocal
title PlugBoard (launcher)
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

REM --- Update to the latest published build (only if this is a git clone) ---
if not exist "%~dp0.git" goto UPDATE_DONE
where git >nul 2>nul
if errorlevel 1 goto UPDATE_DONE
echo Checking for updates...
pushd "%~dp0"
git fetch --quiet origin main
if not errorlevel 1 git reset --hard origin/main --quiet
popd
:UPDATE_DONE

echo Preparing configuration...
node prepare.cjs
if errorlevel 1 ( pause ^& exit /b 1 )

fc "%~dp0VERSION" "%~dp0.installed_version" >nul 2>&1
if not errorlevel 1 goto SETUP_DONE
echo.
echo === Installing / updating dependencies (needs internet) ===
pushd "%~dp0server"
echo Installing server dependencies...
call npm install --omit=dev
if errorlevel 1 ( echo Server dependency install failed. ^& popd ^& pause ^& exit /b 1 )
echo Syncing the database...
call npm run db:setup
if errorlevel 1 ( echo Database setup failed. ^& popd ^& pause ^& exit /b 1 )
popd

REM Runtime deps for any bundled plugin sub-app (only when missing).
for /d %%P in ("%~dp0plugins\*") do (
  if exist "%%P\app\package.json" if not exist "%%P\app\node_modules" (
    echo Installing dependencies for plugin app %%~nxP...
    pushd "%%P\app"
    call npm ci --omit=dev
    if errorlevel 1 call npm install --omit=dev
    popd
  )
)
copy /y "%~dp0VERSION" "%~dp0.installed_version" >nul
:SETUP_DONE

echo.
echo Starting PlugBoard...
start "PlugBoard API" /min "%~dp0run-server.bat"
start "PlugBoard UI" /min "%~dp0run-client.bat"

echo Waiting for the services to come up...
timeout /t 5 /nobreak >nul
start "" "http://localhost:3000"

echo.
echo   PlugBoard is running:  http://localhost:3000
echo   Two minimized windows (API + UI) are the running services.
echo   Close both to stop PlugBoard.
echo.
pause
