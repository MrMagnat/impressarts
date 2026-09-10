@echo off
title Impress server

rem Opens the server console straight in the project directory.
rem Works after the one-time setup: impress-setup.cmd
rem No password is asked - login is by SSH key.

ssh -t impress "cd /opt/impressarts-main; exec bash"
if errorlevel 1 pause
