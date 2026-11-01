<#
  FactPOS · Restaurar un paquete de traslado en el equipo NUEVO (Windows 10/11)

  Antes: instale FactPOS en este equipo con el instalador normal (misma versión o más reciente que la del equipo anterior).
  Luego, en PowerShell como Administrador:
    powershell -ExecutionPolicy Bypass -File C:\FactPOS\instalador\restaurar-traslado.ps1 -Paquete "D:\FactPOS-traslado-20261101-1530"

  Qué hace: detiene el servidor, carga TODA la base de datos del equipo anterior, trae su configuración (.env, conservando la
  conexión a la base de datos de este equipo) y vuelve a arrancar. Después, en Administración › Licencia, se escribe el código
  de traslado para reactivar la licencia aquí. Los datos que había en este equipo nuevo se reemplazan.
#>
param(
  [Parameter(Mandatory = $true)][string]$Paquete,
  [string]$Carpeta = (Split-Path -Parent $PSScriptRoot)
)
$ErrorActionPreference = 'Stop'
function Paso([string]$t) { Write-Host ""; Write-Host "== $t" -ForegroundColor Cyan }
function Listo([string]$t) { Write-Host "   $t" }

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw "Ejecute PowerShell como Administrador." }
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')

$respaldo = Join-Path $Paquete 'factpos.fpbak'
$entorno = Join-Path $Paquete 'entorno.env'
if (-not (Test-Path $respaldo) -or -not (Test-Path $entorno)) { throw "La carpeta '$Paquete' no es un paquete de traslado (faltan factpos.fpbak y entorno.env)." }
$envActual = Join-Path $Carpeta '.env'
if (-not (Test-Path $envActual)) { throw "FactPOS no está instalado en $Carpeta. Instálelo primero con el instalador." }
$bd = Join-Path $Carpeta 'instalador\bd.cjs'

Paso "Datos de este equipo"
$lineaBd = Get-Content -LiteralPath $envActual | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if (-not $lineaBd) { throw "No se encontró DATABASE_URL en $envActual" }
$puerto = 5432
if ($lineaBd -match '@[^:/]+:(\d+)/') { $puerto = [int]$Matches[1] }
$claveSu = $null
$archivoClave = Join-Path $Carpeta 'postgres-superusuario.txt'
if (Test-Path $archivoClave) {
  $m = Select-String -Path $archivoClave -Pattern '^Clave:\s*(\S+)' | Select-Object -First 1
  if ($m) { $claveSu = $m.Matches[0].Groups[1].Value }
}
if (-not $claveSu) { throw "No se encontró la clave del superusuario de PostgreSQL ($archivoClave). Use el instalador normal en este equipo primero." }
$urlSu = "postgres://postgres:$([uri]::EscapeDataString($claveSu))@localhost:$puerto/factpos"
Listo "PostgreSQL en el puerto $puerto"

Paso "Deteniendo el servidor de este equipo"
Stop-ScheduledTask -TaskName 'FactPOS Servidor' -ErrorAction SilentlyContinue
$limite = (Get-Date).AddSeconds(20)
do {
  $escuchan = @(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $_.OwningProcess })
  $procesos = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -match 'apps[\\/]servidor[\\/]dist[\\/]index\.js' -and (($_.CommandLine -match [regex]::Escape($Carpeta)) -or ($escuchan -contains $_.ProcessId)) })
  foreach ($p in $procesos) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
  if ($procesos.Count) { Start-Sleep -Milliseconds 500 }
} while ($procesos.Count -and (Get-Date) -lt $limite)

Paso "Cargando la base de datos del equipo anterior"
$eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
$salida = @(& node $bd restaurar $urlSu $respaldo 2>&1 | ForEach-Object { "$_" })
$codigo = $LASTEXITCODE
$ErrorActionPreference = $eap
$salida | ForEach-Object { Listo $_ }
if ($codigo -ne 0) { throw "No se pudo restaurar la base de datos (código $codigo). Este equipo quedó como estaba." }

Paso "Configuración"
Copy-Item -LiteralPath $envActual -Destination "$envActual.antes-traslado" -Force
$nuevo = @(Get-Content -LiteralPath $entorno | Where-Object { $_ -notmatch '^DATABASE_URL=' })
$nuevo += $lineaBd   # la conexión a la base de datos es la de ESTE equipo
Set-Content -LiteralPath $envActual -Value $nuevo -Encoding UTF8
Listo "Configuración del equipo anterior aplicada (copia de la actual: .env.antes-traslado)"

Paso "Arrancando FactPOS"
Start-ScheduledTask -TaskName 'FactPOS Servidor'
Start-Sleep -Seconds 5

Write-Host ""
Write-Host "========================================================" -ForegroundColor Green
Write-Host " Traslado restaurado. Falta un paso:" -ForegroundColor Green
Write-Host "   1. Abra FactPOS Administración en este equipo."
Write-Host "   2. Entre a Configuración › Licencia."
Write-Host "   3. En 'Completar traslado' escriba el código de traslado."
Write-Host " Hasta entonces este equipo queda solo en modo consulta."
Write-Host " Apague o desinstale el equipo anterior."
Write-Host "========================================================" -ForegroundColor Green
