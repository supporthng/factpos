$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
py -3 -m venv .venv
& ".\.venv\Scripts\python.exe" -m pip install --upgrade pip
& ".\.venv\Scripts\python.exe" -m pip install -r requirements.txt
# Carpeta (onedir): pywebview + pythonnet funcionan mejor así que en un solo .exe.
& ".\.venv\Scripts\python.exe" -m PyInstaller --noconfirm --clean --windowed --name FactPOSVerificador `
    --icon factpos.ico --add-data "config.html;." --collect-all webview --collect-all clr_loader --hidden-import clr kiosco.py
if (-not (Test-Path ".\dist\FactPOSVerificador\FactPOSVerificador.exe")) { throw "No se generó FactPOSVerificador.exe" }
Write-Host "App creada: $PSScriptRoot\dist\FactPOSVerificador"
