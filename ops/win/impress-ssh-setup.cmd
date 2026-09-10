@echo off
setlocal
title Impress - настройка входа на сервер без пароля

rem ---------------------------------------------------------------------------
rem Разовая настройка. Создаёт SSH-ключ, кладёт его на сервер (пароль спросят
rem ОДИН раз - его вводит сам ssh, скрипт пароль не видит и никуда не пишет),
rem заводит короткое имя "impress" и создаёт ярлык на рабочем столе.
rem После этого вход на сервер - двойной клик, без логина и пароля.
rem
rem Файл сохранён в кодировке CP866: не пересохраняйте его в UTF-8, иначе
rem русский текст в консоли превратится в кракозябры.
rem ---------------------------------------------------------------------------

set "ALIAS=impress"
set "KEY=%USERPROFILE%\.ssh\id_ed25519_impress"
set "CFG=%USERPROFILE%\.ssh\config"
set "REMOTEDIR=/opt/impressarts-main"

echo.
echo ===============================================
echo   Настройка входа на сервер Impress без пароля
echo ===============================================
echo.

where ssh >nul 2>&1
if errorlevel 1 (
    echo [ОШИБКА] На этом компьютере нет клиента OpenSSH.
    echo          Установите: Параметры - Приложения - Дополнительные компоненты
    echo          - Добавить компонент - "Клиент OpenSSH".
    echo.
    pause
    exit /b 1
)

set "SRVIP="
set "SRVUSER="
set /p SRVIP=IP сервера, например 192.168.233.2:
set /p SRVUSER=Логин на сервере:

if "%SRVIP%"=="" goto :empty
if "%SRVUSER%"=="" goto :empty

if not exist "%USERPROFILE%\.ssh" mkdir "%USERPROFILE%\.ssh"

echo.
if exist "%KEY%" (
    echo [1/4] Ключ уже есть, создавать заново не нужно.
) else (
    echo [1/4] Создаю SSH-ключ...
    ssh-keygen -t ed25519 -C "impress-dashboard" -f "%KEY%" -N "" >nul
    if errorlevel 1 (
        echo [ОШИБКА] Не удалось создать ключ.
        pause
        exit /b 1
    )
    echo       Готово: %KEY%
)

echo.
echo [2/4] Копирую ключ на сервер. Сейчас спросят пароль - ОДИН раз.
echo.
type "%KEY%.pub" | ssh -o StrictHostKeyChecking=accept-new %SRVUSER%@%SRVIP% "umask 077; mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys; sort -u -o ~/.ssh/authorized_keys ~/.ssh/authorized_keys; chmod 700 ~/.ssh; chmod 600 ~/.ssh/authorized_keys; echo KEY_INSTALLED"
if errorlevel 1 (
    echo.
    echo [ОШИБКА] Не удалось скопировать ключ. Проверьте IP, логин и пароль.
    pause
    exit /b 1
)

echo.
echo [3/4] Прописываю короткое имя "%ALIAS%"...
findstr /b /c:"Host %ALIAS%" "%CFG%" >nul 2>&1
if errorlevel 1 (
    >>"%CFG%" echo.
    >>"%CFG%" echo Host %ALIAS%
    >>"%CFG%" echo HostName %SRVIP%
    >>"%CFG%" echo User %SRVUSER%
    >>"%CFG%" echo IdentityFile %KEY:\=/%
    >>"%CFG%" echo IdentitiesOnly yes
    >>"%CFG%" echo ServerAliveInterval 30
    echo       Добавлено в %CFG%
) else (
    echo       Уже прописано, пропускаю.
    echo       Если сменился IP - поправьте HostName в %CFG%
)

echo.
echo [4/4] Кладу ярлык на рабочий стол...
set "DESKTOP=%USERPROFILE%\Desktop"
if not exist "%DESKTOP%" if defined OneDrive if exist "%OneDrive%\Desktop" set "DESKTOP=%OneDrive%\Desktop"
set "LAUNCHER=%DESKTOP%\Impress сервер.cmd"

>"%LAUNCHER%" echo @echo off
>>"%LAUNCHER%" echo title Impress server
>>"%LAUNCHER%" echo ssh -t %ALIAS% "cd %REMOTEDIR%; exec bash"
>>"%LAUNCHER%" echo if errorlevel 1 pause
echo       Создан: %LAUNCHER%

echo.
echo Проверяю вход без пароля...
ssh -o BatchMode=yes -o ConnectTimeout=10 %ALIAS% "echo УСПЕХ: вошли как $(whoami) на $(hostname)"
if errorlevel 1 (
    echo.
    echo [ВНИМАНИЕ] Вход по ключу не сработал. Обычные причины:
    echo            - на сервере в /etc/ssh/sshd_config выключен PubkeyAuthentication;
    echo            - слишком широкие права на домашнем каталоге сервера.
    echo            Проверьте на сервере: ls -ld ~ ~/.ssh
) else (
    echo.
    echo Всё готово. Дальше - двойной клик по ярлыку "Impress сервер".
)

echo.
pause
exit /b 0

:empty
echo.
echo [ОШИБКА] IP и логин обязательны.
pause
exit /b 1
