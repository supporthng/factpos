<#
  FactPOS · Desinstalador / limpieza total de una CAJA (Windows 10/11)

  Qué hace (solo en esta computadora; no toca el servidor ni la base de datos):
    1. Cierra la caja si está abierta (y el navegador en modo kiosco, si se usó).
    2. DEVUELVE Windows a la normalidad: el Explorador (barra de tareas y menú Inicio), el Administrador de
       tareas y el teclado táctil, que la caja desactiva mientras está en pantalla completa.
    3. Borra los accesos (escritorio, inicio automático, menú Inicio).
    4. Borra toda la configuración y los restos de la caja: servidor guardado, caché de pantallas, código
       descargado del servidor, perfil del navegador, impresión elegida y registros.
    5. Quita la entrada de «Programas y características», la regla del firewall y los archivos temporales.

  Si en esta misma PC también está la Administración de escritorio, esa parte se conserva
  (programa y configuración); solo se limpia lo que es de la caja.

  Uso (PowerShell como Administrador):
    powershell -ExecutionPolicy Bypass -File .\desinstalar-caja.ps1
    ... -Silencioso     # sin preguntas (lo usa FactPOS-Caja-Limpiar.exe)
#>
param([switch]$Silencioso)
$ErrorActionPreference = "Continue"
$fallos = New-Object System.Collections.Generic.List[string]
function Paso($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Listo($t) { Write-Host "   $t" -ForegroundColor Green }
function Aviso($t) { Write-Host "   $t" -ForegroundColor Yellow }

# Ejecuta un bloque; si falla lo anota y sigue con lo demás
function Intentar($texto, [scriptblock]$bloque) {
  try { & $bloque } catch { $fallos.Add("$texto : $($_.Exception.Message)"); Aviso "No se pudo: $texto ($($_.Exception.Message))" }
}
# Borra un archivo o carpeta si existe
function Quitar($ruta) {
  if (-not $ruta) { return }
  if (Test-Path -LiteralPath $ruta) {
    Intentar "borrar $ruta" {
      Remove-Item -LiteralPath $ruta -Recurse -Force -ErrorAction Stop
      Listo "Borrado: $ruta"
    }
  }
}

if (-not $Silencioso) {
  Write-Host "Se va a borrar TODO lo de la caja FactPOS de esta computadora (accesos, configuración, caché y registros)." -ForegroundColor Yellow
  Write-Host "Las ventas y los datos del negocio están en el servidor y no se tocan."
  $r = Read-Host "¿Continuar? (S/N)"
  if ($r -notmatch '^[sSyY]') { Write-Host "Cancelado."; exit 0 }
}

$appData = [Environment]::GetFolderPath("ApplicationData")           # …\AppData\Roaming
$local = $env:LOCALAPPDATA
$userData = Join-Path $appData "FactPOS Escritorio"                  # datos de la aplicación de escritorio
$carpetaCliente = Join-Path $local "FactPOS"                          # programa de Caja/Administración
$escritorios = @([Environment]::GetFolderPath("Desktop"), [Environment]::GetFolderPath("CommonDesktopDirectory")) | Where-Object { $_ }
$inicios = @([Environment]::GetFolderPath("Startup"), [Environment]::GetFolderPath("CommonStartup")) | Where-Object { $_ }
$programas = @([Environment]::GetFolderPath("Programs"), [Environment]::GetFolderPath("CommonPrograms")) | Where-Object { $_ }

# ------------------------------------------------ 1. Cerrar la caja
Paso "Cerrando la caja"
Intentar "cerrar FactPOS" {
  Get-Process -Name "FactPOS-Escritorio" -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
  # Navegador en modo kiosco con el perfil de la caja (instalaciones antiguas)
  Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*FactPOS\Caja*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
}
Listo "Caja cerrada"

# ------------------------------------------------ 2. Devolver Windows a la normalidad
Paso "Devolviendo Windows a la normalidad"
Intentar "reactivar el Administrador de tareas" {
  $dir = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Policies\System"
  if (Get-ItemProperty -Path $dir -Name "DisableTaskMgr" -ErrorAction SilentlyContinue) {
    Remove-ItemProperty -Path $dir -Name "DisableTaskMgr" -ErrorAction Stop
  }
  Listo "Administrador de tareas activo"
}
Intentar "devolver el teclado táctil de Windows" {
  $clave = "HKCU:\Software\Microsoft\TabletTip\1.7"
  $valores = @("EnableDesktopModeAutoInvoke", "DisableNewKeyboardExperience", "TouchKeyboardTapInvoke")
  $respaldo = Join-Path $userData "caja\teclado-windows-previo.json"
  $previo = $null
  if (Test-Path -LiteralPath $respaldo) { try { $previo = Get-Content -LiteralPath $respaldo -Raw | ConvertFrom-Json } catch { } }
  foreach ($v in $valores) {
    $anterior = if ($previo) { $previo.$v } else { $null }
    if ($null -ne $anterior) { New-Item -Path $clave -Force | Out-Null; Set-ItemProperty -Path $clave -Name $v -Value ([int]$anterior) -Type DWord }
    elseif (Get-ItemProperty -Path $clave -Name $v -ErrorAction SilentlyContinue) { Remove-ItemProperty -Path $clave -Name $v -ErrorAction SilentlyContinue }
  }
  Listo "Teclado táctil de Windows como estaba"
}
Intentar "volver a abrir el Explorador" {
  if (-not (Get-Process -Name explorer -ErrorAction SilentlyContinue)) { Start-Process "explorer.exe" }
  Listo "Escritorio, barra de tareas y menú Inicio activos"
}

# ------------------------------------------------ 3. Accesos
Paso "Quitando los accesos"
foreach ($d in ($escritorios + $inicios + $programas)) {
  Quitar (Join-Path $d "FactPOS Caja.lnk")
  Quitar (Join-Path $d "FactPOS Caja (navegador).url")
}

# ¿Hay también la Administración de escritorio en esta PC? Entonces se conserva su programa y su configuración
$hayAdmin = $false
foreach ($d in ($escritorios + $inicios + $programas)) { if (Test-Path -LiteralPath (Join-Path $d "FactPOS Administración.lnk")) { $hayAdmin = $true } }
$hayServidor = (Test-Path "C:\FactPOS\.env") -or [bool](Get-ScheduledTask -TaskName "FactPOS Servidor" -ErrorAction SilentlyContinue)
if ($hayAdmin) { Aviso "Esta PC también tiene la Administración de escritorio: se conserva su programa y configuración." }
if ($hayServidor) { Aviso "Esta PC también tiene el servidor de la sucursal: no se toca." }

# ------------------------------------------------ 4. Configuración y restos
Paso "Borrando la configuración y los restos de la caja"
Quitar (Join-Path $userData "caja")             # servidor elegido, caché de pantallas, impresión, registros de arranque
Quitar (Join-Path $userData "codigo")           # código de la caja descargado del servidor
Quitar (Join-Path $carpetaCliente "Caja")       # perfil del navegador de la caja (instalaciones antiguas)
Quitar (Join-Path $carpetaCliente "servidor-detectado.txt")
Quitar (Join-Path $carpetaCliente "instalacion.log")
if (-not $hayAdmin) {
  Quitar $userData
  Quitar $carpetaCliente                        # incluye la aplicación de escritorio y su desinstalador
}
Get-ChildItem -Path $env:TEMP -Filter "factpos*" -Force -ErrorAction SilentlyContinue | ForEach-Object { Quitar $_.FullName }

# ------------------------------------------------ 5. Registro de Windows y firewall
Paso "Limpiando el registro de Windows y el firewall"
if (-not $hayAdmin) {
  Intentar "quitar la entrada de Programas y características" {
    $cli = "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\FactPOS Cliente"
    if (Test-Path $cli) { Remove-Item -Path $cli -Recurse -Force -ErrorAction Stop; Listo "Entrada «FactPOS Caja / Administración» quitada" }
    # Clave heredada: antes la Caja guardaba aquí su registro (solo si es la de esta carpeta)
    $viejo = "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\FactPOS"
    if (Test-Path $viejo) {
      $loc = (Get-ItemProperty -Path $viejo -Name "InstallLocation" -ErrorAction SilentlyContinue).InstallLocation
      if ($loc -eq $carpetaCliente) { Remove-Item -Path $viejo -Recurse -Force -ErrorAction Stop; Listo "Entrada heredada quitada" }
    }
  }
  if (-not $hayServidor) {
    Intentar "quitar la regla del firewall" {
      $reglas = Get-NetFirewallRule -DisplayName "FactPOS equipo en la red" -ErrorAction SilentlyContinue
      if ($reglas) { $reglas | Remove-NetFirewallRule; Listo "Regla de firewall quitada" }
    }
  }
}

# ------------------------------------------------ Resultado
Write-Host "`n========================================================" -ForegroundColor Green
if ($fallos.Count -eq 0) {
  Write-Host " Caja desinstalada y limpia. Windows quedó normal." -ForegroundColor Green
} else {
  Write-Host (" Listo, salvo {0} cosa(s) que no se pudieron borrar:" -f $fallos.Count) -ForegroundColor Yellow
  $fallos | ForEach-Object { Write-Host "   - $_" }
  Write-Host " Reinicie el equipo y vuelva a ejecutar esta limpieza."
}
Write-Host " Para volver a instalar la caja use FactPOS-Caja-Setup."
Write-Host "========================================================`n" -ForegroundColor Green
if ($fallos.Count -gt 0) { exit 1 }
exit 0
