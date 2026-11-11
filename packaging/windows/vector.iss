; Inno Setup script for Vector.
;
; Build after PyInstaller has produced dist\Vector\:
;   ISCC.exe packaging\windows\vector.iss
;
; VECTOR_VERSION is read from the environment so CI and local builds share the
; same script. The version must match vector/__init__.py.

#define MyAppName "Vector"
#define MyAppVersion GetEnv("VECTOR_VERSION")
#if MyAppVersion == ""
  #define MyAppVersion "0.0.0-dev"
#endif
#define MyAppPublisher "Imran Badretdinov"
#define MyAppURL "https://github.com/badretd/vector-beta"
#define MyAppExeName "Vector.exe"
; Repository root, independent of the current working directory.
#define RepoRoot AddBackslash(SourcePath) + "..\.."

[Setup]
; Stable identifier: never change this or Windows will treat updates as a new app.
AppId={{155B1373-2B00-46A0-9D6C-6C2CF9139D62}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}/releases
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
LicenseFile={#RepoRoot}\LICENSE
OutputDir={#RepoRoot}\dist\installer
OutputBaseFilename=Vector-{#MyAppVersion}-windows-x64-Setup
SetupIconFile={#RepoRoot}\packaging\icons\vector.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; Per-user install: no UAC prompt and the install directory stays writable.
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#RepoRoot}\dist\Vector\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent
