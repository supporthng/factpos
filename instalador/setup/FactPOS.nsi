; =====================================================================
; FactPOS · Instalador de Windows (FactPOS-Setup.exe)
;
; Asistente con ventanas: tipo de instalación, datos, impresora, carpeta,
; progreso y final. Por debajo usa los scripts de instalador\*.ps1 (sin
; preguntas: -NoInteractivo), así una sola lógica sirve para todo.
;
; Se arma con NSIS (también en Linux):
;   makensis -DVERSION=0.1.0 -DPAQUETE=../../paquete/FactPOS -DSALIDA=../../paquete/FactPOS-Setup-0.1.0.exe FactPOS.nsi
; (scripts/empaquetar.mjs lo hace solo si encuentra makensis)
; =====================================================================
; Se usa el stub Unicode estandar de NSIS (x86), compatible con Windows x64.
; La aplicacion Electron incluida sigue siendo x64.
ManifestDPIAware true
SetCompressor /SOLID lzma
RequestExecutionLevel admin

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!ifndef PAQUETE
  !define PAQUETE "..\..\paquete\FactPOS"
!endif
!ifndef SALIDA
  !define SALIDA "FactPOS-Setup.exe"
!endif

!define REGSERV "Software\Microsoft\Windows\CurrentVersion\Uninstall\FactPOS"
!define REGCLI "Software\Microsoft\Windows\CurrentVersion\Uninstall\FactPOS Cliente"

Name "FactPOS"
Caption "FactPOS ${VERSION} · Instalación"
OutFile "${SALIDA}"
InstallDir "C:\FactPOS"
BrandingText "FactPOS ${VERSION}"
ShowInstDetails show
ShowUninstDetails show

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "FactPOS"
VIAddVersionKey "FileDescription" "Instalador de FactPOS"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "FactPOS"

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "TextFunc.nsh"
!include "FileFunc.nsh"

!define MUI_ICON "factpos.ico"
!define MUI_UNICON "factpos.ico"
!define MUI_WELCOMEFINISHPAGE_BITMAP "bienvenida.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "bienvenida.bmp"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP "encabezado.bmp"
!define MUI_ABORTWARNING
!define MUI_ABORTWARNING_TEXT "¿Cancelar la instalación de FactPOS?"

Var Tipo          ; master (completa) | servidor | caja | admin
Var Empresa
Var Licencia
Var Codigo
Var Servidor
Var Destino
Var Vende         ; 1 = esta PC también vende (caja aquí)
Var ClavePg
Var PgInstalado
Var TextoFinal
Var Abrir
Var Fallo
Var Registro    ; archivo con todo lo que mostró la instalación
Var Accion        ; nuevo | actualizar | modificar
Var ServLoc       ; carpeta del servidor ya instalado ("" si no hay)
Var ServVer
Var ServTipo
Var CliLoc        ; Caja / Administración ya instaladas ("" si no hay)
Var CliVer
Var BorrarDatos   ; desinstalador: 1 = borrar configuración, registros y respaldos
Var Modo          ; desinstalador: servidor | cliente
Var hA2
Var hA3
Var hBorrar
Var PowerShell  ; powershell.exe de 64 bits si Windows es x64 (el stub NSIS es x86)

; controles
Var hR1
Var hR2
Var hR3
Var hR4
Var hEmpresa
Var hLicencia
Var hCodigo
Var hServidor
Var hDestino
Var hVende
Var hClavePg

; ------------------------------------------------------------------ páginas
!define MUI_WELCOMEPAGE_TITLE "Bienvenido a FactPOS ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "Este asistente instala FactPOS en esta computadora.$\r$\n$\r$\nPuede instalar el servidor principal de su negocio, el servidor de una sucursal, una caja o la aplicación de administración.$\r$\n$\r$\nTenga a mano el nombre corto de su empresa y, si la tiene, su clave de licencia.$\r$\n$\r$\nPulse Siguiente para continuar."
!insertmacro MUI_PAGE_WELCOME
Page custom PaginaExistente PaginaExistenteSalir
Page custom PaginaTipo PaginaTipoSalir
Page custom PaginaDatos PaginaDatosSalir
; La impresora se elige después: la caja imprime por la predeterminada de Windows
!define MUI_PAGE_CUSTOMFUNCTION_PRE SaltarCarpeta
!define MUI_DIRECTORYPAGE_TEXT_TOP "FactPOS se instalará en esta carpeta. Los datos quedan en la base de datos del equipo."
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TITLE "FactPOS quedó instalado"
!define MUI_FINISHPAGE_TEXT "$TextoFinal"
!define MUI_FINISHPAGE_TEXT_LARGE
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Abrir FactPOS ahora"
!define MUI_FINISHPAGE_RUN_FUNCTION AbrirFactPOS
!define MUI_PAGE_CUSTOMFUNCTION_PRE PrepararFinal
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
UninstPage custom un.PaginaDatos un.PaginaDatosSalir
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "Spanish"

; ------------------------------------------------------------------ inicio
Function .onInit
  StrCpy $Tipo "master"
  StrCpy $Vende "1"
  StrCpy $Fallo "0"
  ; La clave de PostgreSQL se gestiona en el script del servidor.
  ; No solicitar credenciales en el asistente gráfico.
  StrCpy $PgInstalado "0"
  StrCpy $Accion "nuevo"

  ; ---- ¿Ya hay FactPOS instalado en esta PC?
  ReadRegStr $ServLoc HKLM "${REGSERV}" "InstallLocation"
  ReadRegStr $ServVer HKLM "${REGSERV}" "DisplayVersion"
  ReadRegStr $ServTipo HKLM "${REGSERV}" "FactPOSTipo"
  ReadRegStr $Empresa HKLM "${REGSERV}" "FactPOSEmpresa"
  ReadRegStr $CliLoc HKLM "${REGCLI}" "InstallLocation"
  ReadRegStr $CliVer HKLM "${REGCLI}" "DisplayVersion"
  ; Versiones anteriores guardaban la Caja/Administración en la clave del servidor
  ${If} $ServLoc == "$LOCALAPPDATA\FactPOS"
    ${If} $CliLoc == ""
      StrCpy $CliLoc $ServLoc
      StrCpy $CliVer $ServVer
    ${EndIf}
    StrCpy $ServLoc ""
    StrCpy $ServVer ""
    StrCpy $ServTipo ""
    StrCpy $Empresa ""
  ${EndIf}
  ; Sin clave de registro (instalación muy antigua o dañada): se busca en las carpetas
  ${If} $ServLoc == ""
  ${AndIf} ${FileExists} "C:\FactPOS\apps\servidor\dist\index.js"
    StrCpy $ServLoc "C:\FactPOS"
    StrCpy $ServVer "anterior"
  ${EndIf}
  ; La clave existe pero la carpeta ya no (la borraron a mano): no hay nada que administrar
  ${If} $ServLoc != ""
  ${AndIfNot} ${FileExists} "$ServLoc\apps\servidor\dist\index.js"
    StrCpy $ServLoc ""
    StrCpy $ServVer ""
    StrCpy $ServTipo ""
  ${EndIf}
  ${If} $CliLoc == ""
  ${AndIf} ${FileExists} "$LOCALAPPDATA\FactPOS\Desinstalar FactPOS.exe"
    StrCpy $CliLoc "$LOCALAPPDATA\FactPOS"
    StrCpy $CliVer "anterior"
  ${EndIf}
  ${If} $CliLoc != ""
  ${AndIfNot} ${FileExists} "$CliLoc\Desinstalar FactPOS.exe"
    StrCpy $CliLoc ""
    StrCpy $CliVer ""
  ${EndIf}
  ${If} $ServLoc != ""
    StrCpy $INSTDIR $ServLoc
    ${If} $Empresa == ""
      Call LeerEmpresaEnv
    ${EndIf}
  ${EndIf}
FunctionEnd

; Lee FACTPOS_EMPRESA del .env de la instalación existente (para no volver a pedirlo)
Function LeerEmpresaEnv
  ${IfNot} ${FileExists} "$ServLoc\.env"
    Return
  ${EndIf}
  ClearErrors
  FileOpen $1 "$ServLoc\.env" r
  IfErrors sinarchivo
  leer:
    ClearErrors
    FileRead $1 $2
    IfErrors cerrar
    StrCpy $3 $2 16
    StrCmp $3 "FACTPOS_EMPRESA=" 0 leer
    StrCpy $2 $2 "" 16
  recortar:
    StrCpy $3 $2 1 -1
    StrCmp $3 "$\r" quitar
    StrCmp $3 "$\n" quitar
    Goto listo
  quitar:
    StrCpy $2 $2 -1
    Goto recortar
  listo:
    StrCpy $Empresa $2
  cerrar:
    FileClose $1
  sinarchivo:
FunctionEnd

; ------------------------------------------------------------------ 0. instalación existente
Function PaginaExistente
  ${If} $ServLoc == ""
  ${AndIf} $CliLoc == ""
    Abort
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "FactPOS ya está instalado" "Elija qué desea hacer con la instalación que ya tiene."
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  StrCpy $4 ""
  ${If} $ServLoc != ""
    StrCpy $4 "Servidor: versión $ServVer, en $ServLoc$\r$\n"
  ${EndIf}
  ${If} $CliLoc != ""
    StrCpy $4 "$4Caja / Administración: versión $CliVer$\r$\n"
  ${EndIf}
  StrCpy $4 "$4Este instalador: versión ${VERSION}"
  ${NSD_CreateLabel} 0 0 100% 34u "$4"
  Pop $0
  ${NSD_CreateRadioButton} 0 40u 100% 12u "Actualizar o reparar esta instalación"
  Pop $hR1
  ${NSD_AddStyle} $hR1 ${WS_GROUP}
  ${NSD_CreateLabel} 12u 53u -12u 18u "Instala la versión ${VERSION} sobre la actual. Conserva sus datos, la base de datos y la configuración."
  Pop $0
  ${NSD_CreateRadioButton} 0 76u 100% 12u "Modificar"
  Pop $hA2
  ${NSD_CreateLabel} 12u 89u -12u 18u "Cambiar qué se instala en esta computadora (servidor, caja o administración)."
  Pop $0
  ${NSD_CreateRadioButton} 0 112u 100% 12u "Desinstalar FactPOS"
  Pop $hA3
  ${NSD_CreateLabel} 12u 125u -12u 18u "Quita los programas de FactPOS de esta computadora. Después podrá elegir si conserva sus datos."
  Pop $0
  ${If} $Accion == "modificar"
    ${NSD_Check} $hA2
  ${Else}
    ${NSD_Check} $hR1
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function PaginaExistenteSalir
  ${NSD_GetState} $hA2 $0
  ${NSD_GetState} $hA3 $1
  ${If} $1 == ${BST_CHECKED}
    MessageBox MB_YESNO|MB_ICONQUESTION "¿Desinstalar FactPOS de esta computadora?" IDYES siDesinstalar
    Abort
    siDesinstalar:
    Call DesinstalarExistente
    Quit
  ${EndIf}
  ${If} $0 == ${BST_CHECKED}
    StrCpy $Accion "modificar"
  ${Else}
    StrCpy $Accion "actualizar"
  ${EndIf}
  ${If} $ServLoc != ""
    StrCpy $INSTDIR $ServLoc
    ${If} $ServTipo == "servidor"
      StrCpy $Tipo "servidor"
    ${Else}
      StrCpy $Tipo "master"
    ${EndIf}
  ${Else}
    StrCpy $Tipo "caja"
  ${EndIf}
FunctionEnd

; Ejecuta el desinstalador de cada parte instalada y espera a que termine
Function DesinstalarExistente
  ${If} $ServLoc != ""
    ${If} ${FileExists} "$ServLoc\Desinstalar FactPOS.exe"
      ExecWait '"$ServLoc\Desinstalar FactPOS.exe" _?=$ServLoc' $0
      ${If} $0 == 0
        Delete "$ServLoc\Desinstalar FactPOS.exe"
        RMDir "$ServLoc"
      ${EndIf}
    ${Else}
      MessageBox MB_ICONEXCLAMATION "No se encontró el desinstalador del servidor en $ServLoc. Quite FactPOS desde Configuración › Aplicaciones."
    ${EndIf}
  ${EndIf}
  ${If} $CliLoc != ""
    ${If} ${FileExists} "$CliLoc\Desinstalar FactPOS.exe"
      ExecWait '"$CliLoc\Desinstalar FactPOS.exe" _?=$CliLoc' $0
      ${If} $0 == 0
        Delete "$CliLoc\Desinstalar FactPOS.exe"
        RMDir "$CliLoc"
      ${EndIf}
    ${EndIf}
  ${EndIf}
FunctionEnd

; ------------------------------------------------------------------ 1. tipo
Function PaginaTipo
  ${If} $Accion == "actualizar"
  ${AndIf} $ServLoc != ""
    Abort
  ${EndIf}
  !insertmacro MUI_HEADER_TEXT "¿Qué es esta computadora?" "Elija qué parte de FactPOS se instala aquí."
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateRadioButton} 0 0 100% 12u "Instalación completa (Caja + Administración + Servidor)"
  Pop $hR1
  ${NSD_AddStyle} $hR1 ${WS_GROUP}
  ${NSD_CreateLabel} 12u 13u -12u 18u "Instala el servidor local y los accesos de Caja y Administración en esta PC."
  Pop $0
  ${NSD_CreateRadioButton} 0 36u 100% 12u "Solo Servidor"
  Pop $hR2
  ${NSD_CreateLabel} 12u 49u -12u 18u "Instala el servidor local sin Caja. Las terminales se conectan desde otros equipos."
  Pop $0
  ${NSD_CreateRadioButton} 0 72u 100% 12u "Solo Caja (terminal de venta)"
  Pop $hR3
  ${NSD_CreateLabel} 12u 85u -12u 18u "Encuentra sola el servidor de la tienda en la red y deja el acceso «FactPOS Caja» en pantalla completa."
  Pop $0
  ${NSD_CreateRadioButton} 0 108u 100% 12u "Solo Administración"
  Pop $hR4
  ${NSD_CreateLabel} 12u 121u -12u 18u "Para la oficina o el dueño: abre la administración de su empresa en su propia ventana. No necesita servidor."
  Pop $0

  ${If} $Tipo == "servidor"
    ${NSD_Check} $hR2
  ${ElseIf} $Tipo == "caja"
    ${NSD_Check} $hR3
  ${ElseIf} $Tipo == "admin"
    ${NSD_Check} $hR4
  ${Else}
    ${NSD_Check} $hR1
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function PaginaTipoSalir
  ${NSD_GetState} $hR2 $0
  ${NSD_GetState} $hR3 $1
  ${NSD_GetState} $hR4 $2
  ${If} $0 == ${BST_CHECKED}
    StrCpy $Tipo "servidor"
  ${ElseIf} $1 == ${BST_CHECKED}
    StrCpy $Tipo "caja"
  ${ElseIf} $2 == ${BST_CHECKED}
    StrCpy $Tipo "admin"
  ${Else}
    StrCpy $Tipo "master"
  ${EndIf}
FunctionEnd

; ------------------------------------------------------------------ 2. datos
Function PaginaDatos
  nsDialogs::Create 1018
  Pop $0
  ${If} $Tipo == "master"
  ${OrIf} $Tipo == "servidor"
    !insertmacro MUI_HEADER_TEXT "Servidor FactPOS" "Su empresa y su licencia de FactPOS."
    ${NSD_CreateLabel} 0 0 100% 10u "Nombre corto de su empresa (se lo da su proveedor, ej. royalliquorstore):"
    Pop $0
    ${NSD_CreateText} 0 11u 60% 12u "$Empresa"
    Pop $hEmpresa
    ${NSD_SetFocus} $hEmpresa
    ${NSD_CreateLabel} 0 30u 100% 10u "Clave de licencia (FPS-XXXX-XXXX-XXXX-XXXX). Puede dejarla vacía y activarla después:"
    Pop $0
    ${NSD_CreateText} 0 41u 60% 12u "$Licencia"
    Pop $hLicencia
    ${NSD_CreateCheckBox} 0 62u 100% 12u "Esta computadora también vende (instalar una caja aquí)"
    Pop $hVende
  ${ElseIf} $Tipo == "sucursal"
    !insertmacro MUI_HEADER_TEXT "Servidor de sucursal" "A qué empresa pertenece esta tienda."
    ${NSD_CreateLabel} 0 0 100% 10u "Nombre corto de su empresa (ej. royalliquorstore):"
    Pop $0
    ${NSD_CreateText} 0 11u 60% 12u "$Empresa"
    Pop $hEmpresa
    ${NSD_SetFocus} $hEmpresa
    ${NSD_CreateLabel} 0 30u 100% 10u "Código de instalación de la sucursal (opcional, ej. K7PD-4QX9):"
    Pop $0
    ${NSD_CreateText} 0 41u 40% 12u "$Codigo"
    Pop $hCodigo
    ${NSD_CreateLabel} 0 56u 100% 18u "Con el código queda dada de alta sola. Sin código, la sucursal aparece en el servidor principal, en Sucursales › Servidores esperando alta, para confirmarla."
    Pop $0
    ${NSD_CreateCheckBox} 0 78u 100% 12u "Esta computadora también vende (instalar una caja aquí)"
    Pop $hVende
  ${ElseIf} $Tipo == "caja"
    !insertmacro MUI_HEADER_TEXT "Caja" "El servidor de la tienda."
    ${NSD_CreateLabel} 0 0 100% 28u "El instalador busca solo el servidor FactPOS de esta tienda en la red local. Solo si no lo encuentra, escriba aquí su dirección IP (ej. 192.168.1.10):"
    Pop $0
    ${NSD_CreateText} 0 30u 50% 12u "$Servidor"
    Pop $hServidor
    ${NSD_SetFocus} $hServidor
  ${Else}
    !insertmacro MUI_HEADER_TEXT "Administración" "Qué administración abrir."
    ${NSD_CreateLabel} 0 0 100% 28u "Escriba el nombre corto de su empresa (ej. royalliquorstore) para la administración por internet, o la IP del servidor de su tienda (ej. 192.168.1.10) para la administración local, que funciona sin internet:"
    Pop $0
    ${NSD_CreateText} 0 30u 60% 12u "$Destino"
    Pop $hDestino
    ${NSD_SetFocus} $hDestino
  ${EndIf}

  ${If} $Tipo == "master"
  ${OrIf} $Tipo == "servidor"
    ${If} $Tipo == "servidor"
      EnableWindow $hVende 0
    ${ElseIf} $Vende == "1"
      ${NSD_Check} $hVende
    ${EndIf}

  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function PaginaDatosSalir
  ${If} $Tipo == "master"
  ${OrIf} $Tipo == "servidor"
    ${NSD_GetText} $hEmpresa $Empresa
    StrLen $0 $Empresa
    ${If} $0 < 3
      MessageBox MB_ICONEXCLAMATION "Escriba el nombre corto de su empresa (se lo da su proveedor de FactPOS)."
      Abort
    ${EndIf}
    ${NSD_GetState} $hVende $0
    ${If} $Tipo == "servidor"
      StrCpy $Vende "0"
    ${ElseIf} $0 == ${BST_CHECKED}
      StrCpy $Vende "1"
    ${Else}
      StrCpy $Vende "0"
    ${EndIf}

  ${EndIf}
  ${If} $Tipo == "master"
  ${OrIf} $Tipo == "servidor"
    ${NSD_GetText} $hLicencia $Licencia
  ${ElseIf} $Tipo == "sucursal"
    ${NSD_GetText} $hCodigo $Codigo
  ${ElseIf} $Tipo == "caja"
    ${NSD_GetText} $hServidor $Servidor
  ${ElseIf} $Tipo == "admin"
    ${NSD_GetText} $hDestino $Destino
    StrLen $0 $Destino
    ${If} $0 < 3
      MessageBox MB_ICONEXCLAMATION "Escriba el nombre corto de su empresa o la IP del servidor de su tienda."
      Abort
    ${EndIf}
  ${EndIf}
FunctionEnd


; ------------------------------------------------------------------ 4. carpeta (solo servidores)
Function SaltarCarpeta
  ; Con un servidor ya instalado se usa su misma carpeta (no se duplica la instalación)
  ${If} $ServLoc != ""
    Abort
  ${EndIf}
  ${If} $Tipo == "caja"
  ${OrIf} $Tipo == "admin"
    Abort
  ${EndIf}
FunctionEnd

; ------------------------------------------------------------------ instalación
; El stub NSIS es de 32 bits: "powershell" a secas abriría el PowerShell de 32 bits,
; donde $env:ProgramFiles = "C:\Program Files (x86)" y no se ve PostgreSQL de 64 bits
; (ni pg_dump, ni su registro). Desde un proceso x86, Sysnative da el de 64 bits.
!macro ElegirPowerShell
  StrCpy $PowerShell "powershell.exe"
  ${If} ${FileExists} "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
    StrCpy $PowerShell "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
  ${EndIf}
!macroend

!macro Ejecutar SCRIPT ARGS
  DetailPrint ""
  !insertmacro ElegirPowerShell
  nsExec::ExecToLog `"$PowerShell" -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding=[Text.Encoding]::Default; try { Start-Transcript -Path '$Registro' -Append | Out-Null } catch {}; try { & '${SCRIPT}' ${ARGS}; $$c = 0 } catch { Write-Host ('ERROR: ' + $$_.Exception.Message); $$c = 1 }; try { Stop-Transcript | Out-Null } catch {}; exit $$c"`
  Pop $0
  ${If} $0 != "0"
    StrCpy $Fallo "1"
  ${EndIf}
!macroend

Section "FactPOS" SecPrincipal
  SetDetailsPrint both
  System::Call 'Kernel32::SetEnvironmentVariable(t "FACTPOS_INSTALADOR", t "1")'
  StrCpy $Fallo "0"

  ; Las ventanas de FactPOS abiertas bloquean sus archivos y dejan la copia esperando: se cierran antes
  DetailPrint "Cerrando las ventanas de FactPOS que estén abiertas…"
  nsExec::ExecToLog '"$WINDIR\System32\taskkill.exe" /F /T /IM FactPOS-Escritorio.exe'
  Pop $0

  ${If} $Tipo == "master"
  ${OrIf} $Tipo == "servidor"
    CreateDirectory "$INSTDIR\logs"
    StrCpy $Registro "$INSTDIR\logs\instalacion.log"
  ${Else}
    CreateDirectory "$LOCALAPPDATA\FactPOS"
    StrCpy $Registro "$LOCALAPPDATA\FactPOS\instalacion.log"
  ${EndIf}
  ${If} $Tipo == "master"
  ${OrIf} $Tipo == "servidor"
    DetailPrint "Preparando los archivos de FactPOS…"
    SetDetailsPrint textonly
    SetOutPath "$PLUGINSDIR\paquete"
    File /r "${PAQUETE}\*.*"
    SetDetailsPrint both
    DetailPrint "Archivos listos."
    StrCpy $1 "-Carpeta '$INSTDIR' -NoInteractivo -Empresa '$Empresa'"
    ${If} $Tipo == "master"
    ${OrIf} $Tipo == "servidor"
      StrCpy $1 "$1 -Master"
      ${If} $Licencia != ""
        StrCpy $1 "$1 -Licencia '$Licencia'"
      ${EndIf}
    ${ElseIf} $Codigo != ""
      StrCpy $1 "$1 -CodigoInstalacion '$Codigo'"
    ${EndIf}

    DetailPrint "Instalando el servidor y preparando la base de datos. Puede tardar de 5 a 15 minutos; por favor espere…"
    SetDetailsPrint both
    !insertmacro Ejecutar "$PLUGINSDIR\paquete\instalador\instalar-servidor.ps1" "$1"
    ${If} $Fallo == "0"
    ${AndIf} $Vende == "1"
      StrCpy $2 "-Servidor 'http://localhost:3000' -NoInteractivo"
      DetailPrint "Instalando la caja en esta computadora…"
      !insertmacro Ejecutar "$PLUGINSDIR\paquete\instalador\instalar-caja.ps1" "$2"
    ${EndIf}
    ${If} $Fallo == "0"
    ${AndIf} $Tipo == "master"
      DetailPrint "Creando acceso de Administración como aplicación de escritorio…"
      !insertmacro Ejecutar "$PLUGINSDIR\paquete\instalador\instalar-administracion.ps1" "-Url 'http://localhost:3000/admin/' -NoInteractivo"
    ${EndIf}
    ; Los accesos Electron deben quedar en el escritorio del usuario actual.
    ; Eliminar accesos globales anteriores que pudieran apuntar a Edge.
    SetShellVarContext all
    Delete "$DESKTOP\FactPOS Caja.lnk"
    Delete "$SMPROGRAMS\FactPOS Caja.lnk"
    SetShellVarContext current
    ; Sustituir los accesos creados por los scripts antiguos por Electron.
    ${If} $Fallo == "0"
      ${If} ${FileExists} "$PLUGINSDIR\paquete\escritorio\FactPOS-Escritorio.exe"
        CreateDirectory "$INSTDIR\escritorio"
        CopyFiles /SILENT "$PLUGINSDIR\paquete\escritorio\FactPOS-Escritorio.exe" "$INSTDIR\escritorio\FactPOS-Escritorio.exe"
        ${If} $Tipo == "master"
          CreateShortCut "$DESKTOP\FactPOS Administración.lnk" "$INSTDIR\escritorio\FactPOS-Escritorio.exe" "--modo=admin --servidor=http://127.0.0.1:3000" "$INSTDIR\instalador\factpos.ico"
          CreateShortCut "$SMPROGRAMS\FactPOS Administración.lnk" "$INSTDIR\escritorio\FactPOS-Escritorio.exe" "--modo=admin --servidor=http://127.0.0.1:3000" "$INSTDIR\instalador\factpos.ico"
          CreateShortCut "$DESKTOP\FactPOS Caja.lnk" "$INSTDIR\escritorio\FactPOS-Escritorio.exe" "--modo=caja --servidor=http://127.0.0.1:3000" "$INSTDIR\instalador\factpos.ico"
          Delete "$SMSTARTUP\FactPOS Caja.lnk"
        ${EndIf}
      ${Else}
        StrCpy $Fallo "1"
        DetailPrint "ERROR: Falta Electron en el paquete de instalación."
      ${EndIf}
    ${EndIf}
    WriteUninstaller "$INSTDIR\Desinstalar FactPOS.exe"
    StrCpy $3 "$INSTDIR"
  ${Else}
    SetOutPath "$PLUGINSDIR\instalador"
    File "${PAQUETE}\instalador\instalar-caja.ps1"
    File "${PAQUETE}\instalador\instalar-administracion.ps1"
    File "${PAQUETE}\instalador\factpos.ico"
    File /oname=FactPOS-Escritorio.exe "${PAQUETE}\escritorio\FactPOS-Escritorio.exe"
    ${If} $Tipo == "caja"
      StrCpy $2 "-NoInteractivo"
      ${If} $Servidor != ""
        StrCpy $2 "$2 -Servidor '$Servidor'"
      ${EndIf}
      DetailPrint "Buscando el servidor de la tienda e instalando la caja…"
      !insertmacro Ejecutar "$PLUGINSDIR\instalador\instalar-caja.ps1" "$2"
    ${Else}
      DetailPrint "Instalando la aplicación de Administración…"
      !insertmacro Ejecutar "$PLUGINSDIR\instalador\instalar-administracion.ps1" "-Url '$Destino' -NoInteractivo"
    ${EndIf}
    ${If} $Fallo == "0"
      ${If} ${FileExists} "$PLUGINSDIR\instalador\FactPOS-Escritorio.exe"
        CreateDirectory "$LOCALAPPDATA\FactPOS\escritorio"
        CopyFiles /SILENT "$PLUGINSDIR\instalador\FactPOS-Escritorio.exe" "$LOCALAPPDATA\FactPOS\escritorio\FactPOS-Escritorio.exe"
        ${If} $Tipo == "caja"
          ${If} $Servidor != ""
            CreateShortCut "$DESKTOP\FactPOS Caja.lnk" "$LOCALAPPDATA\FactPOS\escritorio\FactPOS-Escritorio.exe" "--modo=caja --servidor=$Servidor"
          ${Else}
            CreateShortCut "$DESKTOP\FactPOS Caja.lnk" "$LOCALAPPDATA\FactPOS\escritorio\FactPOS-Escritorio.exe" "--modo=caja"
          ${EndIf}
          Delete "$SMSTARTUP\FactPOS Caja.lnk"
        ${Else}
          CreateShortCut "$DESKTOP\FactPOS Administración.lnk" "$LOCALAPPDATA\FactPOS\escritorio\FactPOS-Escritorio.exe" "--modo=admin --servidor=$Destino"
          CreateShortCut "$SMPROGRAMS\FactPOS Administración.lnk" "$LOCALAPPDATA\FactPOS\escritorio\FactPOS-Escritorio.exe" "--modo=admin --servidor=$Destino"
        ${EndIf}
      ${Else}
        StrCpy $Fallo "1"
        DetailPrint "ERROR: Falta Electron en el paquete."
      ${EndIf}
    ${EndIf}
    CreateDirectory "$LOCALAPPDATA\FactPOS"
    WriteUninstaller "$LOCALAPPDATA\FactPOS\Desinstalar FactPOS.exe"
    StrCpy $3 "$LOCALAPPDATA\FactPOS"
  ${EndIf}

  ; Programas y características: una entrada para el servidor y otra para Caja/Administración
  ${If} $3 == "$LOCALAPPDATA\FactPOS"
    StrCpy $4 "${REGCLI}"
    ; Quitar la clave heredada, que antes se compartía con el servidor
    ReadRegStr $5 HKLM "${REGSERV}" "InstallLocation"
    ${If} $5 == $3
      DeleteRegKey HKLM "${REGSERV}"
    ${EndIf}
    WriteRegStr HKLM "$4" "DisplayName" "FactPOS Caja / Administración"
  ${Else}
    StrCpy $4 "${REGSERV}"
    WriteRegStr HKLM "$4" "DisplayName" "FactPOS"
    WriteRegStr HKLM "$4" "FactPOSTipo" "$Tipo"
    WriteRegStr HKLM "$4" "FactPOSEmpresa" "$Empresa"
  ${EndIf}
  WriteRegStr HKLM "$4" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "$4" "Publisher" "FactPOS"
  WriteRegStr HKLM "$4" "InstallLocation" "$3"
  WriteRegStr HKLM "$4" "DisplayIcon" "$3\Desinstalar FactPOS.exe"
  WriteRegStr HKLM "$4" "UninstallString" "$\"$3\Desinstalar FactPOS.exe$\""
  WriteRegDWORD HKLM "$4" "NoModify" 1
  WriteRegDWORD HKLM "$4" "NoRepair" 1

  ${If} $Fallo == "1"
    SetDetailsView show
    DetailPrint ""
    DetailPrint "La instalación no terminó bien. Lea los mensajes de arriba (también quedaron en $Registro)."
    MessageBox MB_ICONEXCLAMATION "La instalación no terminó bien. Revise los mensajes en la lista de detalles y corrija lo que indican; luego vuelva a ejecutar el instalador (conserva lo ya instalado)."
  ${EndIf}
SectionEnd

; ------------------------------------------------------------------ final
Function PrepararFinal
  ${If} $Fallo == "1"
    StrCpy $TextoFinal "La instalación no terminó bien.$\r$\n$\r$\nRevise los mensajes que se mostraron y vuelva a ejecutar el instalador. Si necesita ayuda, envíe a su proveedor el archivo $Registro."
    StrCpy $Abrir ""
    Return
  ${EndIf}
  ${If} $Tipo == "master"
    StrCpy $TextoFinal "FactPOS completo instalado: servidor, Caja y Administración. Use los accesos del escritorio."
    StrCpy $Abrir "$DESKTOP\FactPOS Administración.lnk"
  ${ElseIf} $Tipo == "servidor"
    StrCpy $TextoFinal "Servidor FactPOS instalado. Conecte las cajas desde otros equipos. La administración local está disponible en http://localhost:3000/admin/."
    StrCpy $Abrir ""
  ${ElseIf} $Tipo == "sucursal"
    ReadEnvStr $4 COMPUTERNAME
    ${If} $Codigo != ""
      StrCpy $TextoFinal "El servidor de la sucursal quedó instalado y se dio de alta con su código.$\r$\n$\r$\nVende aunque no haya internet. Al terminar se abre el estado del alta."
    ${Else}
      StrCpy $TextoFinal "El servidor de la sucursal quedó instalado.$\r$\n$\r$\nFalta confirmarlo en el servidor principal: Sucursales y terminales › Servidores esperando alta › $4."
    ${EndIf}
    StrCpy $Abrir "http://localhost:3000/alta"
  ${ElseIf} $Tipo == "caja"
    StrCpy $TextoFinal "La caja quedó instalada: «FactPOS Caja» en el escritorio, en pantalla completa.$\r$\n$\r$\nLa primera vez elija qué caja es y entre con su PIN. Para salir: Alt + F4."
    StrCpy $Abrir "$DESKTOP\FactPOS Caja.lnk"
  ${Else}
    StrCpy $TextoFinal "La aplicación de Administración quedó en el escritorio y en el menú Inicio como «FactPOS Administración»."
    StrCpy $Abrir "$DESKTOP\FactPOS Administración.lnk"
  ${EndIf}
FunctionEnd

Function AbrirFactPOS
  ${If} $Abrir != ""
    ExecShell "open" "$Abrir"
  ${EndIf}
FunctionEnd

; ------------------------------------------------------------------ desinstalar
Function un.onInit
  StrCpy $BorrarDatos "0"
  StrCpy $Modo "servidor"
  ; Un desinstalador guardado en %LOCALAPPDATA%\FactPOS es el de Caja/Administración
  ${If} $INSTDIR == "$LOCALAPPDATA\FactPOS"
    StrCpy $Modo "cliente"
  ${EndIf}
FunctionEnd

Function un.PaginaDatos
  !insertmacro MUI_HEADER_TEXT "Sus datos" "Elija qué se conserva al desinstalar."
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${If} $Modo == "servidor"
    ${NSD_CreateLabel} 0 0 100% 44u "Se quitan los programas de FactPOS. La base de datos (ventas, productos, clientes) NO se borra: queda en PostgreSQL, así que puede volver a instalar FactPOS y seguir donde estaba.$\r$\n$\r$\nPor defecto también se conservan la configuración (.env), los registros y los respaldos de $INSTDIR."
    Pop $0
    ${NSD_CreateCheckBox} 0 52u 100% 24u "Eliminar también la configuración, los registros y los respaldos de $INSTDIR"
    Pop $hBorrar
  ${Else}
    ${NSD_CreateLabel} 0 0 100% 30u "Se quitan los accesos y la aplicación de Caja / Administración de esta computadora. Los datos del negocio están en el servidor y no se tocan."
    Pop $0
    ${NSD_CreateCheckBox} 0 38u 100% 24u "Eliminar también la configuración guardada de esta aplicación (servidor elegido, empresa)"
    Pop $hBorrar
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function un.PaginaDatosSalir
  ${NSD_GetState} $hBorrar $0
  ${If} $0 == ${BST_CHECKED}
    ${If} $Modo == "servidor"
      MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "Se borrarán los respaldos y la configuración de $INSTDIR. Esto no se puede deshacer.$\r$\n$\r$\n¿Continuar?" IDYES siBorrar
      Abort
      siBorrar:
    ${EndIf}
    StrCpy $BorrarDatos "1"
  ${Else}
    StrCpy $BorrarDatos "0"
  ${EndIf}
FunctionEnd

Section "Uninstall"
  DetailPrint "Deteniendo FactPOS…"
  SetShellVarContext current
  Delete "$DESKTOP\FactPOS Caja.lnk"
  Delete "$SMSTARTUP\FactPOS Caja.lnk"
  Delete "$DESKTOP\FactPOS Administración.lnk"
  Delete "$SMPROGRAMS\FactPOS Administración.lnk"

  ${If} $Modo == "cliente"
    ; ---- Caja / Administración
    RMDir /r "$LOCALAPPDATA\FactPOS\escritorio"
    RMDir /r "$LOCALAPPDATA\FactPOS\Administracion"
    Delete "$LOCALAPPDATA\FactPOS\factpos.ico"
    Delete "$LOCALAPPDATA\FactPOS\instalacion.log"
    ${If} $BorrarDatos == "1"
      RMDir /r "$APPDATA\FactPOS Escritorio"
    ${EndIf}
    Delete "$LOCALAPPDATA\FactPOS\Desinstalar FactPOS.exe"
    RMDir "$LOCALAPPDATA\FactPOS"
    DeleteRegKey HKLM "${REGCLI}"
    ; clave heredada (versiones anteriores guardaban aquí la Caja/Administración)
    ReadRegStr $0 HKLM "${REGSERV}" "InstallLocation"
    ${If} $0 == "$LOCALAPPDATA\FactPOS"
      DeleteRegKey HKLM "${REGSERV}"
    ${EndIf}
    DetailPrint "Caja / Administración desinstaladas."
  ${Else}
    ; ---- Servidor
    !insertmacro ElegirPowerShell
    nsExec::ExecToLog `"$PowerShell" -NoProfile -ExecutionPolicy Bypass -Command "Stop-ScheduledTask -TaskName 'FactPOS Servidor' -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName 'FactPOS Servidor' -Confirm:$$false -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName 'FactPOS Respaldo' -Confirm:$$false -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName 'FactPOS Actualizar' -Confirm:$$false -ErrorAction SilentlyContinue; Get-CimInstance Win32_Process -Filter \"Name='node.exe' OR Name='cloudflared.exe'\" | Where-Object { $$_.CommandLine -like '*apps\servidor\dist\index.js*' -or $$_.CommandLine -like '*tunnel*--url*' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force }; Get-NetFirewallRule -DisplayName 'FactPOS*' -ErrorAction SilentlyContinue | Remove-NetFirewallRule"`
    Pop $0
    SetShellVarContext all
    Delete "$DESKTOP\FactPOS - Servidor.url"
    Delete "$DESKTOP\FactPOS Administración.url"
    Delete "$DESKTOP\FactPOS Caja (navegador).url"
    SetShellVarContext current
    ; Programa (por defecto se conservan .env, logs y respaldos; la base de datos queda en PostgreSQL)
    RMDir /r "$INSTDIR\apps"
    RMDir /r "$INSTDIR\packages"
    RMDir /r "$INSTDIR\node_modules"
    RMDir /r "$INSTDIR\db"
    RMDir /r "$INSTDIR\escritorio"
    RMDir /r "$INSTDIR\instalador"
    RMDir /r "$INSTDIR\anterior"
    RMDir /r "$INSTDIR\bin"
    Delete "$INSTDIR\package.json"
    Delete "$INSTDIR\package-lock.json"
    Delete "$INSTDIR\README.md"
    Delete "$INSTDIR\.env.example"
    Delete "$INSTDIR\INSTALAR FactPOS.bat"
    ${If} $BorrarDatos == "1"
      DetailPrint "Eliminando configuración, registros y respaldos…"
      RMDir /r "$INSTDIR\logs"
      RMDir /r "$INSTDIR\respaldos"
      Delete "$INSTDIR\.env"
      Delete "$INSTDIR\postgres-superusuario.txt"
    ${EndIf}
    Delete "$INSTDIR\Desinstalar FactPOS.exe"
    RMDir "$INSTDIR"
    DeleteRegKey HKLM "${REGSERV}"
    ${If} $BorrarDatos == "1"
      DetailPrint "FactPOS se desinstaló. La base de datos sigue en PostgreSQL; bórrela solo si no la va a necesitar."
    ${Else}
      DetailPrint "FactPOS se desinstaló. Sus datos siguen en la base de datos y en $INSTDIR (.env, logs, respaldos); bórrelos solo si no los va a necesitar."
    ${EndIf}
  ${EndIf}
SectionEnd
