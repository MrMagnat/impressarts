@echo off
setlocal
title Impress server - passwordless SSH setup

rem ---------------------------------------------------------------------------
rem One-time setup. Creates an SSH key, installs it on the server (the password
rem is asked ONCE, by ssh itself - this script never sees or stores it), adds a
rem short host alias "impress" and drops a launcher on the Desktop.
rem
rem ASCII only on purpose: the file can be pasted into Notepad and saved in any
rem encoding without breaking.
rem ---------------------------------------------------------------------------

set "ALIAS=impress"
set "KEY=%USERPROFILE%\.ssh\id_ed25519_impress"
set "CFG=%USERPROFILE%\.ssh\config"
set "REMOTEDIR=/opt/impressarts-main"

echo.
echo ==============================================
echo   Impress server - passwordless SSH setup
echo ==============================================
echo.

where ssh >nul 2>&1
if errorlevel 1 (
    echo [ERROR] OpenSSH client not found.
    echo         Install it: Settings - Apps - Optional features
    echo         - Add a feature - "OpenSSH Client".
    echo.
    pause
    exit /b 1
)

set "SRVIP="
set "SRVUSER="
set /p SRVIP=Server IP, for example 192.168.233.2:
set /p SRVUSER=Login on the server:

if "%SRVIP%"=="" goto :empty
if "%SRVUSER%"=="" goto :empty

if not exist "%USERPROFILE%\.ssh" mkdir "%USERPROFILE%\.ssh"

echo.
if exist "%KEY%" (
    echo [1/4] Key already exists, reusing it.
) else (
    echo [1/4] Creating SSH key...
    ssh-keygen -t ed25519 -C "impress-dashboard" -f "%KEY%" -N "" >nul
    if errorlevel 1 (
        echo [ERROR] Could not create the key.
        pause
        exit /b 1
    )
    echo       Done: %KEY%
)

echo.
echo [2/4] Installing the key on the server. Password will be asked ONCE.
echo.
type "%KEY%.pub" | ssh -o StrictHostKeyChecking=accept-new %SRVUSER%@%SRVIP% "umask 077; mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys; sort -u -o ~/.ssh/authorized_keys ~/.ssh/authorized_keys; chmod 700 ~/.ssh; chmod 600 ~/.ssh/authorized_keys; echo KEY_INSTALLED"
if errorlevel 1 (
    echo.
    echo [ERROR] Could not install the key. Check IP, login and password.
    pause
    exit /b 1
)

echo.
echo [3/4] Adding host alias "%ALIAS%"...
findstr /b /c:"Host %ALIAS%" "%CFG%" >nul 2>&1
if errorlevel 1 (
    >>"%CFG%" echo.
    >>"%CFG%" echo Host %ALIAS%
    >>"%CFG%" echo HostName %SRVIP%
    >>"%CFG%" echo User %SRVUSER%
    >>"%CFG%" echo IdentityFile %KEY:\=/%
    >>"%CFG%" echo IdentitiesOnly yes
    >>"%CFG%" echo ServerAliveInterval 30
    echo       Added to %CFG%
) else (
    echo       Already present, skipping.
    echo       If the IP changed - edit HostName in %CFG%
)

echo.
echo [4/4] Creating the Desktop launcher...
set "DESKTOP=%USERPROFILE%\Desktop"
if not exist "%DESKTOP%" if defined OneDrive if exist "%OneDrive%\Desktop" set "DESKTOP=%OneDrive%\Desktop"
set "LAUNCHER=%DESKTOP%\Impress server.cmd"

>"%LAUNCHER%" echo @echo off
>>"%LAUNCHER%" echo title Impress server
>>"%LAUNCHER%" echo ssh -t %ALIAS% "cd %REMOTEDIR%; exec bash"
>>"%LAUNCHER%" echo if errorlevel 1 pause
echo       Created: %LAUNCHER%

echo.
echo Testing passwordless login...
ssh -o BatchMode=yes -o ConnectTimeout=10 %ALIAS% "echo SUCCESS: logged in as $(whoami) on $(hostname)"
if errorlevel 1 (
    echo.
    echo [WARNING] Key login did not work. Usual reasons:
    echo           - PubkeyAuthentication disabled in /etc/ssh/sshd_config;
    echo           - home directory on the server is group/world writable.
    echo           Check on the server: ls -ld ~ ~/.ssh
) else (
    echo.
    echo All set. From now on: double-click "Impress server" on the Desktop.
)

echo.
pause
exit /b 0

:empty
echo.
echo [ERROR] IP and login are both required.
pause
exit /b 1
