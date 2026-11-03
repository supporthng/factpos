<#
 FactPOS · Modo quiosco para la caja (Windows 10/11, cualquier edición)

 Deja una cuenta de Windows (la del cajero) SIN escritorio: al iniciar sesión solo se abre FactPOS Caja.
 No hay barra de tareas, ni menú Inicio, ni tecla Windows, ni Alt+Tab hacia otros programas, y se desactiva el
 Administrador de tareas. Para salir se usa Ctrl+Alt+Supr > Cerrar sesión (o la salida con permiso de la propia caja).

 Cómo se usa (como ADMINISTRADOR, desde una cuenta distinta a la del cajero):
   powershell -ExecutionPolicy Bypass -File modo-quiosco.ps1 -Accion Activar    -Usuario cajero
   powershell -ExecutionPolicy Bypass -File modo-quiosco.ps1 -Accion Desactivar -Usuario cajero
   powershell -ExecutionPolicy Bypass -File modo-quiosco.ps1 -Accion Estado    -Usuario cajero

 Requisitos: la cuenta del cajero ya debe haber iniciado sesión al menos una vez, y NO ser administradora.
 NUNCA lo active en la cuenta de administrador: no podría volver al escritorio (si pasa, ver «Desactivar»).
#>
param(
  [ValidateSet('Activar','Desactivar','Estado')][string]$Accion = 'Estado',
  [Parameter(Mandatory = $true)][string]$Usuario,
  [string]$Exe,            # por omisión se busca la caja instalada
  [string]$Argumentos      # por omisión: --modo=caja (y el servidor de esa instalación)
)
$ErrorActionPreference = 'Stop'

function Falla($m) { Write-Host "ERROR: $m" -ForegroundColor Red; exit 1 }
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Falla 'Ejecute este script como Administrador.'
}

# --- cuenta del cajero ---
try { $sid = (New-Object Security.Principal.NTAccount($Usuario)).Translate([Security.Principal.SecurityIdentifier]).Value }
catch { Falla "No existe la cuenta de Windows '$Usuario'." }
if ($sid -eq [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) { Falla 'Use una cuenta de cajero distinta a la suya (la de administrador no debe quedar en modo quiosco).' }
$perfil = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$sid" -ErrorAction SilentlyContinue).ProfileImagePath
if (-not $perfil) { Falla "La cuenta '$Usuario' todavía no ha iniciado sesión en este equipo. Inicie sesión una vez con ella y vuelva a ejecutar." }

# --- programa de la caja ---
if (-not $Exe) {
  foreach ($c in @('C:\FactPOS\escritorio\FactPOS-Escritorio.exe', (Join-Path $perfil 'AppData\Local\FactPOS\escritorio\FactPOS-Escritorio.exe'))) { if (Test-Path $c) { $Exe = $c; break } }
}
if ($Accion -eq 'Activar' -and (-not $Exe -or -not (Test-Path $Exe))) { Falla 'No encontré FactPOS Caja instalada. Indique la ruta con -Exe "C:\...\FactPOS-Escritorio.exe".' }
if (-not $Argumentos) {
  $Argumentos = '--modo=caja'
  if ($Exe -like 'C:\FactPOS\*') { $Argumentos += ' --servidor=http://127.0.0.1:3000' }
}

# --- registro de ese usuario (si no ha iniciado sesión ahora, se carga su archivo NTUSER.DAT) ---
$cargado = $false
$raiz = "Registry::HKEY_USERS\$sid"
if (-not (Test-Path $raiz)) {
  $antes = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $r = & reg.exe load "HKU\FactPOS_$sid" (Join-Path $perfil 'NTUSER.DAT') 2>&1
  $codigo = $LASTEXITCODE; $ErrorActionPreference = $antes
  if ($codigo -ne 0) { Falla "No pude abrir el perfil de '$Usuario' (¿está con la sesión iniciada en otro lugar?). $r" }
  $cargado = $true; $raiz = "Registry::HKEY_USERS\FactPOS_$sid"
}
try {
  $winlogon = "$raiz\Software\Microsoft\Windows NT\CurrentVersion\Winlogon"
  $directiva = "$raiz\Software\Microsoft\Windows\CurrentVersion\Policies\System"
  switch ($Accion) {
    'Activar' {
      New-Item -Path $winlogon -Force | Out-Null
      Set-ItemProperty -Path $winlogon -Name 'Shell' -Value ('"{0}" {1}' -f $Exe, $Argumentos)
      New-Item -Path $directiva -Force | Out-Null
      Set-ItemProperty -Path $directiva -Name 'DisableTaskMgr' -Value 1 -Type DWord
      Write-Host "Listo. '$Usuario' arrancará solo FactPOS Caja en el próximo inicio de sesión." -ForegroundColor Green
      Write-Host "Programa: $Exe $Argumentos"
      Write-Host "Para salir: Ctrl+Alt+Supr > Cerrar sesión. Para deshacerlo: -Accion Desactivar."
    }
    'Desactivar' {
      Remove-ItemProperty -Path $winlogon -Name 'Shell' -ErrorAction SilentlyContinue
      Remove-ItemProperty -Path $directiva -Name 'DisableTaskMgr' -ErrorAction SilentlyContinue
      Write-Host "Listo. '$Usuario' vuelve a tener su escritorio normal." -ForegroundColor Green
    }
    'Estado' {
      $s = (Get-ItemProperty $winlogon -ErrorAction SilentlyContinue).Shell
      if ($s) { Write-Host "ACTIVADO para '$Usuario': $s" } else { Write-Host "No está activado para '$Usuario'." }
    }
  }
} finally {
  if ($cargado) { [gc]::Collect(); Start-Sleep -Milliseconds 500; & reg.exe unload "HKU\FactPOS_$sid" | Out-Null }
}
