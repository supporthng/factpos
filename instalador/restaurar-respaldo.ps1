<#
  FactPOS · Restaurar un respaldo (lo lanza Administración › Respaldos › Restaurar, como tarea de Windows de una sola vez).
  Detiene el servidor, carga el respaldo (reemplaza TODOS los datos actuales), y vuelve a arrancar.
  Antes de restaurar, la Administración ya guardó una copia de seguridad del estado actual (factpos-antes-restaurar-*.fpbak).
  Registro: C:\FactPOS\logs\restaurar.log
#>
param([Parameter(Mandatory = $true)][string]$Archivo, [string]$Carpeta = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force -Path (Join-Path $Carpeta 'logs') | Out-Null
$registro = Join-Path $Carpeta 'logs\restaurar.log'
function Anotar([string]$t) { Add-Content -LiteralPath $registro -Value ("{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $t) -Encoding UTF8 }
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
try {
  Anotar "Restaurando $Archivo"
  if (-not (Test-Path $Archivo)) { throw "No existe $Archivo" }
  $lineaBd = Get-Content -LiteralPath (Join-Path $Carpeta '.env') | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
  $puerto = 5432
  if ($lineaBd -match '@[^:/]+:(\d+)/') { $puerto = [int]$Matches[1] }
  $m = Select-String -Path (Join-Path $Carpeta 'postgres-superusuario.txt') -Pattern '^Clave:\s*(\S+)' | Select-Object -First 1
  if (-not $m) { throw "No se encontró la clave del superusuario de PostgreSQL" }
  $urlSu = "postgres://postgres:$([uri]::EscapeDataString($m.Matches[0].Groups[1].Value))@localhost:$puerto/factpos"

  Stop-ScheduledTask -TaskName 'FactPOS Servidor' -ErrorAction SilentlyContinue
  $limite = (Get-Date).AddSeconds(20)
  do {
    $escuchan = @(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $_.OwningProcess })
    $procesos = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object {
      $_.CommandLine -match 'apps[\\/]servidor[\\/]dist[\\/]index\.js' -and (($_.CommandLine -match [regex]::Escape($Carpeta)) -or ($escuchan -contains $_.ProcessId)) })
    foreach ($p in $procesos) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    if ($procesos.Count) { Start-Sleep -Milliseconds 500 }
  } while ($procesos.Count -and (Get-Date) -lt $limite)

  $salida = @(& node (Join-Path $Carpeta 'instalador\bd.cjs') restaurar $urlSu $Archivo 2>&1 | ForEach-Object { "$_" })
  $codigo = $LASTEXITCODE
  Anotar (($salida -join ' ').Trim())
  if ($codigo -ne 0) { throw "La restauración falló (código $codigo). Los datos quedaron como estaban." }
  Anotar "Restauración terminada"
} catch { Anotar "ERROR: $($_.Exception.Message)" }
finally {
  if ((Split-Path $Archivo -Leaf) -like 'restaurar-temp-*') { Remove-Item -LiteralPath $Archivo -Force -ErrorAction SilentlyContinue }
  Start-ScheduledTask -TaskName 'FactPOS Servidor' -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName 'FactPOS Restaurar' -Confirm:$false -ErrorAction SilentlyContinue
}
