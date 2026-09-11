#ifndef SourceDir
  #error SourceDir must point to a prepared build. Run scripts/build-installer.ps1.
#endif
#ifndef AppVersion
  #define AppVersion "0.5.1"
#endif
[Setup]
AppId={{EDE20F29-7DD6-4C38-A6AE-0EE02B6EF310}
AppName=JobGhost
AppVersion={#AppVersion}
AppPublisher=JobGhost
DefaultDirName={localappdata}\Programs\JobGhost
DefaultGroupName=JobGhost
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\releases
OutputBaseFilename=JobGhost-Setup-{#AppVersion}
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\JobGhost.exe
CloseApplications=no
SetupLogging=yes
[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"
[Tasks]
Name: "desktopicon"; Description: "Создать ярлык на рабочем столе"; Flags: checkedonce
Name: "autostart"; Description: "Запускать JobGhost в фоне вместе с Windows"; Flags: checkedonce
[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\JobGhost"; Filename: "{app}\JobGhost.exe"
Name: "{autodesktop}\JobGhost"; Filename: "{app}\JobGhost.exe"; Tasks: desktopicon
Name: "{userstartup}\JobGhost"; Filename: "{app}\JobGhost.exe"; Parameters: "--background"; Tasks: autostart
Name: "{group}\Удалить JobGhost"; Filename: "{uninstallexe}"
[Run]
Filename: "{app}\JobGhost.exe"; Description: "Запустить JobGhost"; Flags: nowait postinstall skipifsilent
