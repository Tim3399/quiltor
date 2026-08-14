; Inno Setup script for the Quiltor Windows installer.
; Compiled by packaging/build_windows.ps1 via ISCC.exe after PyInstaller has
; produced packaging/dist/Quiltor/ (the onedir build) -- this just wraps that
; folder into a proper Setup.exe with a Start Menu entry, an optional Desktop
; shortcut, and an uninstaller registered in Windows' "Apps & Features".
;
; Per-user install (no admin/UAC prompt), same spirit as Quiltor's local-first,
; no-elevation-needed data directory (%USERPROFILE%\Quiltor) -- matches how e.g.
; VS Code's user-scope installer behaves.
;
; MyAppVersion is passed in from build_windows.ps1 via `/DMyAppVersion=X.Y.Z`
; (read from the repo's VERSION file); DEV_VERSION below is just a fallback so
; this script can also be compiled standalone while testing.
#ifndef MyAppVersion
  #define MyAppVersion "0.0.0-dev"
#endif

#define MyAppName "Quiltor"
#define MyAppPublisher "Quiltor"
#define MyAppURL "https://github.com/Tim3399/quiltor"
#define MyAppExeName "Quiltor.exe"
; Fixed GUID so re-installs/upgrades are recognized as the same app rather
; than installing side-by-side -- never change this once it has shipped.
#define MyAppId "{{6E9F2A3E-6B4B-4C0E-9F44-2B7A6E9C4B5D}"

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
OutputDir=dist
OutputBaseFilename=Quiltor-Setup-{#MyAppVersion}
SetupIconFile=icons\icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "german"; MessagesFile: "compiler:Languages\German.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "dist\Quiltor\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent
