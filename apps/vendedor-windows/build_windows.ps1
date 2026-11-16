$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
py -3 -m venv .venv
& ".\.venv\Scripts\python.exe" -m pip install --upgrade pip
& ".\.venv\Scripts\python.exe" -m pip install -r requirements.txt
& ".\.venv\Scripts\python.exe" -m PyInstaller --noconfirm --clean --windowed --name FactPOSVendedor `
    --icon factpos.ico --collect-all webview --collect-all clr_loader --hidden-import clr vendedor.py
if (-not (Test-Path ".\dist\FactPOSVendedor\FactPOSVendedor.exe")) { throw "No se generó FactPOSVendedor.exe" }
Write-Host "App creada: $PSScriptRoot\dist\FactPOSVendedor"
