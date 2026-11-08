<#
  Valida un codigo de instalacion (o de enlace FPS1-...) ANTES de instalar, sin gastarlo.
  Lo usa el asistente al pulsar Siguiente. Imprime el motivo si falla (sin acentos: la consola de Windows los deforma).
  Salida: 0 = el codigo sirve; 1 = no sirve (el texto impreso dice por que).
#>
param(
  [string]$Codigo = "",
  [string]$CentralUrl = "",
  [string]$Empresa = "",
  [string]$Portal = "https://factpos.vercel.app"
)
$ErrorActionPreference = "Stop"
function Fallar($m) { Write-Output $m; exit 1 }

$Codigo = $Codigo.Trim()
if ($Codigo -match '^FPS1-(.+)$') {
  try {
    $b64 = $Matches[1].Trim().Replace('-', '+').Replace('_', '/')
    while ($b64.Length % 4) { $b64 += '=' }
    $d = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64)) | ConvertFrom-Json
    $Codigo = [string]$d.c
    if (-not $CentralUrl) { $CentralUrl = [string]$d.u }
  } catch { Fallar "El codigo de enlace esta incompleto o danado. Copielo completo desde la Administracion (Sucursales y terminales > Codigo de instalacion)." }
}
$Empresa = ($Empresa.Trim().ToLower() -replace '\s', '')
if (-not $CentralUrl -and $Empresa) {
  try {
    $c = Invoke-RestMethod "$($Portal.TrimEnd('/'))/licencias/cliente/$Empresa" -TimeoutSec 15
    if ($c.apiUrl) { $CentralUrl = [string]$c.apiUrl }
  } catch { }
}
if (-not $CentralUrl) { Fallar "No se encontro la central. Pegue el codigo de enlace (empieza con FPS1-) o escriba la direccion de la central." }
$CentralUrl = $CentralUrl.TrimEnd('/')
try {
  $cuerpo = @{ codigo = $Codigo } | ConvertTo-Json -Compress
  $r = Invoke-RestMethod "$CentralUrl/central/alta/verificar" -Method Post -ContentType 'application/json' -Body $cuerpo -TimeoutSec 20
} catch {
  $est = 0
  try { $est = [int]$_.Exception.Response.StatusCode } catch { }
  if ($est -eq 404 -or $est -eq 410) { Fallar "El codigo no sirve: esta mal escrito, ya se uso o vencio. Genere uno nuevo en la central (Sucursales y terminales > Codigo de instalacion)." }
  if ($est -eq 400) { Fallar "El codigo no tiene el formato correcto (por ejemplo K7PD-4QX9) o el codigo de enlace esta incompleto." }
  if ($est -eq 403) { Fallar "La central respondio 403: tiene activada la opcion Exigir dispositivo autorizado y bloquea a los servidores de sucursal. Actualice la central a la ultima version, o apague esa opcion un momento en Sistema > Seguridad." }
  if ($est -eq 429) { Fallar "Demasiados intentos con codigos incorrectos. Espere unos minutos y vuelva a intentar." }
  Fallar "No se pudo hablar con la central ($CentralUrl). Revise la conexion a internet y que la central este encendida."
}
Write-Output ("OK: sucursal " + $r.sucursal + " de " + $r.empresa)
exit 0
