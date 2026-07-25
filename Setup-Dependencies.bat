@echo off
title PlugBoard - Setup
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 ( echo Install Node.js 20+ from https://nodejs.org first. ^& pause ^& exit /b 1 )
node prepare.cjs
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
echo Done. Use Start-PlugBoard.bat to run.
pause
