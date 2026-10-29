<#
  FactPOS · Aplicación de ADMINISTRACIÓN para Windows 10/11

  Instala "FactPOS Administración" como una aplicación de escritorio:
  ventana propia (sin barras del navegador), su ícono en el escritorio y en
  el menú Inicio, y se puede anclar a la barra de tareas. Usa Microsoft Edge
  o Google Chrome por debajo, con un perfil aparte (no se mezcla con el
  navegador personal). Siempre abre la versión más reciente del panel.

  Uso: doble clic en "INSTALAR FactPOS Administracion.bat"
    o: powershell -ExecutionPolicy Bypass -File .\instalar-administracion.ps1 [-Url nombre-de-su-empresa]
#>
param(
  [string]$Url = "",
  [switch]$SinMenuInicio
)
$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
function Paso($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Listo($t) { Write-Host "   $t" -ForegroundColor Green }

# Portal de FactPOS (lo deja el empaquetado: variable PORTAL_URL de GitHub)
$portal = "__PORTAL_URL__"
if ($portal -like "__*") { $portal = "https://factpos.vercel.app" }

Paso "Su empresa en FactPOS"
if (-not $Url) {
  Write-Host "   Escriba el nombre corto de su empresa que le dio su proveedor (ej. royalliquorstore),"
  Write-Host "   o la IP del servidor de su tienda (ej. 192.168.1.10) para la administración LOCAL, que"
  Write-Host "   funciona sin internet."
  do { $Url = (Read-Host "   Empresa").Trim() } until ($Url)
}
if ($Url -match '^\d{1,3}(\.\d{1,3}){3}(:\d+)?$' -or $Url -eq "localhost") {
  # Administración local en el servidor de la tienda
  $Url = "http://$Url$(if ($Url -notmatch ':\d+$') { ':3000' })/admin/"
} elseif ($Url -notmatch '[./:]') {
  $slug = $Url.ToLower()
  try {
    $c = Invoke-RestMethod "$portal/licencias/cliente/$slug" -TimeoutSec 15
    Listo "Empresa: $($c.nombre)"
  } catch { Write-Host "   OJO: el portal no reconoce «$slug» ahora mismo. Se instala igual; revise el nombre si no abre." -ForegroundColor Yellow }
  $Url = "$portal/$slug/"
}
if ($Url -notmatch '^https?://') { $Url = "https://$Url" }
$Url = $Url.TrimEnd("/") + "/"
try { Invoke-WebRequest $Url -UseBasicParsing -TimeoutSec 15 | Out-Null; Listo "Responde: $Url" }
catch { Write-Host "   OJO: ahora no responde $Url. Se instala igual." -ForegroundColor Yellow }

Paso "Navegador"
$candidatos = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$navegador = $candidatos | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $navegador) { throw "No se encontró Microsoft Edge ni Google Chrome" }
Listo $navegador

# Perfil propio: la sesión del panel y sus ajustes quedan aparte
$carpeta = "$env:LOCALAPPDATA\FactPOS"
$perfil = "$carpeta\Administracion"
New-Item -ItemType Directory -Force -Path $perfil | Out-Null
$icono = "$carpeta\factpos.ico"
$icoOrigen = Join-Path $PSScriptRoot "factpos.ico"
if (Test-Path $icoOrigen) { Copy-Item $icoOrigen $icono -Force }

Paso "Accesos directos"
$wsh = New-Object -ComObject WScript.Shell
function Acceso($ruta) {
  $a = $wsh.CreateShortcut($ruta)
  $a.TargetPath = $navegador
  $a.Arguments = "--app=$Url --user-data-dir=`"$perfil`" --no-first-run --disable-features=Translate"
  $a.WorkingDirectory = Split-Path $navegador
  $a.Description = "FactPOS Administración"
  if (Test-Path $icono) { $a.IconLocation = "$icono,0" }
  $a.Save()
}
Acceso "$([Environment]::GetFolderPath('Desktop'))\FactPOS Administración.lnk"
Listo "Escritorio: FactPOS Administración"
if (-not $SinMenuInicio) {
  Acceso "$([Environment]::GetFolderPath('Programs'))\FactPOS Administración.lnk"
  Listo "Menú Inicio: FactPOS Administración"
}

Write-Host "`n   Listo. Para tenerla en la barra de tareas: ábrala, clic derecho en su ícono › Anclar a la barra de tareas." -ForegroundColor Green
Write-Host "   En el celular: abra $Url en Chrome › menú ⋮ › «Instalar aplicación» (o en iPhone: Compartir › «Agregar a inicio»)."
$abrir = Read-Host "`n   ¿Abrir la administración ahora? (S/n)"
if (-not $abrir -or $abrir.Trim().ToLower().StartsWith("s")) {
  Start-Process "$([Environment]::GetFolderPath('Desktop'))\FactPOS Administración.lnk"
}
