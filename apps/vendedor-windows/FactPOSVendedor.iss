; Instalador de FactPOS Vendedor para Windows (terminal de ventas). Se instala para el usuario actual (sin administrador).
#define MyAppName "FactPOS Vendedor"
#ifndef MyAppVersion
  #define MyAppVersion "1.0.0"
#endif
#define MyAppExeName "FactPOSVendedor.exe"
[Setup]
AppId={{8A6C3E17-4F52-4B9D-9E20-7D1B5C8A3F64}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=FactPOS
DefaultDirName={localappdata}\Programs\FactPOSVendedor
DefaultGroupName=FactPOS
DisableProgramGroupPage=yes
OutputDir=..\..\dist_instalador
OutputBaseFilename=Instalador_Vendedor_FactPOS
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
Source: "dist\FactPOSVendedor\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\FactPOS Vendedor"; Filename: "{app}\{#MyAppExeName}"
Name: "{userdesktop}\FactPOS Vendedor"; Filename: "{app}\{#MyAppExeName}"; Tasks: escritorio
[Registry]
; Se abre sola al iniciar Windows
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "FactPOSVendedor"; ValueData: """{app}\{#MyAppExeName}"""; Flags: uninsdeletevalue
[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Abrir FactPOS Vendedor ahora"; Flags: postinstall nowait skipifsilent
; Actualización automática (instalación silenciosa): la app se vuelve a abrir sola
Filename: "{app}\{#MyAppExeName}"; Flags: nowait runasoriginaluser; Check: WizardSilent
