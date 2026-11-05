; Instalador de FactPOS Admin para Windows (administración remota). Se instala para el usuario actual (sin administrador).
#define MyAppName "FactPOS Admin"
#ifndef MyAppVersion
  #define MyAppVersion "1.0.0"
#endif
#define MyAppExeName "FactPOSAdmin.exe"
[Setup]
AppId={{5D2F9A41-7B3C-4E88-A1D6-2C4E7F9B0A53}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=FactPOS
DefaultDirName={localappdata}\Programs\FactPOSAdmin
DefaultGroupName=FactPOS
DisableProgramGroupPage=yes
OutputDir=..\..\dist_instalador
OutputBaseFilename=Instalador_Admin_FactPOS
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
Name: "escritorio"; Description: "Crear un acceso directo en el escritorio"
[Files]
Source: "dist\FactPOSAdmin\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\FactPOS Admin"; Filename: "{app}\{#MyAppExeName}"
Name: "{userdesktop}\FactPOS Admin"; Filename: "{app}\{#MyAppExeName}"; Tasks: escritorio
[Registry]
; Enlace «Abrir y conectar» de la página de instalación (factpos-admin://conectar/<empresa>)
Root: HKCU; Subkey: "Software\Classes\factpos-admin"; ValueType: string; ValueData: "URL:FactPOS Admin"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\factpos-admin"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\factpos-admin\shell\open\command"; ValueType: string; ValueData: """{app}\{#MyAppExeName}"" ""%1"""
[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Abrir FactPOS Admin ahora"; Flags: postinstall nowait skipifsilent
; Actualización automática (instalación silenciosa): la app se vuelve a abrir sola
Filename: "{app}\{#MyAppExeName}"; Flags: nowait runasoriginaluser; Check: WizardSilent
