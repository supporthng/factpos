<#
  Respaldo diario automático de FactPOS (lo ejecuta la tarea programada "FactPOS Respaldo").
  Guarda una copia de los datos en C:\FactPOS\respaldos\factpos-auto-AAAAMMDD-HHmm.fpbak y
  borra las copias automáticas de más de 14 días. Registro en C:\FactPOS\logs\respaldos.log.
  Restaurar (con el servidor detenido): node instalador\bd.cjs restaurar <url-postgres> <archivo>
#>
param([string]$Carpeta = (Split-Path -Parent $PSScriptRoot), [int]$Dias = 14)
$ErrorActionPreference = 'Continue'
$registro = Join-Path $Carpeta 'logs\respaldos.log'
New-Item -ItemType Directory -Force -Path (Join-Path $Carpeta 'logs'), (Join-Path $Carpeta 'respaldos') | Out-Null
function Anotar([string]$t) { Add-Content -LiteralPath $registro -Value ("{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $t) -Encoding UTF8 }

$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
$linea = Get-Content -LiteralPath (Join-Path $Carpeta '.env') -ErrorAction SilentlyContinue | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
if (-not $linea) { Anotar 'ERROR: no se encontró DATABASE_URL en .env'; exit 1 }
$url = ($linea -replace '^DATABASE_URL=', '').Trim().Trim('"')
$archivo = Join-Path $Carpeta ("respaldos\factpos-auto-{0:yyyyMMdd-HHmm}.fpbak" -f (Get-Date))
$bd = Join-Path $Carpeta 'instalador\bd.cjs'

$salida = & node $bd respaldar $url $archivo 2>&1 | ForEach-Object { "$_" }
$codigo = $LASTEXITCODE
Anotar (($salida -join ' ').Trim())
if ($codigo -ne 0) { Anotar "ERROR: el respaldo falló (código $codigo)"; exit $codigo }
$salida = & node $bd limpiar (Join-Path $Carpeta 'respaldos') $Dias 2>&1 | ForEach-Object { "$_" }
Anotar (($salida -join ' ').Trim())
exit 0
