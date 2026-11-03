@echo off
REM Importador FactPOS (portable). Doble clic. Si la computadora no tiene Node, baja una copia portable a esta misma carpeta
REM (no instala nada en Windows y se puede borrar la carpeta "node" cuando quiera).
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
  node app.mjs
  goto fin
)
if not exist "node\node.exe" (
  echo Descargando Node portable ^(una sola vez^)...
  powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest 'https://nodejs.org/dist/v20.18.1/node-v20.18.1-win-x64.zip' -OutFile node.zip; Expand-Archive node.zip -DestinationPath nodetmp -Force; Move-Item (Get-ChildItem nodetmp)[0].FullName node -Force; Remove-Item node.zip, nodetmp -Recurse -Force"
)
if not exist "node\node.exe" (
  echo No se pudo descargar Node. Revise la conexion a internet o instale Node desde nodejs.org
  pause
  exit /b 1
)
"node\node.exe" app.mjs
:fin
pause
