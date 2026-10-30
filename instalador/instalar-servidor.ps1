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
$pgBin = BuscarPsql
$serviciosExistentes = @(ServiciosPostgres)
if (-not $pgBin -and $serviciosExistentes.Count -gt 0) {
  $nombres = ($serviciosExistentes | ForEach-Object { "$($_.Name) ($($_.State))" }) -join ', '
  throw "PostgreSQL ya tiene un servicio instalado: $nombres. No se instalará otra copia ni se tocarán sus datos. No se encontró psql.exe; revise la ruta del ejecutable del servicio en services.msc o instale las herramientas cliente de esa misma versión."
}
if (-not $pgBin) {
  # Otro programa (u otro PostgreSQL) puede estar usando el 5432: se elige el primero libre
  if ($PuertoPostgres -eq 0) {
    $PuertoPostgres = 5432
    while ((PuertoOcupado $PuertoPostgres) -and $PuertoPostgres -lt 5450) { $PuertoPostgres++ }
    if ($PuertoPostgres -ne 5432) { Write-Host "   El puerto 5432 está ocupado por otro programa: PostgreSQL de FactPOS usará el $PuertoPostgres" -ForegroundColor Yellow }
  }
  if (-not $ClavePostgres) { $ClavePostgres = Clave 20 }
  # La clave se guarda ANTES de instalar (si algo falla a medias, no se pierde)
  $claveArchivo = "$Carpeta\postgres-superusuario.txt"
  New-Item -ItemType Directory -Force -Path $Carpeta | Out-Null
  Set-Content -Path $claveArchivo -Value "Usuario: postgres`r`nClave: $ClavePostgres"
  icacls $claveArchivo /inheritance:r /grant:r "*S-1-5-32-544:F" "*S-1-5-18:F" 2>$null | Out-Null
  $opciones = "--mode unattended --unattendedmodeui none --superpassword $ClavePostgres --serverport $PuertoPostgres --servicename postgresql-16"
  # Sin comillas internas: PowerShell 5 las rompe al pasarlas a winget (queda en C:\Program Files\PostgreSQL\16, lo normal)
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Host "   Preparando la base de datos (PostgreSQL 16). Puede tardar varios minutos; por favor espere..."
    EjecutarConAviso "winget" @("install", "-e", "--id", "PostgreSQL.PostgreSQL.16", "--silent", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity", "--override", "`"$opciones`"") | Out-Null
    $pgBin = EsperarPsql 600
  }
  if (-not $pgBin) {
    # Respaldo: instalador oficial de EDB descargado directo
    Write-Host "   winget no dejó PostgreSQL instalado; se descarga el instalador oficial..." -ForegroundColor Yellow
    $exe = Join-Path $env:TEMP "postgresql-16-windows-x64.exe"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest "https://get.enterprisedb.com/postgresql/postgresql-16.4-1-windows-x64.exe" -OutFile $exe -UseBasicParsing
    $codigo = EjecutarConAviso $exe @($opciones)
    if ($codigo -ne 0) { Write-Host "   El instalador de PostgreSQL terminó con código $codigo" -ForegroundColor Yellow }
    $pgBin = EsperarPsql 300
  }
  if (-not $pgBin) { throw "PostgreSQL no quedó instalado. Revise el registro de instalación y la disponibilidad de PostgreSQL 16 antes de reintentar." }
  Listo "PostgreSQL instalado. La clave del superusuario quedó en $claveArchivo"
} elseif (-not $ClavePostgres) {
  if ($PuertoPostgres -eq 0) { $PuertoPostgres = PuertoRegistrado }
  if ($NoInteractivo) { throw "Se detectó PostgreSQL existente, pero FactPOS no tiene credenciales guardadas. Por seguridad no se cambiará ninguna contraseña ni base de datos. Para instalar sin intervención, utilice una instancia dedicada a FactPOS o configure el acceso de PostgreSQL mediante un procedimiento administrativo seguro." }
  $seg = Read-Host "PostgreSQL ya está instalado. Escriba la clave del usuario postgres" -AsSecureString
  $ClavePostgres = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($seg))
}
$psql = $pgBin.FullName
if ($PuertoPostgres -eq 0) { $PuertoPostgres = PuertoRegistrado }
Listo "Usando $psql"

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

# ------------------------------------------------------------- Archivos
Paso "Copiando FactPOS a $Carpeta"
New-Item -ItemType Directory -Force -Path $Carpeta, "$Carpeta\logs" | Out-Null
robocopy $origen $Carpeta /E /NFL /NDL /NJH /NJS /NP /XF .env postgres-superusuario.txt /XD logs | Out-Null
if ($LASTEXITCODE -ge 8) { throw "No se pudieron copiar los archivos (robocopy $LASTEXITCODE)" }
Listo "Archivos copiados"

# ---------------------------------------------------------- Base de datos
Paso "Base de datos"
if ($esReparacion) {
  if (-not (Test-Path -LiteralPath $envExistente)) { throw 'Falta .env de la instalacion existente.' }
  Listo 'Se conserva .env y la base de datos existente.'
} else {
$env:PGPASSWORD = $ClavePostgres
$existe = & $psql -U postgres -h localhost -p $PuertoPostgres -tAc "SELECT 1 FROM pg_roles WHERE rolname='factpos'"
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
  if ($existe -eq "1") { & $psql -U postgres -h localhost -p $PuertoPostgres -c "ALTER ROLE factpos WITH LOGIN PASSWORD '$claveBD'" | Out-Null }
  else { & $psql -U postgres -h localhost -p $PuertoPostgres -c "CREATE ROLE factpos LOGIN PASSWORD '$claveBD'" | Out-Null }
  $hayBase = & $psql -U postgres -h localhost -p $PuertoPostgres -tAc "SELECT 1 FROM pg_database WHERE datname='factpos'"
  if ($hayBase -ne "1") { & $psql -U postgres -h localhost -p $PuertoPostgres -c "CREATE DATABASE factpos OWNER factpos" | Out-Null }
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
Remove-Item Env:\PGPASSWORD

}
# Antes de una reparacion, guardar una copia consistente de la base de datos.
if ($esReparacion) {
  Paso 'Respaldo de seguridad'
  # pg_dump va en la misma carpeta bin que psql.exe (registro, servicio, Program Files o PATH)
  $dump = $null
  $psqlEncontrado = BuscarPsql
  if ($psqlEncontrado) {
    $junto = Join-Path $psqlEncontrado.DirectoryName 'pg_dump.exe'
    if (Test-Path -LiteralPath $junto -PathType Leaf) { $dump = Get-Item -LiteralPath $junto }
  }
  if (-not $dump) {
    $c = Get-Command pg_dump.exe -ErrorAction SilentlyContinue
    if ($c) { $dump = Get-Item -LiteralPath $c.Source }
  }
  if (-not $dump) {
    foreach ($pf in @($env:ProgramW6432, $env:ProgramFiles, ${env:ProgramFiles(x86)}) | Where-Object { $_ } | Select-Object -Unique) {
      $dump = Get-ChildItem "$pf\PostgreSQL\*\bin\pg_dump.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
      if ($dump) { break }
    }
  }
  if ($dump) { Listo "Usando $($dump.FullName)" }
  if (-not $dump) { throw 'No se encontro pg_dump para respaldar la base existente. Reparacion detenida sin ejecutar migraciones.' }
  $urlBD = ($dbLine -replace '^DATABASE_URL=', '').Trim().Trim('"')
  $carpetaBackup = Join-Path $Carpeta 'respaldos'
  New-Item -ItemType Directory -Force -Path $carpetaBackup | Out-Null
  $backup = Join-Path $carpetaBackup ("factpos-antes-reparacion-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.dump')
  & $dump.FullName --dbname=$urlBD --format=custom --file=$backup 2>&1 | ForEach-Object { Write-Host $_ }
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $backup) -or (Get-Item $backup).Length -eq 0) {
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
