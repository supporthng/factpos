<#
  FactPOS · Servidor de la tienda (y, si se quiere, una caja en la misma PC)

  Lo abre el instalador principal ("INSTALAR FactPOS.bat"). Hace todo:
    1. Pregunta los datos (conexión con la nube, impresora).
    2. Instala el servidor de la tienda (pide permiso de Administrador una vez).
       Con la nube, lo da de alta con un CÓDIGO que se escribe en la Administración.
    3. Espera a que el servidor responda.
    4. Sin -SinCaja: instala la caja en esta misma computadora, apuntando a este servidor.

  También se puede correr a mano:
    powershell -ExecutionPolicy Bypass -File .\instalador\instalar-todo-en-uno.ps1
#>
param(
  [switch]$SinCaja,     # solo el servidor (las cajas van en otras computadoras)
  [switch]$Elevado,     # uso interno: la parte que corre como Administrador
  [string]$Datos = ""   # uso interno: archivo temporal con las respuestas
)
$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

function Titulo($t) { Write-Host ""; Write-Host "  $t" -ForegroundColor White -BackgroundColor DarkCyan; Write-Host "" }
function Paso($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Listo($t) { Write-Host "   $t" -ForegroundColor Green }
function Ojo($t) { Write-Host "   $t" -ForegroundColor Yellow }
function Pregunta($texto, $predeterminado = "") {
  $sufijo = if ($predeterminado) { " [$predeterminado]" } else { "" }
  $r = Read-Host "   $texto$sufijo"
  if ([string]::IsNullOrWhiteSpace($r)) { return $predeterminado } else { return $r.Trim() }
}
function PreguntaSecreta($texto) {
  $s = Read-Host "   $texto" -AsSecureString
  $p = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($p) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }
}
function SiNo($texto, [bool]$predeterminado = $true) {
  $op = if ($predeterminado) { "S/n" } else { "s/N" }
  $r = Read-Host "   $texto ($op)"
  if ([string]::IsNullOrWhiteSpace($r)) { return $predeterminado }
  return $r.Trim().ToLower().StartsWith("s")
}

# =====================================================================
# Parte 2 (como Administrador): instalar el servidor con los datos dados
# =====================================================================
if ($Elevado) {
  try {
    $d = Get-Content -Raw -Path $Datos | ConvertFrom-Json
    Remove-Item -Force $Datos -ErrorAction SilentlyContinue   # tenía la clave: se borra de una vez
    $p = @{ Puerto = [int]$d.Puerto }
    if ($d.PinSecreto) { $p.PinSecreto = $d.PinSecreto }
    if ($d.CentralUrl) { $p.CentralUrl = $d.CentralUrl }
    if ($d.SucursalId) { $p.SucursalId = $d.SucursalId; $p.CentralClave = $d.CentralClave }
    if ($d.CodigoInstalacion) { $p.CodigoInstalacion = $d.CodigoInstalacion }
    if ($d.Rnc) { $p.Rnc = $d.Rnc }
    if ($d.Demo) { $p.Demo = $true }
    & (Join-Path $PSScriptRoot "instalar-servidor.ps1") @p
    exit 0
  } catch {
    Write-Host "`n   No se pudo instalar el servidor: $($_.Exception.Message)" -ForegroundColor Red
    Read-Host "`n   Presione Enter para cerrar esta ventana"
    exit 1
  }
}

# =====================================================================
# Parte 1 (usuario normal): preguntas, servidor, caja
# =====================================================================
$total = if ($SinCaja) { 2 } else { 4 }
if ($SinCaja) {
  Titulo "FactPOS · Servidor de la tienda"
  Write-Host "   Este asistente instala el servidor de la tienda. Las cajas lo encuentran solas en la red."
} else {
  Titulo "FactPOS · Servidor y caja en esta computadora"
  Write-Host "   Este asistente instala el servidor de la tienda y una caja en esta misma PC."
}

if (-not (Test-Path (Join-Path (Split-Path -Parent $PSScriptRoot) "apps\servidor\dist\index.js"))) {
  Write-Host "`n   No encuentro FactPOS aquí. Descomprima el ZIP completo y abra el instalador desde esa carpeta." -ForegroundColor Red
  exit 1
}

# ---------------------------------------------------------- Nube
Paso "1 de $total · Conexión con la nube (Administración central)"
$datos = [ordered]@{ Puerto = 3000; CentralUrl = ""; SucursalId = ""; CentralClave = ""; PinSecreto = ""; CodigoInstalacion = ""; Rnc = ""; Demo = $false }
if (SiNo "¿Esta tienda se conecta con la Administración en la nube?" $true) {
  # Cada empresa tiene SU nube; el portal de FactPOS dice dónde está con el nombre corto
  $portal = "__PORTAL_URL__"
  if ($portal -like "__*") { $portal = "https://factpos.vercel.app" }
  Write-Host "   Escriba el nombre corto de su empresa en FactPOS (ej. royalliquorstore)"
  Write-Host "   o la dirección de la API de su nube si se la dieron." -ForegroundColor DarkGray
  do {
    $url = ""
    $e = Pregunta "Empresa"
    if ($e -match '[./:]') { $url = $e }
    elseif ($e) {
      try {
        $c = Invoke-RestMethod "$portal/licencias/cliente/$($e.ToLower())" -TimeoutSec 15
        if ($c.apiUrl) { $url = $c.apiUrl; Listo "Empresa: $($c.nombre)" }
        else { Ojo "La nube de $($c.nombre) todavía no está configurada. Pídale a su proveedor la dirección de su API." }
      } catch { Ojo "El portal no reconoce «$e» (o no hay internet). Revise el nombre o escriba la dirección de la API." }
    }
  } until ($url)
  if ($url -notmatch '^https?://') { $url = "https://$url" }
  $datos.CentralUrl = $url.TrimEnd("/")
  try {
    $s = Invoke-RestMethod "$($datos.CentralUrl)/salud" -TimeoutSec 15
    if ($s.estado -eq "ok") { Listo "La nube responde correctamente" } else { Ojo "La nube respondió, pero con un problema: $($s.causa)" }
  } catch { Ojo "Ahora no responde $($datos.CentralUrl). Se instala igual y se conecta cuando haya internet." }

  Write-Host ""
  Write-Host "   ¿Cómo se da de alta este servidor?"
  Write-Host "    1. Tengo un código de instalación (lo da la Administración al crear la sucursal,"
  Write-Host "       o en Sucursales › «Código de instalación»): queda dado de alta solo."
  Write-Host "    2. No tengo código: enviar una solicitud. Aparece en la Administración, en"
  Write-Host "       Sucursales › «Servidores esperando alta», y allí solo se confirma."
  Write-Host "    3. A mano: con el identificador, la clave fps_ y el PIN_SECRETO."
  $modo = Pregunta "Opción" "1"
  if ($modo -eq "1") {
    do {
      $cod = (Pregunta "Código de instalación (ej. K7PD-4QX9)").ToUpper() -replace '[^A-Z0-9]', ''
      $ok = $cod.Length -eq 8
      if (-not $ok) { Ojo "Son 8 letras y números, como K7PD-4QX9" }
    } until ($ok)
    $datos.CodigoInstalacion = "$($cod.Substring(0,4))-$($cod.Substring(4))"
  } elseif ($modo -eq "2") {
    $rnc = Pregunta "RNC de la empresa (opcional: así solo la ve su Administración)" ""
    if ($rnc -match '^\d{9}(\d{2})?$') { $datos.Rnc = $rnc }
  }
}
if ($datos.CentralUrl -and $modo -eq "3") {
  do {
    $id = Pregunta "Identificador de la sucursal (de «Conectar a mano»)"
    $ok = $id -match '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    if (-not $ok) { Ojo "Debe verse así: 01900000-0000-7000-8000-000000000002" }
  } until ($ok)
  $datos.SucursalId = $id.ToLower()

  do {
    $clave = Pregunta "Clave de conexión de la sucursal (empieza con fps_)"
    $ok = $clave -match '^fps_\S{10,}$'
    if (-not $ok) { Ojo "La clave empieza con fps_ (se genera en «Conectar su servidor › Generar clave»)" }
  } until ($ok)
  $datos.CentralClave = $clave

  Write-Host "   PIN_SECRETO: el MISMO que está en Vercel (Settings › Environment Variables)."
  Write-Host "   Si no coincide, los PIN de los cajeros y el certificado digital no funcionan." -ForegroundColor DarkGray
  do {
    $p1 = PreguntaSecreta "PIN_SECRETO"
    $p2 = PreguntaSecreta "Escríbalo otra vez para confirmar"
    $ok = $p1 -and ($p1 -ceq $p2)
    if (-not $ok) { Ojo "No coinciden o está vacío. Intente de nuevo." }
  } until ($ok)
  $datos.PinSecreto = $p1
} elseif ($datos.CentralUrl -and $datos.CodigoInstalacion) {
  Listo "Se dará de alta solo con el código $($datos.CodigoInstalacion)"
} elseif ($datos.CentralUrl) {
  Listo "Al terminar, el servidor queda esperando que lo confirmen en la Administración"
} else {
  Ojo "La tienda trabajará sola (sin Administración en la nube). Se puede conectar después reinstalando."
  $datos.Demo = SiNo "¿Cargar datos de demostración para practicar?" $false
}

# ---------------------------------------------------------- Puerto
$puerto = Pregunta "Puerto del servidor" "3000"
if ($puerto -notmatch '^\d{2,5}$') { $puerto = "3000" }
$datos.Puerto = [int]$puerto

# ---------------------------------------------------------- Impresora
$impresora = ""
if (-not $SinCaja) {
Paso "2 de $total · Impresora de facturas"
$impresoras = @(Get-Printer -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name)
$impresora = ""
if ($impresoras.Count) {
  for ($i = 0; $i -lt $impresoras.Count; $i++) { Write-Host ("   {0,2}. {1}" -f ($i + 1), $impresoras[$i]) }
  Write-Host "    0. Ninguna por ahora (la elijo después)"
  do {
    $n = Pregunta "Número de la impresora térmica" "0"
    $ok = $n -match '^\d+$' -and [int]$n -le $impresoras.Count
  } until ($ok)
  if ([int]$n -gt 0) { $impresora = $impresoras[[int]$n - 1]; Listo "Se usará: $impresora" }
} else {
  Ojo "No hay impresoras instaladas. Instale el driver de la térmica y vuelva a correr instalar-caja.ps1 -Impresora."
}
}

# ---------------------------------------------------------- Servidor (Administrador)
Paso "$($total - $(if ($SinCaja) { 0 } else { 1 })) de $total · Servidor de la tienda"
Write-Host "   Windows va a pedir permiso de Administrador: acepte. Se abre otra ventana; espere a que termine."
if ($datos.CentralUrl -and -not $datos.SucursalId -and -not $datos.CodigoInstalacion) { Write-Host "   Al final, esa ventana espera a que lo confirmen en la Administración (Servidores esperando alta)." -ForegroundColor White }
$tmp = Join-Path $env:TEMP ("factpos-instalar-" + [guid]::NewGuid().ToString("N") + ".json")
($datos | ConvertTo-Json) | Set-Content -Path $tmp -Encoding UTF8
$script = $MyInvocation.MyCommand.Path
try {
  $proc = Start-Process powershell -Verb RunAs -Wait -PassThru -ArgumentList @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$script`"", "-Elevado", "-Datos", "`"$tmp`"")
} catch {
  Remove-Item -Force $tmp -ErrorAction SilentlyContinue
  Write-Host "`n   Sin permiso de Administrador no se puede instalar el servidor." -ForegroundColor Red
  exit 1
}
Remove-Item -Force $tmp -ErrorAction SilentlyContinue
if ($proc.ExitCode -ne 0) { Write-Host "`n   El servidor no se instaló (vea la otra ventana). Corrija y vuelva a intentarlo." -ForegroundColor Red; exit 1 }

$base = "http://localhost:$($datos.Puerto)"
Write-Host "   Esperando a que el servidor responda en $base ..."
$listo = $false
for ($i = 0; $i -lt 60 -and -not $listo; $i++) {
  try { $s = Invoke-RestMethod "$base/salud" -TimeoutSec 3; $listo = $s.estado -eq "ok" } catch { Start-Sleep -Seconds 2 }
}
if ($listo) { Listo "Servidor funcionando" } else { Ojo "El servidor todavía no responde; la caja lo encontrará cuando arranque (registro: C:\FactPOS\logs\servidor.log)" }

if ($datos.CentralUrl -and $listo) {
  # La primera sincronización baja productos, precios, usuarios y existencias de la nube
  Write-Host "   Dando unos segundos para bajar productos y usuarios de la nube..."
  Start-Sleep -Seconds 20
}

if ($SinCaja) {
  Titulo "Listo: servidor instalado"
  Write-Host "   · Arranca solo con Windows. En cada caja ejecute el instalador y elija «Caja»: encuentra este servidor solo."
  try { $ips = (Invoke-RestMethod "$base/descubrir" -TimeoutSec 3).direcciones; foreach ($d in $ips) { Write-Host "     $d/terminal/" } } catch { }
  Write-Host "   · Administración local (funciona sin internet): $base/admin/"
  if ($datos.CentralUrl -and -not $datos.SucursalId) { Write-Host "   · Estado del alta: $base/alta" }
  Write-Host "   · Registro: C:\FactPOS\logs\servidor.log"
  exit 0
}

# ---------------------------------------------------------- Caja (usuario normal)
Paso "4 de 4 · Caja en esta computadora"
$p = @{ Servidor = $base }
if ($impresora) { $p.Impresora = $impresora }
try {
  & (Join-Path $PSScriptRoot "instalar-caja.ps1") @p
} catch {
  Write-Host "`n   La caja no se pudo instalar: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "   El servidor sí quedó instalado. Puede repetir solo la caja con:"
  Write-Host "   powershell -ExecutionPolicy Bypass -File .\instalador\instalar-caja.ps1 -Servidor $base"
  exit 1
}

Titulo "Listo: servidor y caja instalados"
Write-Host "   · El servidor arranca solo con Windows, antes que la caja."
Write-Host "   · En el escritorio quedó «FactPOS Caja». La primera vez elija «Caja 1» y entre con su PIN."
Write-Host "   · Administración (en esta PC): $base/admin/"
if ($datos.CentralUrl) { Write-Host "   · Los cajeros y sus PIN vienen de la nube: si un PIN no entra, póngalo de nuevo en Administración › Usuarios." }
Write-Host "   · Importante: con todo en una sola PC, un UPS evita que se caigan servidor y caja a la vez." -ForegroundColor Yellow
if (SiNo "¿Abrir la caja ahora?" $true) {
  $acceso = Join-Path ([Environment]::GetFolderPath("Desktop")) "FactPOS Caja.lnk"
  if (Test-Path $acceso) { Start-Process $acceso } else { Start-Process "$base/terminal/" }
}
