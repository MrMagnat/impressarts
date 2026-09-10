@echo off
title Impress - сервер

rem Открывает консоль сервера сразу в папке проекта.
rem Работает после разовой настройки: ops\win\impress-ssh-setup.cmd
rem Пароль не спрашивается - вход по ключу.

ssh -t impress "cd /opt/impressarts-main; exec bash"
if errorlevel 1 pause
