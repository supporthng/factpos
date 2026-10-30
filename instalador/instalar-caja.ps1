<#
  FactPOS · Instalador de una CAJA (Windows 10/11)

  Qué hace:
    1. Busca el servidor de la sucursal en la red (no hay que escribir direcciones):
       pregunta a toda la red por UDP y, si no contesta, prueba factpos.local.
    2. Crea en el escritorio el acceso "FactPOS Caja", que abre la caja en
       pantalla completa (modo kiosco) con IMPRESIÓN DIRECTA a la impresora
       predeterminada, sin la ventana de imprimir.
    3. Hace que la caja se abra sola al encender el equipo.
    4. Si se indica, deja la impresora térmica como predeterminada.

  Uso (PowerShell, no hace falta ser Administrador):
    powershell -ExecutionPolicy Bypass -File .\instalar-caja.ps1
    ... -Impresora "POS-80"        # nombre de la impresora térmica (ver lista al final)
    ... -Ventana                   # en ventana en vez de pantalla completa
    ... -SinInicioAutomatico       # no abrir al encender
    ... -Servidor http://192.168.1.10:3000   # si la búsqueda no lo encuentra
#>
param(
  [string]$Servidor = "",
  [string]$Impresora = "",
  [switch]$Ventana,
  [switch]$SinInicioAutomatico,
  [switch]$NoInteractivo   # sin preguntas (lo usa FactPOS-Setup.exe)
)
$ErrorActionPreference = "Stop"
function Paso($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Listo($t) { Write-Host "   $t" -ForegroundColor Green }

# ------------------------------------------------ Buscar el servidor
function Buscar-Servidores {
  $hallados = @{}
  $udp = New-Object System.Net.Sockets.UdpClient
  try {
    $udp.EnableBroadcast = $true
    $udp.Client.ReceiveTimeout = 700
    $msg = [Text.Encoding]::ASCII.GetBytes("FACTPOS?")
    # Broadcast general y el de cada red del equipo (algunos routers no pasan el general)
    $destinos = @([Net.IPAddress]::Broadcast)
    foreach ($ip in Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" }) {
      $b = [Net.IPAddress]::Parse($ip.IPAddress).GetAddressBytes()
      $mascara = [uint32]([math]::Pow(2, 32) - [math]::Pow(2, 32 - $ip.PrefixLength))
      $m = [BitConverter]::GetBytes($mascara); [Array]::Reverse($m)
      $destinos += [Net.IPAddress]::new([byte[]](0..3 | ForEach-Object { $b[$_] -bor (255 -bxor $m[$_]) }))
    }
    foreach ($d in $destinos) { [void]$udp.Send($msg, $msg.Length, (New-Object Net.IPEndPoint($d, 41234))) }
    $fin = (Get-Date).AddSeconds(3)
    while ((Get-Date) -lt $fin) {
      try {
        $desde = New-Object Net.IPEndPoint([Net.IPAddress]::Any, 0)
        $resp = [Text.Encoding]::UTF8.GetString($udp.Receive([ref]$desde)) | ConvertFrom-Json
        if ($resp.producto -eq "FactPOS") {
          $url = "http://$($desde.Address):$($resp.puerto)"
          $hallados[$url] = $resp
        }
      } catch [Net.Sockets.SocketException] { }
    }
  } finally { $udp.Close() }
  if ($hallados.Count -eq 0) {
    try {
      $r = Invoke-RestMethod "http://factpos.local:3000/descubrir" -TimeoutSec 4
      if ($r.producto -eq "FactPOS") { $hallados["http://factpos.local:3000"] = $r }
    } catch { }
  }
  return $hallados
}

Paso "Buscando el servidor FactPOS en la red local"
while (-not $Servidor) {
  Write-Host "   Buscando..."
  $hallados = Buscar-Servidores
  $lista = @($hallados.Keys)
  if ($lista.Count -eq 1) {
    $d = $hallados[$lista[0]]
    Listo ("Encontrado: {0} · {1} · {2}" -f $d.empresa, ($d.sucursales -join ", "), $lista[0])
    $Servidor = $lista[0]
  } elseif ($lista.Count -gt 1 -and $NoInteractivo) {
    $Servidor = $lista[0]
    Write-Host "   Hay varios servidores FactPOS en esta red; se usa $Servidor. Si no es el de esta tienda, vuelva a instalar escribiendo su IP." -ForegroundColor Yellow
  } elseif ($lista.Count -gt 1) {
    Write-Host "   Hay varios servidores FactPOS en esta red:"
    for ($i = 0; $i -lt $lista.Count; $i++) {
      $d = $hallados[$lista[$i]]
      Write-Host ("   [{0}] {1} · {2} · {3}" -f ($i + 1), $d.empresa, ($d.sucursales -join ", "), $lista[$i])
    }
    do { $n = Read-Host "   ¿Cuál es el de esta sucursal? (número)" } until ($n -match '^\d+$' -and [int]$n -ge 1 -and [int]$n -le $lista.Count)
    $Servidor = $lista[[int]$n - 1]
  } else {
    if ($NoInteractivo) { throw "No se encontró el servidor FactPOS en la red. Revise que esté encendido y en la misma red, o escriba su IP en el instalador." }
    Write-Host "   No se encontró ningún servidor. Revise que esté encendido, instalado y en la misma red (mismo router o Wi-Fi)." -ForegroundColor Yellow
    $r = Read-Host "   Enter = buscar de nuevo · o escriba la dirección del servidor (ej. 192.168.1.10)"
    if ($r) {
      $r = $r.Trim()
      if ($r -notmatch '^https?://') { $r = "http://$r" }
      if ($r -notmatch ':\d+$') { $r = "$($r.TrimEnd('/')):3000" }
      $Servidor = $r
    }
  }
}
$Servidor = $Servidor.Trim().TrimEnd("/")
if ($Servidor -notmatch '^https?://') { $Servidor = "http://$Servidor" }
if ($Servidor -notmatch ':\d+$') { $Servidor = "$($Servidor):3000" }
try { $info = Invoke-RestMethod "$Servidor/descubrir" -TimeoutSec 5 } catch { throw "No responde un servidor FactPOS en $Servidor" }
Listo "Servidor: $Servidor  ($($info.empresa) · $($info.sucursales -join ', '))"

# --------------------------------------------------------- Acceso de Caja
# En el instalador NSIS integrado, Electron crea los accesos. No crear
# un acceso de Edge/Chrome que pueda reemplazar el de escritorio.
if ($env:FACTPOS_INSTALADOR -eq '1') {
  Paso "Caja de escritorio"
  Listo "El instalador principal creara el acceso FactPOS Caja con Electron."
} else {
  # --------------------------------------------------------- Navegador
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

  # Perfil propio de la caja: así el modo kiosco y la impresión directa no chocan con el navegador personal
  $perfil = "$env:LOCALAPPDATA\FactPOS\Caja"
  New-Item -ItemType Directory -Force -Path $perfil | Out-Null
  $url = "$Servidor/terminal/"
  $esEdge = $navegador -like "*msedge.exe"
  # --unsafely-treat-insecure-origin-as-secure: el servidor está en la red local (http). Con esto el
  # navegador guarda la pantalla de la caja y la abre aunque el servidor se caiga (contingencia).
  $origenServidor = ([Uri]$Servidor).GetLeftPart([UriPartial]::Authority)
  $opcionesNav = @("--user-data-dir=`"$perfil`"", "--no-first-run", "--kiosk-printing", "--disable-features=Translate", "--disable-pinch",
                   "--unsafely-treat-insecure-origin-as-secure=$origenServidor")
  if ($Ventana) { $opcionesNav += "--app=$url" }
  else {
    $opcionesNav += "--kiosk", $url
    if ($esEdge) { $opcionesNav += "--edge-kiosk-type=fullscreen" }
  }
  $argumentos = $opcionesNav -join " "

  # ---------------------------------------------------------- Accesos
  Paso "Accesos directos"
  $wsh = New-Object -ComObject WScript.Shell
  function Acceso($ruta) {
    $a = $wsh.CreateShortcut($ruta)
    $a.TargetPath = $navegador
    $a.Arguments = $argumentos
    $a.WorkingDirectory = Split-Path $navegador
    $a.Description = "FactPOS Caja ($Servidor)"
    $a.Save()
  }
  Acceso "$([Environment]::GetFolderPath('Desktop'))\FactPOS Caja.lnk"
  Listo "Escritorio: FactPOS Caja"
  if (-not $SinInicioAutomatico) {
    Acceso "$([Environment]::GetFolderPath('Startup'))\FactPOS Caja.lnk"
    Listo "Se abrirá sola al encender el equipo"
  }


}

# ---------------------------------------------------------- Impresora
Paso "Impresora"
$impresoras = Get-CimInstance Win32_Printer | Select-Object -ExpandProperty Name
if ($Impresora) {
  if ($impresoras -notcontains $Impresora) { throw "No existe la impresora '$Impresora'. Disponibles: $($impresoras -join ', ')" }
  (New-Object -ComObject WScript.Network).SetDefaultPrinter($Impresora)
  Listo "Predeterminada: $Impresora (las facturas salen directo por ahí)"
} else {
  $pred = (Get-CimInstance Win32_Printer | Where-Object Default).Name
  Write-Host "   Las facturas salen por la impresora predeterminada: $pred" -ForegroundColor Yellow
  Write-Host "   Si no es la térmica, vuelva a ejecutar con -Impresora `"NOMBRE`". Disponibles:"
  $impresoras | ForEach-Object { Write-Host "     - $_" }
}

Write-Host "`n========================================================" -ForegroundColor Green
Write-Host " Caja lista. Abra 'FactPOS Caja' en el escritorio y elija qué caja es."
Write-Host " Para salir del modo pantalla completa: Alt + F4."
Write-Host "========================================================`n" -ForegroundColor Green
