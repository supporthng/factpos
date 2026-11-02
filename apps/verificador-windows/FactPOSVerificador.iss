; Instalador del Verificador FactPOS para Windows (quiosco de consulta de precios).
; Se instala para el usuario actual (no pide administrador) y arranca al iniciar sesión.
#define MyAppName "Verificador FactPOS"
#ifndef MyAppVersion
  #define MyAppVersion "1.0.0"
#endif
#define MyAppExeName "FactPOSVerificador.exe"
[Setup]
AppId={{B3E5A7C2-4D18-4F6B-9A21-7C0E8D5F3B19}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=FactPOS
DefaultDirName={localappdata}\Programs\FactPOSVerificador
DefaultGroupName=FactPOS
DisableProgramGroupPage=yes
OutputDir=..\..\dist_instalador
OutputBaseFilename=Instalador_Verificador_FactPOS
SetupIconFile=factpos.ico
Compression=lzma2
SolidCompression=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName}
CloseApplications=force
RestartApplications=no
[Languages]
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl"
[Tasks]
Name: "inicio"; Description: "Abrir automáticamente al iniciar Windows (recomendado para el verificador)"
Name: "escritorio"; Description: "Crear un acceso directo en el escritorio"
Name: "kiosco"; Description: "Preparar Windows para quiosco: quitar los avisos y reinicios automáticos de Windows Update (pide permiso de administrador una vez)"
[Files]
Source: "dist\FactPOSVerificador\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "Preparar_Windows_Kiosco.ps1"; DestDir: "{app}"; Flags: ignoreversion
[Icons]
Name: "{group}\Verificador FactPOS"; Filename: "{app}\{#MyAppExeName}"
Name: "{userdesktop}\Verificador FactPOS"; Filename: "{app}\{#MyAppExeName}"; Tasks: escritorio
[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "FactPOSVerificador"; ValueData: """{app}\{#MyAppExeName}"""; Flags: uninsdeletevalue; Tasks: inicio
[Run]
; Preparar Windows para quiosco: el script se ejecuta elevado (aparece el aviso de permiso de administrador). Nunca en una actualización automática (silenciosa).
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""try {{ Start-Process powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \""{app}\Preparar_Windows_Kiosco.ps1\""' }} catch {{ }}"""; Flags: runhidden waituntilterminated; Tasks: kiosco; Check: not WizardSilent; StatusMsg: "Preparando Windows para el verificador..."
Filename: "{app}\{#MyAppExeName}"; Description: "Abrir el verificador ahora"; Flags: postinstall nowait skipifsilent
; Actualización automática (instalación silenciosa): la app vuelve a abrirse sola
Filename: "{app}\{#MyAppExeName}"; Flags: nowait runasoriginaluser; Check: WizardSilent
