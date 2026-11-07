# Prepara Windows para que el verificador no sea interrumpido (ejecutar UNA vez como administrador).
#   Clic derecho en este archivo > "Ejecutar con PowerShell" (o abrir PowerShell como administrador y ejecutarlo).
# Qué hace:
#   - Quita los avisos de Windows Update (incluida la ventana "Tenemos una actualización para ti" y los avisos de reinicio).
#   - Evita que Windows reinicie solo mientras haya una sesión abierta.
#   - Desactiva el centro de notificaciones y los avisos emergentes.
# Importante: con esto Windows NO avisa ni se reinicia solo para terminar sus actualizaciones. Reinicie el equipo
# a mano de vez en cuando (por ejemplo, de noche) para que se completen.
# Para deshacerlo: .\Preparar_Windows_Kiosco.ps1 -Deshacer

param([switch]$Deshacer)

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Ejecute este script como administrador." -ForegroundColor Red
    exit 1
}

$wu = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate"
$au = "$wu\AU"
$ex = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\Explorer"

if ($Deshacer) {
    Remove-ItemProperty -Path $au -Name NoAutoRebootWithLoggedOnUsers -ErrorAction SilentlyContinue
    Remove-ItemProperty -Path $wu -Name SetAutoRestartNotificationDisable, SetUpdateNotificationLevel, UpdateNotificationLevel -ErrorAction SilentlyContinue
    Remove-ItemProperty -Path $ex -Name DisableNotificationCenter -ErrorAction SilentlyContinue
    Remove-NetFirewallRule -DisplayName "FactPOS equipo en la red (verificador)" -ErrorAction SilentlyContinue
    Write-Host "Listo: Windows vuelve a su comportamiento normal." -ForegroundColor Green
    exit 0
}

New-Item -Path $au -Force | Out-Null
New-Item -Path $ex -Force | Out-Null
Set-ItemProperty -Path $au -Name NoAutoRebootWithLoggedOnUsers -Type DWord -Value 1
Set-ItemProperty -Path $wu -Name SetAutoRestartNotificationDisable -Type DWord -Value 1
Set-ItemProperty -Path $wu -Name SetUpdateNotificationLevel -Type DWord -Value 1
Set-ItemProperty -Path $wu -Name UpdateNotificationLevel -Type DWord -Value 2
Set-ItemProperty -Path $ex -Name DisableNotificationCenter -Type DWord -Value 1
# Para que Administración > Equipos en la red encuentre este verificador (UDP 41235, solo desde la red local)
$regla = "FactPOS equipo en la red (verificador)"
Remove-NetFirewallRule -DisplayName $regla -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName $regla -Direction Inbound -Action Allow -Protocol UDP -LocalPort 41235 -RemoteAddress "LocalSubnet","10.0.0.0/8","172.16.0.0/12","192.168.0.0/16" -Profile Any | Out-Null
Write-Host "Listo. Reinicie el equipo para aplicar los cambios." -ForegroundColor Green
