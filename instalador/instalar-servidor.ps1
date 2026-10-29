<#
  FactPOS · Instalador del SERVIDOR de la sucursal (Windows 10/11)

  Qué hace:
    1. Instala Node.js 22 y PostgreSQL 16 si faltan (con winget).
    2. Copia FactPOS a C:\FactPOS (o la carpeta que indique).
    3. Crea la base de datos con una clave aleatoria y escribe el archivo .env.
    4. Aplica las migraciones (y, si lo pide, los datos de demostración).
    5. Deja el servidor arrancando solo con Windows, reiniciándose si falla.
    6. Abre en el firewall solo para la red local: puerto del sistema, búsqueda
       de cajas (UDP 41234) y el nombre factpos.local (mDNS, UDP 5353).
    7. Le dice la dirección que deben abrir las cajas.

  Uso (PowerShell como Administrador, dentro de la carpeta descomprimida):
    powershell -ExecutionPolicy Bypass -File .\instalador\instalar-servidor.ps1
    ... -Demo                         # carga los datos de demostración
    ... -PinSecreto "su-secreto"      # el MISMO de la central y las demás sucursales
    ... -NombreRed factpos-norte      # si hay dos servidores en la misma red
    ... -CentralUrl https://su-proyecto.vercel.app -SucursalId <id> -CentralClave <clave>
                                      # conecta esta sucursal con la nube (los datos
                                      # salen en Administración > Sucursales > "Conectar su servidor")
#>
#Requires -RunAsAdministrator
param(
  [string]$Carpeta = "C:\FactPOS",
  [int]$Puerto = 3000,
  [string]$NombreRed = "factpos",
  [string]$PinSecreto = "",
  [string]$ClavePostgres = "",
  [string]$CentralUrl = "",
  [string]$SucursalId = "",
  [string]$CentralClave = "",
  [switch]$Demo
)
$ErrorActionPreference = "Stop"
$origen = Split-Path -Parent $PSScriptRoot
function Paso($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Listo($t) { Write-Host "   $t" -ForegroundColor Green }
function Clave([int]$n = 24) { -join ((48..57) + (65..90) + (97..122) | Get-Random -Count $n | ForEach-Object { [char]$_ }) }
function RefrescarPath { $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") }

if ($CentralUrl) {
  $CentralUrl = $CentralUrl.TrimEnd("/")
  if ($SucursalId -notmatch '^[0-9a-fA-F-]{36}$') { throw "Con -CentralUrl hace falta -SucursalId (el identificador de la sucursal en la central)" }
  try { Invoke-RestMethod "$CentralUrl/salud" -TimeoutSec 15 | Out-Null }
  catch { Write-Host "   OJO: ahora no responde $CentralUrl. Se instala igual; sincroniza cuando haya conexión." -ForegroundColor Yellow }
}
if (-not (Test-Path "$origen\apps\servidor\dist\index.js")) {
  throw "No encuentro FactPOS en $origen. Ejecute el instalador desde la carpeta descomprimida del paquete."
}

# ---------------------------------------------------------------- Node.js
Paso "Node.js"
RefrescarPath
$node = Get-Command node -ErrorAction SilentlyContinue
$version = if ($node) { [int]((& node -v).TrimStart("v").Split(".")[0]) } else { 0 }
if ($version -lt 20) {
  winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
  RefrescarPath
}
Listo ("Node.js " + (& node -v))

# ------------------------------------------------------------- PostgreSQL
Paso "PostgreSQL"
$pgBin = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $pgBin) {
  if (-not $ClavePostgres) { $ClavePostgres = Clave 20 }
  winget install -e --id PostgreSQL.PostgreSQL.16 --silent --accept-package-agreements --accept-source-agreements `
    --override "--mode unattended --unattendedmodeui none --superpassword $ClavePostgres --serverport 5432 --servicename postgresql-16"
  $pgBin = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" | Sort-Object FullName -Descending | Select-Object -First 1
  # Se guarda la clave del superusuario solo para el administrador del equipo
  $claveArchivo = "$Carpeta\postgres-superusuario.txt"
  New-Item -ItemType Directory -Force -Path $Carpeta | Out-Null
  Set-Content -Path $claveArchivo -Value "Usuario: postgres`r`nClave: $ClavePostgres"
  icacls $claveArchivo /inheritance:r /grant:r "*S-1-5-32-544:F" "*S-1-5-18:F" 2>$null | Out-Null
  Listo "PostgreSQL instalado. La clave del superusuario quedó en $claveArchivo"
} elseif (-not $ClavePostgres) {
  $seg = Read-Host "PostgreSQL ya está instalado. Escriba la clave del usuario postgres" -AsSecureString
  $ClavePostgres = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($seg))
}
$psql = $pgBin.FullName
Listo "Usando $psql"

# ------------------------------------------------------------- Archivos
Paso "Copiando FactPOS a $Carpeta"
New-Item -ItemType Directory -Force -Path $Carpeta, "$Carpeta\logs" | Out-Null
robocopy $origen $Carpeta /E /NFL /NDL /NJH /NJS /NP /XF .env postgres-superusuario.txt /XD logs | Out-Null
if ($LASTEXITCODE -ge 8) { throw "No se pudieron copiar los archivos (robocopy $LASTEXITCODE)" }
Listo "Archivos copiados"

# ---------------------------------------------------------- Base de datos
Paso "Base de datos"
$env:PGPASSWORD = $ClavePostgres
$existe = & $psql -U postgres -h localhost -tAc "SELECT 1 FROM pg_roles WHERE rolname='factpos'"
$envArchivo = "$Carpeta\.env"
if ($existe -eq "1" -and (Test-Path $envArchivo)) {
  Listo "La base factpos ya existe; se conserva (actualización)"
  if ($CentralUrl) {
    # Conectar (o cambiar) la central sin tocar lo demás del .env
    $lineas = Get-Content $envArchivo | Where-Object { $_ -notmatch '^(CENTRAL_URL|SUCURSAL_ID|CENTRAL_CLAVE)=' }
    $lineas += "CENTRAL_URL=$CentralUrl", "SUCURSAL_ID=$SucursalId", "CENTRAL_CLAVE=$CentralClave"
    $lineas | Set-Content -Path $envArchivo -Encoding UTF8
    Listo "Conectada a la central $CentralUrl"
  }
} else {
  $claveBD = Clave 24
  if ($existe -eq "1") { & $psql -U postgres -h localhost -c "ALTER ROLE factpos WITH LOGIN PASSWORD '$claveBD'" | Out-Null }
  else { & $psql -U postgres -h localhost -c "CREATE ROLE factpos LOGIN PASSWORD '$claveBD'" | Out-Null }
  $hayBase = & $psql -U postgres -h localhost -tAc "SELECT 1 FROM pg_database WHERE datname='factpos'"
  if ($hayBase -ne "1") { & $psql -U postgres -h localhost -c "CREATE DATABASE factpos OWNER factpos" | Out-Null }
  if (-not $PinSecreto) { $PinSecreto = Clave 32; Write-Host "   OJO: se generó un PIN_SECRETO nuevo. Si ya tiene central u otras sucursales, cópielo de allá al archivo .env" -ForegroundColor Yellow }
  @"
# FactPOS · servidor de sucursal (generado por el instalador)
DATABASE_URL=postgres://factpos:$claveBD@localhost:5432/factpos
MODO=sucursal
PUERTO=$Puerto
HOST=0.0.0.0
NOMBRE_RED=$NombreRed
PIN_SECRETO=$PinSecreto
CLAVE_ACCESO=
# Sincronización con la central en la nube (vacío = la sucursal trabaja sola)
CENTRAL_URL=$CentralUrl
SUCURSAL_ID=$SucursalId
CENTRAL_CLAVE=$CentralClave
CERT_P12_RUTA=
CERT_P12_CLAVE=
"@ | Set-Content -Path $envArchivo -Encoding UTF8
  icacls $envArchivo /inheritance:r /grant:r "*S-1-5-32-544:F" "*S-1-5-18:F" 2>$null | Out-Null
  Listo "Base factpos creada y .env escrito"
}
Remove-Item Env:\PGPASSWORD

Push-Location $Carpeta
& node apps\servidor\dist\migrar.js
if ($LASTEXITCODE -ne 0) { throw "Fallaron las migraciones" }
if ($Demo -and -not $CentralUrl) { & node apps\servidor\dist\semilla.js; Listo "Datos de demostración cargados" }
if ($CentralUrl) { Listo "Productos, precios, usuarios y existencias se descargan de la central al arrancar" }
Pop-Location

# ------------------------------------------------- Arranque con Windows
Paso "Servidor como servicio (arranca con Windows)"
$nodeExe = (Get-Command node).Source
$tarea = "FactPOS Servidor"
$accion = New-ScheduledTaskAction -Execute "cmd.exe" -WorkingDirectory $Carpeta `
  -Argument "/c `"`"$nodeExe`" apps\servidor\dist\index.js >> logs\servidor.log 2>&1`""
$disparador = New-ScheduledTaskTrigger -AtStartup
$opciones = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$usuario = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
Unregister-ScheduledTask -TaskName $tarea -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $tarea -Action $accion -Trigger $disparador -Settings $opciones -Principal $usuario | Out-Null
Start-ScheduledTask -TaskName $tarea
Listo "Tarea '$tarea' registrada e iniciada"

# ---------------------------------------------------------- Firewall
Paso "Firewall (solo red local)"
$reglas = @(
  @{ n = "FactPOS servidor (TCP $Puerto)"; p = "TCP"; l = "$Puerto" },
  @{ n = "FactPOS búsqueda de cajas (UDP 41234)"; p = "UDP"; l = "41234" },
  @{ n = "FactPOS nombre en la red (mDNS UDP 5353)"; p = "UDP"; l = "5353" }
)
foreach ($r in $reglas) {
  Remove-NetFirewallRule -DisplayName $r.n -ErrorAction SilentlyContinue
  New-NetFirewallRule -DisplayName $r.n -Direction Inbound -Action Allow -Protocol $r.p -LocalPort $r.l -RemoteAddress LocalSubnet -Profile Any | Out-Null
}
Listo "Reglas creadas"

# ------------------------------------------------------- Comprobación
Paso "Comprobando"
$ok = $false
foreach ($i in 1..30) {
  try { $s = Invoke-RestMethod "http://localhost:$Puerto/descubrir" -TimeoutSec 2; $ok = $true; break } catch { Start-Sleep -Seconds 2 }
}
if (-not $ok) { throw "El servidor no respondió. Revise $Carpeta\logs\servidor.log" }

$escritorio = [Environment]::GetFolderPath("CommonDesktopDirectory")
Set-Content "$escritorio\FactPOS - Servidor.url" "[InternetShortcut]`r`nURL=http://localhost:$Puerto/terminal/"

Write-Host "`n========================================================" -ForegroundColor Green
Write-Host " FactPOS está funcionando en este equipo." -ForegroundColor Green
Write-Host " En cada caja ejecute instalar-caja.ps1 (encuentra este servidor solo)"
Write-Host " o abra en el navegador:"
foreach ($d in $s.direcciones) { Write-Host "     $d/terminal/" -ForegroundColor White }
Write-Host " Registro: $Carpeta\logs\servidor.log"
Write-Host "========================================================`n" -ForegroundColor Green
