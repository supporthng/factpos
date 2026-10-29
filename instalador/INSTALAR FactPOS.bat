@echo off
REM FactPOS - Instalador. Doble clic aqui y elija que instalar en esta computadora.
chcp 65001 >nul
title FactPOS - Instalador
cd /d "%~dp0"
set "PS1=%~dp0instalador\instalar.ps1"
if not exist "%PS1%" set "PS1=%~dp0instalar.ps1"
if not exist "%PS1%" (
  echo No encuentro instalar.ps1. Descomprima el ZIP completo y abra este archivo desde esa carpeta.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
