; Inno Setup script for the Quiltor Windows installer.
; Compiled by build.ps1 after PyInstaller has produced the onedir app.
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
#ifndef BuildDir
  #error BuildDir must point at the frozen Quiltor directory
#endif
#ifndef OutputDir
  #error OutputDir must point at the profile artifact directory
#endif
#ifndef IconPath
  #error IconPath must point at icon.ico
#endif
#ifndef LicensePath
  #error LicensePath must point at Quiltor's LICENSE document
#endif
#ifndef ThirdPartyNoticesPath
  #error ThirdPartyNoticesPath must point at Quiltor's third-party notices
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
UninstallDisplayName={#MyAppName}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename=Quiltor-Setup-{#MyAppVersion}
SetupIconFile={#IconPath}
LicenseFile={#LicensePath}
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
Source: "{#BuildDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#LicensePath}"; DestDir: "{app}"; DestName: "LICENSE"; Flags: ignoreversion
Source: "{#ThirdPartyNoticesPath}"; DestDir: "{app}"; DestName: "THIRD-PARTY-NOTICES.md"; Flags: ignoreversion

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent
