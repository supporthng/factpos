<#
  FactPOS · Instalador (Windows 10/11)

  Un solo instalador para todo. Lo abre "INSTALAR FactPOS.bat" con doble clic
  y pregunta qué se instala en esta computadora:
    1. Servidor de la tienda       (uno por sucursal; se da de alta con un código)
    2. Caja                        (encuentra sola el servidor en la red local)
    3. Servidor y caja en esta PC  (tiendas pequeñas con una sola computadora)
    4. Administración              (oficina o dueño; usa la nube, no necesita servidor)
#>
$ErrorActionPreference = "Stop"
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$aqui = $PSScriptRoot
function Correr($script, $argumentos = @{}) { & (Join-Path $aqui $script) @argumentos }

while ($true) {
  Clear-Host
  Write-Host ""
  Write-Host "  FactPOS · Instalador  " -ForegroundColor White -BackgroundColor DarkCyan
  Write-Host ""
  Write-Host "  ¿Qué va a instalar en esta computadora?"
  Write-Host ""
  Write-Host "   1. Servidor de la tienda" -ForegroundColor White
  Write-Host "      Uno por sucursal. Guarda las ventas y el inventario, sigue sin internet y se"
  Write-Host "      sincroniza con la Administración. Se da de alta con un código." -ForegroundColor DarkGray
  Write-Host "   2. Caja (terminal de venta)" -ForegroundColor White
  Write-Host "      Busca sola el servidor de la tienda en la red local y deja el acceso «FactPOS Caja»." -ForegroundColor DarkGray
  Write-Host "   3. Servidor y caja en esta misma computadora" -ForegroundColor White
  Write-Host "      Para tiendas con una sola PC." -ForegroundColor DarkGray
  Write-Host "   4. Administración" -ForegroundColor White
  Write-Host "      Para la oficina o el dueño: reportes y configuración de todas las sucursales." -ForegroundColor DarkGray
  Write-Host "      No necesita servidor (usa la nube)." -ForegroundColor DarkGray
  Write-Host ""
  Write-Host "   0. Salir" -ForegroundColor DarkGray
  Write-Host ""
  $op = "$(Read-Host "  Opción")".Trim()
  if ($op -eq "0") { exit 0 }
  if ($op -notin "1", "2", "3", "4") { continue }
  try {
    switch ($op) {
      "1" { Correr "instalar-todo-en-uno.ps1" @{ SinCaja = $true } }
      "2" { Correr "instalar-caja.ps1" }
      "3" { Correr "instalar-todo-en-uno.ps1" }
      "4" { Correr "instalar-administracion.ps1" }
    }
  } catch {
    Write-Host "`n   No se pudo terminar: $($_.Exception.Message)" -ForegroundColor Red
  }
  Write-Host ""
  $otra = Read-Host "  ¿Instalar otra cosa en esta computadora? (s/N)"
  if (-not $otra -or -not $otra.Trim().ToLower().StartsWith("s")) { exit 0 }
}
