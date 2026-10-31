<#
  FactPOS · Actualizar este servidor a una versión nueva

  Lo lanza el propio servidor (Administración › Actualizaciones › Instalar, o una
  sucursal que sigue al principal) como tarea de Windows de una sola vez:
    1. Detiene el servidor (y su túnel).
    2. Guarda la versión actual en "anterior" por si hay que volver.
    3. Copia la versión nueva (conserva .env, logs, respaldos y bin).
    4. Aplica las migraciones de la base de datos.
    5. Arranca el servidor. Si algo falla, vuelve a la versión anterior.
  Las cajas y la administración web se actualizan solas al recargar (las sirve el servidor).
#>
param(
  [Parameter(Mandatory)] [string]$Desde,
  [string]$Carpeta = "C:\FactPOS"
)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path "$Carpeta\logs" | Out-Null
Start-Transcript -Path "$Carpeta\logs\actualizacion.log" -Append | Out-Null
$tarea = "FactPOS Servidor"
# Avance para las pantallas (ventana de actualización, cajas, administración): archivo que lee el servidor al volver
$archivoEstado = "$Carpeta\logs\actualizacion-estado.json"
$versionNueva = "?"
function Estado([string]$estado, [string]$paso, [int]$pct, [string]$mensaje = $null) {
  try {
    $o = [ordered]@{ estado = $estado; version = $versionNueva; paso = $paso; porcentaje = $pct; mensaje = $mensaje; en = (Get-Date).ToUniversalTime().ToString("o") }
    [IO.File]::WriteAllText($archivoEstado, ($o | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding($false)))
  } catch {}
}
function Detener {
  Stop-ScheduledTask -TaskName $tarea -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='cloudflared.exe'" |
    Where-Object { $_.CommandLine -like "*apps\servidor\dist\index.js*" -or $_.CommandLine -like "*tunnel*--url*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
}
$carpetasCodigo = @("apps", "packages", "node_modules", "db", "instalador")
# robocopy sin reintentos infinitos: por omisión reintenta 1 millón de veces cada archivo bloqueado (se queda colgado)
function Copiar($origen, $destino) {
  robocopy $origen $destino /MIR /R:2 /W:2 /MT:16 /NFL /NDL /NJH /NJS /NP | Out-Null
  return $LASTEXITCODE
}
try {
  $nueva = (Get-Content -Raw "$Desde\package.json" | ConvertFrom-Json).version
  $actual = try { (Get-Content -Raw "$Carpeta\package.json" | ConvertFrom-Json).version } catch { "?" }
  $versionNueva = $nueva
  Write-Host "Actualizando FactPOS $actual -> $nueva ($(Get-Date))"
  Estado "EN_CURSO" "Cerrando FactPOS" 50
  Detener

  Estado "EN_CURSO" "Guardando la versión actual" 55
  # Copia de la versión actual para volver atrás si algo falla
  $anterior = "$Carpeta\anterior"
  Remove-Item -Recurse -Force $anterior -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $anterior | Out-Null
  foreach ($c in $carpetasCodigo) { if (Test-Path "$Carpeta\$c") { Write-Host "Respaldando $c…"; [void](Copiar "$Carpeta\$c" "$anterior\$c") } }
  Copy-Item "$Carpeta\package.json" $anterior -ErrorAction SilentlyContinue

  # Versión nueva: el código se reemplaza completo; la configuración y los datos se conservan
  foreach ($c in $carpetasCodigo) {
    if (Test-Path "$Desde\$c") { Estado "EN_CURSO" "Instalando archivos ($c)" (65 + 3 * [array]::IndexOf($carpetasCodigo, $c)); Write-Host "Copiando $c…"; $rc = Copiar "$Desde\$c" "$Carpeta\$c"; if ($rc -ge 8) { throw "No se pudo copiar $c (robocopy $rc). Probablemente un archivo está en uso: cierre FactPOS y vuelva a intentar." } }
  }
  Get-ChildItem $Desde -File | Where-Object { $_.Name -notin ".env", "postgres-superusuario.txt" } | Copy-Item -Destination $Carpeta -Force

  Estado "EN_CURSO" "Actualizando la base de datos" 85
  Push-Location $Carpeta
  & node apps\servidor\dist\migrar.js
  $ok = $LASTEXITCODE -eq 0
  Pop-Location
  if (-not $ok) { throw "Fallaron las migraciones de la base de datos" }
  Estado "EN_CURSO" "Iniciando FactPOS" 95
  Write-Host "Listo: FactPOS $nueva instalado"
  $resultado = "OK"
} catch {
  Write-Host "ERROR: $($_.Exception.Message). Se vuelve a la versión anterior." -ForegroundColor Red
  $resultado = "ERROR"; $motivo = $_.Exception.Message
  Estado "EN_CURSO" "Hubo un problema: volviendo a la versión anterior" 90
  if (Test-Path "$Carpeta\anterior\apps") {
    foreach ($c in $carpetasCodigo) { if (Test-Path "$Carpeta\anterior\$c") { [void](Copiar "$Carpeta\anterior\$c" "$Carpeta\$c") } }
    Copy-Item "$Carpeta\anterior\package.json" $Carpeta -Force -ErrorAction SilentlyContinue
  }
} finally {
  if ($resultado -eq "OK") { Estado "OK" "Actualización terminada" 100 } else { Estado "ERROR" "No se pudo actualizar; se restauró la versión anterior" 100 $motivo }
  Start-ScheduledTask -TaskName $tarea -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $Desde -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName "FactPOS Actualizar" -Confirm:$false -ErrorAction SilentlyContinue
  Stop-Transcript | Out-Null
}
