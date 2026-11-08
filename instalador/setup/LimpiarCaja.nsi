; =====================================================================
; FactPOS · Desinstalador / limpieza total de una Caja (FactPOS-Caja-Limpiar.exe)
; Un solo archivo: lleva dentro instalador\desinstalar-caja.ps1 y lo ejecuta.
; Devuelve Windows a la normalidad (Explorador, Administrador de tareas, teclado) y borra
; accesos, configuración, caché y registros de la caja de este equipo.
;   makensis -DVERSION=0.1.0 -DPAQUETE=../../paquete/FactPOS -DSALIDA=../../paquete/FactPOS-Caja-Limpiar-0.1.0.exe LimpiarCaja.nsi
; =====================================================================
ManifestDPIAware true
SetCompressor lzma
RequestExecutionLevel admin

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!ifndef PAQUETE
  !define PAQUETE "..\..\paquete\FactPOS"
!endif
!ifndef SALIDA
  !define SALIDA "FactPOS-Caja-Limpiar.exe"
!endif

Name "FactPOS Caja · Limpieza"
Caption "FactPOS ${VERSION} · Desinstalar y limpiar la Caja"
OutFile "${SALIDA}"
BrandingText "FactPOS ${VERSION}"
ShowInstDetails show

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "FactPOS"
VIAddVersionKey "FileDescription" "Desinstalador y limpieza de la Caja de FactPOS"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "FactPOS"

!include "MUI2.nsh"
!include "LogicLib.nsh"

!define MUI_ICON "factpos.ico"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Spanish"

Function .onInit
  MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "Se va a borrar TODO lo de la caja FactPOS de esta computadora: accesos, configuración, caché y registros.$\r$\n$\r$\nLas ventas y los datos del negocio están en el servidor y no se tocan. Windows (barra de tareas, Administrador de tareas, teclado) queda como normal.$\r$\n$\r$\n¿Continuar?" IDYES siguiente
  Quit
  siguiente:
FunctionEnd

Section "Limpiar"
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File "${PAQUETE}\instalador\desinstalar-caja.ps1"
  StrCpy $0 "powershell.exe"
  ${If} ${FileExists} "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
    StrCpy $0 "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  ${EndIf}
  DetailPrint "Limpiando la caja…"
  nsExec::ExecToLog `"$0" -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\desinstalar-caja.ps1" -Silencioso`
  Pop $1
  ${If} $1 == "0"
    MessageBox MB_OK|MB_ICONINFORMATION "Caja desinstalada y limpia.$\r$\n$\r$\nPara volver a instalarla use FactPOS-Caja-Setup."
  ${Else}
    MessageBox MB_OK|MB_ICONEXCLAMATION "La limpieza terminó, pero algo no se pudo borrar (vea el detalle en la ventana).$\r$\n$\r$\nReinicie el equipo y ejecute esta limpieza otra vez."
  ${EndIf}
SectionEnd
