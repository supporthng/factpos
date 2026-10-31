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
    ... -CentralUrl https://<api-de-su-nube> -CodigoInstalacion K7PD-4QX9
                                      # queda dado de alta solo (el código lo genera la Administración
                                      # al crear la sucursal o en Sucursales > "Código de instalación")
    ... -CentralUrl https://<api-de-su-nube> [-Rnc 101000000]
                                      # sin código: envía una solicitud que aparece en
                                      # Administración > Sucursales > "Servidores esperando alta"
    ... -CentralUrl ... -SucursalId <id> -CentralClave <clave> -PinSecreto <...>
                                      # o a mano, con los datos de "Conectar a mano"
    ... -Reenlazar                    # este servidor ya estaba enlazado: darlo de alta de nuevo
    ... -Master -Empresa royalliquorstore [-Licencia FPS-XXXX-XXXX-XXXX-XXXX]
                                      # SERVIDOR PRINCIPAL del negocio: administra todo, abre un túnel
                                      # de Cloudflare para la web y las sucursales y vende también
    ... -Empresa royalliquorstore     # sucursal: encuentra sola a su servidor principal (por el portal)
    ... -NoInteractivo                # sin preguntas (lo usa el instalador FactPOS-Setup.exe)
#>
#Requires -RunAsAdministrator
param(
  [string]$Carpeta = "C:\FactPOS",
  [int]$Puerto = 3000,
  [string]$NombreRed = "factpos",
  [string]$PinSecreto = "",
  [string]$ClavePostgres = "",
  [int]$PuertoPostgres = 0,           # 0 = automático (5432 o el primero libre)
  [string]$CentralUrl = "",
  [string]$SucursalId = "",
  [string]$CentralClave = "",
  [string]$CodigoInstalacion = "",
  [string]$Rnc = "",
  [switch]$Reenlazar,
  [switch]$Demo,
  [switch]$Master,
  [string]$Empresa = "",
  [string]$Licencia = "",
  [string]$Portal = "https://factpos.vercel.app",
  [switch]$NoInteractivo
)
$ErrorActionPreference = "Stop"
$origen = Split-Path -Parent $PSScriptRoot
function Paso($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Listo($t) { Write-Host "   $t" -ForegroundColor Green }
function Clave([int]$n = 24) { -join ((48..57) + (65..90) + (97..122) | Get-Random -Count $n | ForEach-Object { [char]$_ }) }
function RefrescarPath { $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") }

$Empresa = $Empresa.Trim().ToLower()
$Portal = $Portal.TrimEnd("/")
if ($Master -and -not $Empresa) { throw "El servidor principal necesita el nombre corto de la empresa (-Empresa)" }
# Sucursal que solo conoce su empresa: el portal dice dónde está su servidor principal
if (-not $Master -and $Empresa -and -not $CentralUrl) {
  try {
    $c = Invoke-RestMethod "$Portal/licencias/cliente/$Empresa" -TimeoutSec 15
    if ($c.apiUrl) { $CentralUrl = $c.apiUrl; Listo "Empresa: $($c.nombre) · servidor principal en $CentralUrl" }
    else { Write-Host "   OJO: el servidor principal de $($c.nombre) todavía no está conectado. Esta sucursal lo buscará sola." -ForegroundColor Yellow }
  } catch { Write-Host "   OJO: no se pudo consultar el portal ahora. Esta sucursal buscará a su servidor principal sola." -ForegroundColor Yellow }
}
$Alta = $false
if (-not $Master -and $Empresa -and -not $SucursalId) { $Alta = $true }
if ($CentralUrl) {
  $CentralUrl = $CentralUrl.TrimEnd("/")
  if (-not $SucursalId -and -not $CentralClave) { $Alta = $true }   # se da de alta con código
  elseif ($SucursalId -notmatch '^[0-9a-fA-F-]{36}$' -or $CentralClave -notmatch '^fps_') { throw "A mano hacen falta -SucursalId (identificador de 36 caracteres) y -CentralClave (empieza con fps_). O no ponga ninguno de los dos para dar de alta con código." }
  try { Invoke-RestMethod "$CentralUrl/salud" -TimeoutSec 15 | Out-Null }
  catch { Write-Host "   OJO: ahora no responde $CentralUrl. Se instala igual; sincroniza cuando haya conexión." -ForegroundColor Yellow }
}
if (-not (Test-Path "$origen\apps\servidor\dist\index.js")) {
  throw "No encuentro FactPOS en $origen. Ejecute el instalador desde la carpeta descomprimida del paquete."
}

# Una reparacion reutiliza siempre la configuracion y la base existentes.
$envExistente = Join-Path $Carpeta '.env'
$esReparacion = Test-Path -LiteralPath $envExistente
if ($esReparacion) {
  $dbLine = Get-Content -LiteralPath $envExistente | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
  if (-not $dbLine) { throw 'La instalacion existente no tiene DATABASE_URL. No se modificara la base de datos.' }
  Listo 'Instalacion existente: se conservaran la base de datos, credenciales y configuracion.'
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
# Dónde está psql.exe: registro de PostgreSQL, carpeta normal o PATH
# Reconocer también instalaciones registradas como servicio "PostgreSQL" sin versión.
# El servicio puede apuntar a una carpeta distinta de Program Files.
function ServiciosPostgres {
  @(Get-CimInstance Win32_Service -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -match '(?i)postgres' -or $_.DisplayName -match '(?i)postgres'
  })
}
function BuscarPsql {
  $rutas = @()
  foreach ($k in "HKLM:\SOFTWARE\PostgreSQL\Installations\*", "HKLM:\SOFTWARE\WOW6432Node\PostgreSQL\Installations\*") {
    Get-ItemProperty $k -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.'Base Directory') { $rutas += (Join-Path $_.'Base Directory' 'bin\psql.exe') }
    }
  }
  # $env:ProgramW6432 = "C:\Program Files" real aunque este PowerShell sea de 32 bits
  foreach ($pf in @($env:ProgramW6432, $env:ProgramFiles, ${env:ProgramFiles(x86)}) | Where-Object { $_ } | Select-Object -Unique) {
    $rutas += @(Get-ChildItem "$pf\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | ForEach-Object FullName)
  }
  foreach ($servicio in @(ServiciosPostgres)) {
    $rutaServicio = [string]$servicio.PathName
    # Ejemplos: "C:\PostgreSQL\16\bin\pg_ctl.exe" runservice ...
    #           "C:\Program Files\PostgreSQL\16\bin\postgres.exe" -D ...
    if ($rutaServicio -match '(?i)([A-Z]:\\.*?\\bin\\(?:pg_ctl|postgres)\.exe)') {
      $directorioBin = Split-Path -Parent $Matches[1]
      $rutas += (Join-Path $directorioBin 'psql.exe')
    }
  }
  $c = Get-Command psql -ErrorAction SilentlyContinue
  if ($c) { $rutas += $c.Source }
  foreach ($r in $rutas) { if ($r -and (Test-Path -LiteralPath $r -PathType Leaf)) { return Get-Item -LiteralPath $r } }
  return $null
}
# El instalador de PostgreSQL puede seguir trabajando después de que winget termina: se espera
function EsperarPsql([int]$segundos) {
  $desde = Get-Date; $hasta = $desde.AddSeconds($segundos); $aviso = $desde
  do {
    $p = BuscarPsql; if ($p) { return $p }
    if (((Get-Date) - $aviso).TotalSeconds -ge 30) { $aviso = Get-Date; AvisoEspera $desde }
    Start-Sleep -Seconds 5
  } while ((Get-Date) -lt $hasta)
  return $null
}
# Mensaje cada 30 s para que se vea que sigue trabajando
function AvisoEspera($desde) {
  $min = [int][Math]::Floor(((Get-Date) - $desde).TotalMinutes)
  Write-Host "   Preparando la base de datos, por favor espere... ($min min; suele tardar de 3 a 10)"
  if ($min -ge 12) { Write-Host "   Si sigue igual, revise con Alt+Tab si hay una ventana de PostgreSQL esperando respuesta." -ForegroundColor Yellow }
}
# Ejecuta un instalador avisando mientras trabaja
function EjecutarConAviso([string]$exe, [string[]]$argumentos) {
  $p = Start-Process -FilePath $exe -ArgumentList $argumentos -NoNewWindow -PassThru
  $desde = Get-Date
  while (-not $p.WaitForExit(30000)) { AvisoEspera $desde }
  return $p.ExitCode
}
function PuertoOcupado([int]$p) { [bool](Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue) }
# Puerto de un PostgreSQL ya instalado (lo anota su instalador en el registro)
function PuertoRegistrado {
  foreach ($k in "HKLM:\SOFTWARE\PostgreSQL\Services\*", "HKLM:\SOFTWARE\WOW6432Node\PostgreSQL\Services\*") {
    $v = Get-ItemProperty $k -ErrorAction SilentlyContinue | Where-Object { $_.Port } | Select-Object -First 1
    if ($v) { return [int]$v.Port }
  }
  return 5432
}
# PostgreSQL propio de FactPOS: el incluido en el instalador (servicio FactPOS-PostgreSQL) o,
# en instalaciones anteriores, el que se instaló con winget (servicio postgresql-16).
# Nunca se usa el PostgreSQL de otro programa (HikCentral, WilPOS...).
function PostgresFactPOS {
  foreach ($nombre in @('FactPOS-PostgreSQL', 'postgresql-16')) {
    $svc = Get-CimInstance Win32_Service -Filter "Name='$nombre'" -ErrorAction SilentlyContinue
    if (-not $svc) { continue }
    $ruta = [string]$svc.PathName
    if ($ruta -notmatch '-D\s+"([^"]+)"') { continue }
    $conf = Join-Path $Matches[1] 'postgresql.conf'
    if (-not (Test-Path -LiteralPath $conf -PathType Leaf)) { continue }
    $puerto = 5432
    $m = Select-String -LiteralPath $conf -Pattern '^\s*port\s*=\s*(\d+)' | Select-Object -Last 1
    if ($m) { $puerto = [int]$m.Matches[0].Groups[1].Value }
    $bin = if ($ruta -match '^"([^"]+)"') { Split-Path -Parent $Matches[1] } else { '' }
    return [pscustomobject]@{ Servicio = $nombre; Conf = $conf; Puerto = $puerto; Bin = $bin }
  }
  return $null
}
# Herramientas de base de datos (instalador\bd.cjs con la librería pg de FactPOS; reemplaza a psql y pg_dump).
# Devuelve lo que imprimió; el código de salida queda en $script:CodigoBd.
function Bd {
  $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    $salida = @(& node (Join-Path $Carpeta 'instalador\bd.cjs') @args 2>&1 | ForEach-Object { "$_" })
    $script:CodigoBd = $LASTEXITCODE
  } finally { $ErrorActionPreference = $eap }
  return ($salida -join ' ').Trim()
}
function UrlPg([string]$usuario, [string]$clave, [int]$puerto, [string]$base) {
  $credencial = if ($clave) { "$([uri]::EscapeDataString($usuario)):$([uri]::EscapeDataString($clave))" } else { [uri]::EscapeDataString($usuario) }
  return "postgres://$credencial@localhost:$puerto/$base"
}
function EsperarPuerto([int]$p, [int]$segundos = 60) {
  $hasta = (Get-Date).AddSeconds($segundos)
  while (-not (ProgramaEnPuerto $p) -and (Get-Date) -lt $hasta) { Start-Sleep -Seconds 2 }
  return [bool](ProgramaEnPuerto $p)
}
# La clave guardada de "postgres" puede no coincidir con la real (p. ej. winget alteró la clave al instalar).
# Solo para el PostgreSQL PROPIO de FactPOS: acceso local sin clave por un momento, se fija la clave
# guardada y pg_hba.conf vuelve a quedar exactamente como estaba (también si algo falla).
function RestablecerClavePostgres($pg, [string]$clave) {
  $hba = Join-Path (Split-Path -Parent $pg.Conf) 'pg_hba.conf'
  if (-not (Test-Path -LiteralPath $hba -PathType Leaf)) { throw "No se encontró $hba" }
  $original = [IO.File]::ReadAllBytes($hba)
  [IO.File]::WriteAllBytes("$hba.factpos-respaldo", $original)
  try {
    $texto = [Text.Encoding]::UTF8.GetString($original).TrimStart([char]0xFEFF)
    $temporal = "host all postgres 127.0.0.1/32 trust`r`nhost all postgres ::1/128 trust`r`n" + $texto
    [IO.File]::WriteAllText($hba, $temporal, (New-Object Text.UTF8Encoding $false))
    Restart-Service -Name $pg.Servicio -Force
    EsperarPuerto $pg.Puerto | Out-Null
    $claveSql = $clave.Replace("'", "''")
    $r = Bd sql (UrlPg 'postgres' '' $pg.Puerto 'postgres') "ALTER USER postgres WITH PASSWORD '$claveSql'"
    if ($script:CodigoBd -ne 0) { throw "No se pudo restablecer la clave de postgres: $r" }
  } finally {
    [IO.File]::WriteAllBytes($hba, $original)
    Restart-Service -Name $pg.Servicio -Force -ErrorAction SilentlyContinue
    EsperarPuerto $pg.Puerto | Out-Null
    Remove-Item "$hba.factpos-respaldo" -ErrorAction SilentlyContinue
  }
}
# Ruta del programa que escucha en un puerto (o $null si está libre)
function ProgramaEnPuerto([int]$p) {
  $c = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $c) { return $null }
  $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)" -ErrorAction SilentlyContinue
  if ($proc -and $proc.ExecutablePath) { return [string]$proc.ExecutablePath }
  return "proceso $($c.OwningProcess)"
}
# Si otro PostgreSQL (HikCentral, WilPOS...) ocupa el puerto del PostgreSQL de FactPOS, FactPOS
# terminaría hablando con la base de OTRO programa: se mueve el de FactPOS a un puerto libre.
# Deja el servicio en marcha y devuelve el objeto con el puerto final.
function AsegurarPuertoPropio($pg) {
  $ocupante = ProgramaEnPuerto $pg.Puerto
  $esPropio = $ocupante -and $pg.Bin -and $ocupante.StartsWith($pg.Bin, [StringComparison]::OrdinalIgnoreCase)
  if ($ocupante -and -not $esPropio) {
    $nuevo = 5433
    while ((PuertoOcupado $nuevo) -and $nuevo -lt 5460) { $nuevo++ }
    Write-Host "   El puerto $($pg.Puerto) lo usa otro programa: $ocupante" -ForegroundColor Yellow
    Write-Host "   PostgreSQL de FactPOS ($($pg.Servicio)) pasa al puerto $nuevo" -ForegroundColor Yellow
    $lineasConf = @(Get-Content -LiteralPath $pg.Conf | Where-Object { $_ -notmatch '^\s*port\s*=' })
    $lineasConf += "port = $nuevo"
    [IO.File]::WriteAllLines($pg.Conf, [string[]]$lineasConf)   # UTF-8 sin BOM (PostgreSQL no acepta BOM)
    Restart-Service -Name $pg.Servicio -Force -ErrorAction SilentlyContinue
    if ((Get-Service -Name $pg.Servicio).Status -ne 'Running') { Start-Service -Name $pg.Servicio }
    $pg.Puerto = $nuevo
  } elseif (-not $ocupante) {
    if ((Get-Service -Name $pg.Servicio).Status -ne 'Running') { Start-Service -Name $pg.Servicio } else { Restart-Service -Name $pg.Servicio -Force }
  }
  if (-not (EsperarPuerto $pg.Puerto)) { throw "PostgreSQL de FactPOS ($($pg.Servicio)) no quedó escuchando en el puerto $($pg.Puerto). Revise el visor de eventos de Windows (Aplicación) o $(Split-Path -Parent $pg.Conf)\log" }
  return $pg
}
# PostgreSQL necesita Microsoft Visual C++ 2015-2022 (x64)
function AsegurarVcRedist {
  $sys = Join-Path $env:WINDIR 'System32'
  $faltan = { @('vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll') | Where-Object { -not (Test-Path -LiteralPath (Join-Path $sys $_)) } }
  if (-not (& $faltan)) { return }
  Write-Host "   Instalando Microsoft Visual C++ 2015-2022 (lo necesita PostgreSQL)..."
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install -e --id Microsoft.VCRedist.2015+.x64 --silent --accept-package-agreements --accept-source-agreements --disable-interactivity | Out-Null
  }
  if (& $faltan) {
    $exe = Join-Path $env:TEMP 'vc_redist.x64.exe'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest 'https://aka.ms/vs/17/release/vc_redist.x64.exe' -OutFile $exe -UseBasicParsing
    Start-Process -FilePath $exe -ArgumentList '/install', '/quiet', '/norestart' -Wait | Out-Null
  }
  if (& $faltan) { throw "Falta Microsoft Visual C++ 2015-2022 (x64): $((& $faltan) -join ', '). Instálelo desde https://aka.ms/vs/17/release/vc_redist.x64.exe y vuelva a ejecutar el instalador." }
  Listo 'Microsoft Visual C++ instalado'
}
# Instala el PostgreSQL 16 que viene DENTRO del instalador (no se descarga nada):
# C:\FactPOS\postgresql, datos en C:\FactPOS\postgresql\data, servicio FactPOS-PostgreSQL.
function InstalarPostgresIncluido {
  $fuente = Join-Path $origen 'postgresql'
  if (-not (Test-Path -LiteralPath (Join-Path $fuente 'bin\postgres.exe'))) { throw "Este paquete no trae PostgreSQL (falta postgresql\bin\postgres.exe). Vuelva a generar el instalador con npm run empaquetar." }
  AsegurarVcRedist
  # Otro programa (u otro PostgreSQL) puede estar usando el 5432: se elige el primero libre.
  # El puerto puede venir de un .env viejo que apuntaba a OTRO PostgreSQL (p. ej. HikCentral): si está ocupado, se busca otro.
  if ($script:PuertoPostgres -ne 0 -and (PuertoOcupado $script:PuertoPostgres)) {
    Write-Host "   El puerto $($script:PuertoPostgres) guardado está ocupado por otro programa; se elige uno libre" -ForegroundColor Yellow
    $script:PuertoPostgres = 0
  }
  if ($script:PuertoPostgres -eq 0) {
    $p = 5432
    while ((PuertoOcupado $p) -and $p -lt 5460) { $p++ }
    if ($p -ne 5432) { Write-Host "   El puerto 5432 está ocupado por otro programa: PostgreSQL de FactPOS usará el $p" -ForegroundColor Yellow }
    $script:PuertoPostgres = $p
  }
  if (-not $script:ClavePostgres) { $script:ClavePostgres = Clave 20 }
  # La clave se guarda ANTES de instalar (si algo falla a medias, no se pierde)
  New-Item -ItemType Directory -Force -Path $Carpeta | Out-Null
  Set-Content -Path $archivoClave -Value "Usuario: postgres`r`nClave: $($script:ClavePostgres)"
  icacls $archivoClave /inheritance:r /grant:r "*S-1-5-32-544:F" "*S-1-5-18:F" 2>$null | Out-Null

  $dir = Join-Path $Carpeta 'postgresql'
  $datos = Join-Path $dir 'data'
  Write-Host "   Copiando PostgreSQL 16 (incluido en el instalador)..."
  robocopy $fuente $dir /E /NFL /NDL /NJH /NJS /NP /XD data | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "No se pudo copiar PostgreSQL a $dir (robocopy $LASTEXITCODE)" }
  if (-not (Test-Path -LiteralPath (Join-Path $datos 'PG_VERSION'))) {
    Write-Host "   Creando la base de datos de FactPOS..."
    $pw = Join-Path $env:TEMP ("fpg-" + [guid]::NewGuid().ToString('N') + ".txt")
    [IO.File]::WriteAllText($pw, $script:ClavePostgres)
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
      & (Join-Path $dir 'bin\initdb.exe') -D $datos -U postgres -A scram-sha-256 "--pwfile=$pw" -E UTF8 --locale=C 2>&1 | ForEach-Object { Write-Host "   $_" }
      $codigo = $LASTEXITCODE
    } finally { $ErrorActionPreference = $eap; Remove-Item -LiteralPath $pw -Force -ErrorAction SilentlyContinue }
    if ($codigo -ne 0) { throw "No se pudo crear la base de datos (initdb terminó con código $codigo)" }
    Add-Content -LiteralPath (Join-Path $datos 'postgresql.conf') -Encoding ascii -Value "`r`n# FactPOS`r`nport = $($script:PuertoPostgres)`r`nlisten_addresses = 'localhost'`r`n"
  }
  # El servicio corre como "Servicio de red": necesita control de la carpeta de datos
  icacls $datos /grant "*S-1-5-20:(OI)(CI)F" /T /Q 2>$null | Out-Null
  if (-not (Get-Service -Name 'FactPOS-PostgreSQL' -ErrorAction SilentlyContinue)) {
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
      & (Join-Path $dir 'bin\pg_ctl.exe') register -N 'FactPOS-PostgreSQL' -D $datos -S auto -U 'NT AUTHORITY\NetworkService' -w 2>&1 | ForEach-Object { Write-Host "   $_" }
      $codigo = $LASTEXITCODE
    } finally { $ErrorActionPreference = $eap }
    if ($codigo -ne 0) { throw "No se pudo registrar el servicio FactPOS-PostgreSQL (pg_ctl terminó con código $codigo)" }
  }
  $pg = PostgresFactPOS
  if (-not $pg -or $pg.Servicio -ne 'FactPOS-PostgreSQL') { throw "El servicio FactPOS-PostgreSQL no quedó registrado" }
  $pg = AsegurarPuertoPropio $pg
  Listo "PostgreSQL 16 de FactPOS listo (servicio FactPOS-PostgreSQL, puerto $($pg.Puerto)). Clave del superusuario en $archivoClave"
  return $pg
}
# Reinstalación: la clave de postgres y el puerto ya quedaron guardados la primera vez
$archivoClave = "$Carpeta\postgres-superusuario.txt"
if (-not $ClavePostgres -and (Test-Path $archivoClave)) {
  $m = Select-String -Path $archivoClave -Pattern '^Clave:\s*(\S+)' | Select-Object -First 1
  if ($m) { $ClavePostgres = $m.Matches[0].Groups[1].Value; Listo "Se usa la clave de PostgreSQL guardada en la instalación anterior" }
}
if ($PuertoPostgres -eq 0 -and (Test-Path "$Carpeta\.env")) {
  $m = Select-String -Path "$Carpeta\.env" -Pattern '^DATABASE_URL=.*@[^:/]+:(\d+)/' | Select-Object -First 1
  if ($m) { $PuertoPostgres = [int]$m.Matches[0].Groups[1].Value }
}
if ($esReparacion) {
  Listo 'Reparacion: no se instalara ni modificara PostgreSQL.'
} else {
# Siempre el PostgreSQL PROPIO de FactPOS: si ya existe (instalado antes por FactPOS) se reutiliza;
# si no, se instala el que viene dentro del instalador. Nunca se usa el de otro programa.
$pgPropio = PostgresFactPOS
if ($pgPropio) {
  if (-not $ClavePostgres) { throw "Ya hay un PostgreSQL de FactPOS ($($pgPropio.Servicio)) pero falta $archivoClave con su clave. Copie ese archivo de la instalación anterior a $Carpeta y vuelva a ejecutar el instalador." }
  $pgPropio = AsegurarPuertoPropio $pgPropio
  Listo "Se usa el PostgreSQL de FactPOS ya instalado ($($pgPropio.Servicio), puerto $($pgPropio.Puerto))"
} else {
  $otros = @(ServiciosPostgres | ForEach-Object { $_.Name })
  if ($otros.Count) { Write-Host "   Este equipo ya tiene otro PostgreSQL ($($otros -join ', ')): no se toca; FactPOS instala el suyo aparte." -ForegroundColor Yellow }
  $pgPropio = InstalarPostgresIncluido
}
$PuertoPostgres = $pgPropio.Puerto

 }
# Antes de actualizar archivos compilados, detener SOLO el servidor de esta instalación.
# No tocar otros procesos Node.js ni eliminar configuración o base de datos.
if (Test-Path (Join-Path $Carpeta 'apps\servidor\dist\index.js')) {
  Paso "Deteniendo servidor anterior para actualizar"
  Stop-ScheduledTask -TaskName 'FactPOS Servidor' -ErrorAction SilentlyContinue
  $limite = (Get-Date).AddSeconds(15)
  do {
    $procesos = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object {
      $_.CommandLine -match 'apps[\\/]servidor[\\/]dist[\\/]index\.js' -and
      $_.ExecutablePath -and
      (($_.CommandLine -match [regex]::Escape($Carpeta)) -or
       ($_.CommandLine -notmatch '[A-Za-z]:[\\/]' -and (Get-NetTCPConnection -LocalPort $Puerto -State Listen -ErrorAction SilentlyContinue | Where-Object OwningProcess -eq $_.ProcessId)))
    })
    if ($procesos.Count -eq 0) { break }
    foreach ($proc in $procesos) { Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $limite)
  if (Get-NetTCPConnection -LocalPort $Puerto -State Listen -ErrorAction SilentlyContinue) {
    throw "El puerto $Puerto sigue ocupado. Cierre el servidor anterior antes de actualizar."
  }
}
# Las ventanas de FactPOS (Caja / Administración) y el túnel de esta carpeta bloquean sus archivos:
# si siguen abiertos, la copia se queda esperando para siempre. Se cierran antes de copiar.
if (Test-Path $Carpeta) {
  $prefijo = ($Carpeta.TrimEnd('\') + '\').ToLower()
  $abiertos = @(Get-CimInstance Win32_Process -Filter "Name='FactPOS-Escritorio.exe' OR Name='cloudflared.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.ToLower().StartsWith($prefijo) })
  if ($abiertos.Count) {
    Write-Host "   Cerrando FactPOS Caja/Administración abiertas para poder actualizar sus archivos..."
    foreach ($proc in $abiertos) { Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
  }
}

# ------------------------------------------------------------- Archivos
Paso "Copiando FactPOS a $Carpeta"
New-Item -ItemType Directory -Force -Path $Carpeta, "$Carpeta\logs" | Out-Null
# /R:2 /W:2: un archivo bloqueado falla en segundos con un mensaje claro (por defecto robocopy
# reintenta un millón de veces cada 30 s y la instalación parece colgada). /MT acelera la copia.
$salidaCopia = robocopy $origen $Carpeta /E /MT:16 /R:2 /W:2 /NFL /NDL /NJH /NJS /NP /XF .env postgres-superusuario.txt /XD logs postgresql respaldos 2>&1
$codigoCopia = $LASTEXITCODE
if ($codigoCopia -ge 8) {
  $errores = @($salidaCopia | Where-Object { "$_" -match 'ERROR|Acceso denegado|Access is denied|being used|usa otro proceso' } | Select-Object -First 5 | ForEach-Object { "$_".Trim() })
  throw ("No se pudieron copiar los archivos (robocopy $codigoCopia). Cierre FactPOS (Caja/Administración) y los antivirus que bloqueen " + $Carpeta + " y vuelva a ejecutar el instalador. " + ($errores -join ' | '))
}
Listo "Archivos copiados"

# ---------------------------------------------------------- Base de datos
Paso "Base de datos"
if ($esReparacion) {
  if (-not (Test-Path -LiteralPath $envExistente)) { throw 'Falta .env de la instalacion existente.' }
  Listo 'Se conserva .env y la base de datos existente.'
} else {
$urlAdmin = UrlPg 'postgres' $ClavePostgres $PuertoPostgres 'postgres'
$existe = Bd sql $urlAdmin "SELECT 1 FROM pg_roles WHERE rolname='factpos'"
if ($script:CodigoBd -ne 0) {
  # La clave guardada no entra: en el PostgreSQL propio se restablece de forma segura
  Write-Host "   El superusuario postgres no entra con la clave guardada ($existe); se restablece..." -ForegroundColor Yellow
  RestablecerClavePostgres $pgPropio $ClavePostgres
  $existe = Bd sql $urlAdmin "SELECT 1 FROM pg_roles WHERE rolname='factpos'"
  if ($script:CodigoBd -ne 0) { throw "El superusuario postgres no entra a localhost:$($PuertoPostgres): $existe" }
}
$envArchivo = "$Carpeta\.env"
if ($existe -eq "1" -and (Test-Path $envArchivo)) {
  Listo "La base factpos ya existe; se conserva (actualización)"
  if ($Master -or $Empresa) {
    $vars = [ordered]@{ FACTPOS_EMPRESA = $Empresa; FACTPOS_PORTAL_URL = $Portal }
    if ($Master) { $vars.MODO = "central"; $vars.TUNEL = "cloudflare"; if ($Licencia) { $vars.LICENCIA_CLAVE = $Licencia } }
    $lineas = @(Get-Content $envArchivo | Where-Object { $l = $_; -not ($vars.Keys | Where-Object { $l -like "$_=*" }) })
    foreach ($k in $vars.Keys) { $lineas += "$k=$($vars[$k])" }
    $lineas | Set-Content -Path $envArchivo -Encoding UTF8
  }
  if ($CentralUrl) {
    $actual = Get-Content $envArchivo
    $yaEnlazado = [bool]($actual | Where-Object { $_ -match '^CENTRAL_CLAVE=fps_' })
    if ($Alta -and $yaEnlazado -and -not $Reenlazar) {
      $Alta = $false
      Listo "Este servidor ya está dado de alta en la central; se conserva (use -Reenlazar para darlo de alta de nuevo)"
    } else {
      # Conectar (o cambiar) la central sin tocar lo demás del .env
      $quitar = if ($PinSecreto) { '^(CENTRAL_URL|SUCURSAL_ID|CENTRAL_CLAVE|PIN_SECRETO)=' } else { '^(CENTRAL_URL|SUCURSAL_ID|CENTRAL_CLAVE)=' }
      $lineas = @($actual | Where-Object { $_ -notmatch $quitar })
      $lineas = @($lineas | Where-Object { $_ -notmatch '^(ALTA_CODIGO|ALTA_RNC)=' })
      $lineas += "CENTRAL_URL=$CentralUrl", "SUCURSAL_ID=$SucursalId", "CENTRAL_CLAVE=$CentralClave", "ALTA_CODIGO=$CodigoInstalacion", "ALTA_RNC=$Rnc"
      if ($PinSecreto) { $lineas += "PIN_SECRETO=$PinSecreto" }
      $lineas | Set-Content -Path $envArchivo -Encoding UTF8
      Listo $(if ($Alta) { "Lista para darse de alta en $CentralUrl" } else { "Conectada a la central $CentralUrl" })
    }
  }
} else {
  $claveBD = Clave 24
  # Usuario factpos + base factpos + comprobación de que entra con la clave que se va a guardar
  $r = Bd preparar $urlAdmin $claveBD
  if ($script:CodigoBd -ne 0) { throw "No se pudo preparar el usuario y la base factpos en localhost:$($PuertoPostgres): $r. No se escribió el .env." }
  if (-not $PinSecreto -and ($Alta -or $Master)) { $PinSecreto = Clave 32 }   # sucursal: lo reemplaza el del principal al darse de alta
  if (-not $PinSecreto) { $PinSecreto = Clave 32; Write-Host "   OJO: se generó un PIN_SECRETO nuevo. Si ya tiene central u otras sucursales, cópielo de allá al archivo .env" -ForegroundColor Yellow }
  @"
# FactPOS · servidor de sucursal (generado por el instalador)
DATABASE_URL=postgres://factpos:$claveBD@localhost:$PuertoPostgres/factpos
MODO=$(if ($Master) { "central" } else { "sucursal" })
PUERTO=$Puerto
HOST=0.0.0.0
NOMBRE_RED=$NombreRed
PIN_SECRETO=$PinSecreto
CLAVE_ACCESO=
# Sincronización con la central en la nube (vacío = la sucursal trabaja sola)
CENTRAL_URL=$CentralUrl
SUCURSAL_ID=$SucursalId
CENTRAL_CLAVE=$CentralClave
# Alta (se borran solas al quedar dado de alta)
ALTA_CODIGO=$CodigoInstalacion
ALTA_RNC=$Rnc
# Empresa en el portal de FactPOS (licencia, túnel, actualizaciones)
FACTPOS_EMPRESA=$Empresa
FACTPOS_PORTAL_URL=$Portal
TUNEL=$(if ($Master) { "cloudflare" } else { "" })
LICENCIA_CLAVE=$Licencia
CERT_P12_RUTA=
CERT_P12_CLAVE=
"@ | Set-Content -Path $envArchivo -Encoding UTF8
  icacls $envArchivo /inheritance:r /grant:r "*S-1-5-32-544:F" "*S-1-5-18:F" 2>$null | Out-Null
  Listo "Base factpos creada y .env escrito"
}
Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue

}
# Antes de una reparacion, guardar una copia consistente de la base de datos.
if ($esReparacion) {
  # Si otro PostgreSQL (HikCentral, WilPOS...) ocupa el puerto del PostgreSQL de FactPOS, se mueve
  # el de FactPOS a un puerto libre y se corrige el .env.
  $pgPropio = PostgresFactPOS
  if ($pgPropio) {
    Paso 'PostgreSQL de FactPOS'
    $pgPropio = AsegurarPuertoPropio $pgPropio
    $puertoEnv = if ($dbLine -match '@[^:/]+:(\d+)/') { [int]$Matches[1] } else { 5432 }
    if ($puertoEnv -ne $pgPropio.Puerto) {
      $dbLine = $dbLine -replace '(@[^:/]+:)\d+/', "`${1}$($pgPropio.Puerto)/"
      $lineasEnv = @(Get-Content -LiteralPath $envExistente | ForEach-Object { if ($_ -match '^DATABASE_URL=') { $dbLine } else { $_ } })
      $lineasEnv | Set-Content -LiteralPath $envExistente -Encoding UTF8
      Listo ".env corregido: la base de datos ahora es localhost:$($pgPropio.Puerto) (antes $puertoEnv, otro programa)"
    } else {
      Listo "PostgreSQL de FactPOS ($($pgPropio.Servicio)) en el puerto $($pgPropio.Puerto)"
    }
  }
  Paso 'Respaldo de seguridad'
  $urlBD = ($dbLine -replace '^DATABASE_URL=', '').Trim().Trim('"')
  # Comprobar que el usuario factpos del .env puede entrar. Si no (instalaciones anteriores
  # que ignoraron errores de psql), se le pone la clave del .env usando el superusuario guardado.
  $salida = Bd probar $urlBD
  if ($script:CodigoBd -ne 0) {
    Write-Host "   El usuario factpos no entra con la clave del .env: $salida" -ForegroundColor Yellow
    if (-not $ClavePostgres) {
      $ClavePostgres = Clave 20
      Set-Content -Path $archivoClave -Value "Usuario: postgres`r`nClave: $ClavePostgres"
      icacls $archivoClave /inheritance:r /grant:r "*S-1-5-32-544:F" "*S-1-5-18:F" 2>$null | Out-Null
    }
    $u = [uri]$urlBD
    $claveEnv = [uri]::UnescapeDataString($u.UserInfo.Split(':', 2)[1])
    $puertoBD = if ($u.Port -gt 0) { $u.Port } else { 5432 }
    $urlAdmin = UrlPg 'postgres' $ClavePostgres $puertoBD 'postgres'
    $r = Bd probar $urlAdmin
    if ($script:CodigoBd -ne 0 -and $pgPropio -and $puertoBD -eq $pgPropio.Puerto) {
      Write-Host "   La clave guardada de postgres no coincide con el PostgreSQL de FactPOS; se restablece..." -ForegroundColor Yellow
      RestablecerClavePostgres $pgPropio $ClavePostgres
      $r = Bd probar $urlAdmin
      if ($script:CodigoBd -eq 0) { Listo "Clave del superusuario postgres restablecida (guardada en $archivoClave)" }
    }
    if ($script:CodigoBd -ne 0) { throw "El superusuario postgres no entra a localhost:$($puertoBD): $r" }
    $r = Bd preparar $urlAdmin $claveEnv
    if ($script:CodigoBd -ne 0) { throw "No se pudo corregir el usuario factpos: $r" }
    Listo 'Clave del usuario factpos corregida (coincide con el .env)'
  }
  $carpetaBackup = Join-Path $Carpeta 'respaldos'
  New-Item -ItemType Directory -Force -Path $carpetaBackup | Out-Null
  $sello = Get-Date -Format 'yyyyMMdd-HHmmss'
  # Con pg_dump si el PostgreSQL de FactPOS lo trae (instalaciones con winget); si no, la copia de FactPOS (bd.cjs)
  $dump = if ($pgPropio -and $pgPropio.Bin) { Join-Path $pgPropio.Bin 'pg_dump.exe' } else { $null }
  if ($dump -and (Test-Path -LiteralPath $dump -PathType Leaf)) {
    $backup = Join-Path $carpetaBackup "factpos-antes-reparacion-$sello.dump"
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { & $dump --dbname=$urlBD --format=custom --file=$backup 2>&1 | ForEach-Object { Write-Host "   $_" }; $codigo = $LASTEXITCODE } finally { $ErrorActionPreference = $eap }
  } else {
    $backup = Join-Path $carpetaBackup "factpos-antes-reparacion-$sello.fpbak"
    Write-Host "   $(Bd respaldar $urlBD $backup)"
    $codigo = $script:CodigoBd
  }
  if ($codigo -ne 0 -or -not (Test-Path $backup) -or (Get-Item $backup).Length -eq 0) {
    Remove-Item $backup -ErrorAction SilentlyContinue
    throw 'No se pudo completar el respaldo. No se ejecutaran migraciones.'
  }
  Listo "Respaldo creado: $backup"
}
Paso 'Migraciones'
Push-Location $Carpeta
try {
  & node apps\servidor\dist\migrar.js 2>&1 | ForEach-Object { Write-Host $_ }
  $codigoMigracion = $LASTEXITCODE
  if ($codigoMigracion -ne 0) { throw "Fallaron las migraciones (codigo $codigoMigracion). Revise el error SQL anterior en instalacion.log." }
  if ($Demo -and -not $CentralUrl -and -not $Master -and -not $esReparacion) { & node apps\servidor\dist\semilla.js; if ($LASTEXITCODE -ne 0) { throw 'Error al cargar datos de demostracion' }; Listo 'Datos de demostracion cargados' }
  if ($CentralUrl) { Listo 'La sincronizacion con la central se realizara al arrancar' }
} finally { Pop-Location }

# ------------------------------------------------- Túnel (servidor principal)
if ($Master) {
  Paso "Túnel de Cloudflare (acceso desde internet sin abrir el router)"
  $cf = "$Carpeta\bin\cloudflared.exe"
  New-Item -ItemType Directory -Force -Path "$Carpeta\bin" | Out-Null
  if (-not (Test-Path $cf)) {
    try {
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      Invoke-WebRequest "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile $cf -UseBasicParsing
      Listo "cloudflared descargado"
    } catch {
      Write-Host "   OJO: no se pudo descargar cloudflared ($($_.Exception.Message)). Sin túnel, la web y las sucursales no llegan a este servidor; reinstale con internet." -ForegroundColor Yellow
    }
  } else { Listo "cloudflared ya estaba" }
}

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

# ---------------------------------------------------------- Respaldo diario
Paso "Respaldo diario automático"
$tareaRespaldo = "FactPOS Respaldo"
$psExe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$accionR = New-ScheduledTaskAction -Execute $psExe -WorkingDirectory $Carpeta `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Carpeta\instalador\respaldo-diario.ps1`""
$disparadorR = New-ScheduledTaskTrigger -Daily -At '23:30'
# StartWhenAvailable: si la PC estaba apagada a esa hora, el respaldo se hace al encenderla
$opcionesR = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2)
Unregister-ScheduledTask -TaskName $tareaRespaldo -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $tareaRespaldo -Action $accionR -Trigger $disparadorR -Settings $opcionesR -Principal $usuario | Out-Null
Listo "Copia diaria a las 11:30 p. m. en $Carpeta\respaldos (se guardan 14 días)"

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
# Accesos directos (antes de esperar, para que queden aunque el arranque tarde)
$escritorio = [Environment]::GetFolderPath("CommonDesktopDirectory")
$icono = "$Carpeta\instalador\factpos.ico"
function AccesoWeb($nombre, $url) {
  Set-Content "$escritorio\$nombre.url" "[InternetShortcut]`r`nURL=$url`r`nIconFile=$icono`r`nIconIndex=0"
}
Remove-Item "$escritorio\FactPOS - Servidor.url" -ErrorAction SilentlyContinue
AccesoWeb "FactPOS Administración" "http://localhost:$Puerto/admin/"
AccesoWeb "FactPOS Caja (navegador)" "http://localhost:$Puerto/terminal/"
Listo "Accesos en el escritorio: «FactPOS Administración» y «FactPOS Caja (navegador)»"

# La primera vez el servidor prepara la base de datos: puede tardar unos minutos en responder
$ok = $false
$desde = Get-Date
while (((Get-Date) - $desde).TotalSeconds -lt 300) {
  try { $s = Invoke-RestMethod "http://localhost:$Puerto/descubrir" -TimeoutSec 3; $ok = $true; break } catch { Start-Sleep -Seconds 3 }
  if ([int]((Get-Date) - $desde).TotalSeconds % 30 -lt 4) { Write-Host "   Arrancando el servidor por primera vez, por favor espere..." }
}
if (-not $ok) { throw "El servidor todavía no responde. Espere unos minutos y abra http://localhost:$Puerto/admin/ ; si no abre, revise $Carpeta\logs\servidor.log" }

Write-Host "`n========================================================" -ForegroundColor Green
Write-Host " FactPOS está funcionando en este equipo." -ForegroundColor Green
Write-Host " En cada caja ejecute instalar-caja.ps1 (encuentra este servidor solo)"
Write-Host " o abra en el navegador:"
foreach ($d in $s.direcciones) { Write-Host "     $d/terminal/" -ForegroundColor White }
Write-Host " Registro: $Carpeta\logs\servidor.log"
Write-Host "========================================================`n" -ForegroundColor Green

# ---------------------------------------------------------- Alta con código
if ($Master) {
  Paso "Servidor principal"
  Write-Host "   Abra http://localhost:$Puerto/admin/ en este equipo para la configuración inicial (empresa y usuario)."
  if ($Licencia) { Write-Host "   La licencia se activa sola en cuanto haya internet." } else { Write-Host "   Active la licencia en Administración › Licencia." }
  Write-Host "   Cuando la licencia esté activa, la administración web queda en $Portal/$Empresa/"
}
if ($Alta -and $NoInteractivo) {
  Paso "Alta de este servidor"
  Start-Sleep -Seconds 8
  try { $a = Invoke-RestMethod "http://localhost:$Puerto/alta.json" -TimeoutSec 5 } catch { $a = $null }
  if ($a.estado -eq "ENLAZADO") { Listo "Dado de alta como la sucursal «$($a.sucursal)»" }
  elseif ($a.codigo) { Write-Host "   Solicitud enviada (código $($a.codigo)): confírmela en Administración › Sucursales › Servidores esperando alta." }
  else { Write-Host "   El alta sigue en curso; su estado se ve en http://localhost:$Puerto/alta" }
}
if ($Alta -and -not $NoInteractivo) {
  Paso "Alta de este servidor en la Administración"
  $codigo = ""; $fin = (Get-Date).AddMinutes(30); $enlazado = $false
  if ($CodigoInstalacion) { Write-Host "   Canjeando el código de instalación $CodigoInstalacion..." } else { Write-Host "   Enviando la solicitud a la Administración..." }
  while ((Get-Date) -lt $fin) {
    try { $a = Invoke-RestMethod "http://localhost:$Puerto/alta.json" -TimeoutSec 3 } catch { $a = $null }
    if ($a.estado -eq "ENLAZADO") { $enlazado = $true; break }
    if ($a.codigo -and $a.codigo -ne $codigo) {
      $codigo = $a.codigo
      Write-Host ""
      if ($CodigoInstalacion) { Write-Host "   El código de instalación no sirvió (vencido, ya usado o mal escrito). Se envió una solicitud." -ForegroundColor Yellow }
      Write-Host "   Solicitud enviada. Este equipo es «$env:COMPUTERNAME», código:" -ForegroundColor White
      Write-Host "   ┌──────────────────────────────┐" -ForegroundColor White
      Write-Host ("   │   CÓDIGO:   {0,-17}│" -f $codigo) -ForegroundColor White
      Write-Host "   └──────────────────────────────┘" -ForegroundColor White
      Write-Host "   En la Administración › Sucursales y terminales › «Servidores esperando alta»"
      Write-Host "   aparece $env:COMPUTERNAME: pulse «Confirmar…», elija o cree la sucursal y confirme."
      Write-Host "   Esta ventana sigue sola cuando quede dado de alta. Enter = seguir sin esperar" -ForegroundColor DarkGray
      Write-Host "   (el código también se ve en http://localhost:$Puerto/alta)." -ForegroundColor DarkGray
    }
    if ($a.estado -eq "SIN_CONEXION" -and -not $codigo) { Write-Host "   Sin conexión con la nube ($($a.error)). Reintentando..." -ForegroundColor Yellow }
    try { if ([Console]::KeyAvailable -and [Console]::ReadKey($true).Key -eq "Enter") { break } } catch { }
    Start-Sleep -Seconds 3
  }
  if ($enlazado) {
    Listo "Dado de alta como la sucursal «$($a.sucursal)». Ya baja productos, precios y usuarios de la nube."
  } else {
    Write-Host "   Todavía sin dar de alta. El servidor sigue esperando: hágalo cuando quiera con el código de http://localhost:$Puerto/alta" -ForegroundColor Yellow
  }
}
