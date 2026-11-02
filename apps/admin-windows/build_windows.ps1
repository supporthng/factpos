$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
py -3 -m venv .venv
& ".\.venv\Scripts\python.exe" -m pip install --upgrade pip
& ".\.venv\Scripts\python.exe" -m pip install -r requirements.txt
& ".\.venv\Scripts\python.exe" -m PyInstaller --noconfirm --clean --windowed --name FactPOSAdmin `
    --icon factpos.ico --collect-all webview --collect-all clr_loader --hidden-import clr admin.py
if (-not (Test-Path ".\dist\FactPOSAdmin\FactPOSAdmin.exe")) { throw "No se generó FactPOSAdmin.exe" }
Write-Host "App creada: $PSScriptRoot\dist\FactPOSAdmin"
