@echo off
setlocal
title Impress dashboard - local setup

rem ---------------------------------------------------------------------------
rem One-time local setup on a Windows machine, without Docker.
rem Installs dependencies, builds the frontend and the server, seeds the
rem database from data\seed\demo.xlsx, and creates start.cmd next to itself.
rem
rem Run it from the project folder (the one containing package.json).
rem ASCII only on purpose - encoding never matters.
rem ---------------------------------------------------------------------------

cd /d "%~dp0..\.."

echo.
echo ==============================================
echo   Impress dashboard - local setup (no Docker)
echo ==============================================
echo.

if not exist "package.json" (
    echo [ERROR] package.json not found in %CD%
    echo         Put this script in ops\win\ inside the project folder.
    pause
    exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed.
    echo         Download the LTS installer from https://nodejs.org - version 22 or newer,
    echo         and run this script again.
    pause
    exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODEMAJOR=%%v
echo Node.js version: & node -v
if %NODEMAJOR% LSS 22 (
    echo.
    echo [ERROR] Node.js 22 or newer is required - the app uses the built-in
    echo         SQLite module that older versions do not have.
    pause
    exit /b 1
)

rem Chromium for PDF export is optional: skip the 150 MB download, the app
rem falls back to a printable HTML page when it is missing.
set PUPPETEER_SKIP_DOWNLOAD=1

echo.
echo [1/4] Installing dependencies (a few minutes on first run)...
call npm install --no-audit --no-fund
if errorlevel 1 (
    echo [ERROR] npm install failed. Check the network or proxy settings.
    pause
    exit /b 1
)

echo.
echo [2/4] Building frontend and server...
call npm run build
if errorlevel 1 (
    echo [ERROR] build failed.
    pause
    exit /b 1
)

echo.
echo [3/4] Preparing the database...
if exist "data\sklad.db" (
    echo       Database already exists, keeping it.
) else (
    if exist "data\seed\demo.xlsx" (
        call npm run etl
        if errorlevel 1 echo [WARNING] seeding failed - the app will start with an empty database.
    ) else (
        echo       data\seed\demo.xlsx not found - starting with an empty database.
        echo       Load real data later from Settings - 1C source.
    )
)

echo.
echo [4/4] Creating start.cmd...
>"start.cmd" echo @echo off
>>"start.cmd" echo title Impress dashboard
>>"start.cmd" echo cd /d "%%~dp0"
>>"start.cmd" echo set LICENSE_REQUIRED=false
>>"start.cmd" echo set PORT=3000
>>"start.cmd" echo set HOST=0.0.0.0
>>"start.cmd" echo echo Dashboard: http://localhost:3000
>>"start.cmd" echo echo Press Ctrl+C to stop.
>>"start.cmd" echo call npm start
>>"start.cmd" echo pause
echo       Created: %CD%\start.cmd

echo.
echo ==============================================
echo   Done. Start the dashboard with start.cmd
echo   Then open http://localhost:3000
echo   Default password: demo
echo ==============================================
echo.
pause
exit /b 0
