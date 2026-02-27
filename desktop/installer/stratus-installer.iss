; ────────────────────────────────────────────────────────────────────
; Stratus Weather Station Manager — Inno Setup Installer Script
; Requires Inno Setup 6.x (https://jrsoftware.org/isinfo.php)
; Build: iscc stratus-installer.iss
; ────────────────────────────────────────────────────────────────────

#define MyAppName "Stratus Weather Station Manager"
#define MyAppVersion "1.1.0"
#define MyAppPublisher "Lukas Esterhuizen"
#define MyAppURL "https://github.com/eed2k/stratus"
#define MyAppExeName "Stratus.exe"
#define MyAppCopyright "Copyright © 2025-2026 Lukas Esterhuizen. All rights reserved."

[Setup]
; Basic info
AppId={{A7D3F4E1-8B2C-4D6A-9E5F-1C3B7A8D2E6F}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}/issues
AppUpdatesURL={#MyAppURL}/releases
AppCopyright={#MyAppCopyright}

; Installation
DefaultDirName={autopf}\Stratus
DefaultGroupName=Stratus
AllowNoIcons=yes
DisableProgramGroupPage=yes

; Output
OutputDir=..\output
OutputBaseFilename=Stratus-Setup-{#MyAppVersion}
SetupIconFile=..\Stratus.Desktop\Assets\stratus.ico
UninstallDisplayIcon={app}\{#MyAppExeName}

; Compression
Compression=lzma2/ultra64
SolidCompression=yes
LZMANumBlockThreads=4

; Appearance
WizardStyle=modern
WizardSizePercent=110
WizardImageFile=compiler:WizModernImage-IS.bmp
WizardSmallImageFile=compiler:WizModernSmallImage-IS.bmp

; Privileges
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog

; Minimum OS (Windows 10)
MinVersion=10.0

; Architecture — 64-bit only
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

; Signing (uncomment and configure for production)
; SignTool=signtool sign /f "$path_to_pfx" /p "$password" /t http://timestamp.digicert.com /d "Stratus Weather Station Manager" $f

; Uninstaller
UninstallDisplayName={#MyAppName}
CreateUninstallRegKey=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "quicklaunchicon"; Description: "Create a &Quick Launch icon"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Main application — self-contained single-file publish output
Source: "..\Stratus.Desktop\publish\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

; Additional assets
Source: "..\Stratus.Desktop\Assets\stratus.ico"; DestDir: "{app}"; Flags: ignoreversion

; License
Source: "..\..\LICENSE.txt"; DestDir: "{app}"; Flags: ignoreversion; DestName: "LICENSE.txt"

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\stratus.ico"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{app}\stratus.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[Registry]
; File association for .stratus files (optional future use)
Root: HKCU; Subkey: "Software\Classes\.stratus"; ValueType: string; ValueName: ""; ValueData: "StratusFile"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\StratusFile"; ValueType: string; ValueName: ""; ValueData: "Stratus Data File"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\StratusFile\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\stratus.ico"
Root: HKCU; Subkey: "Software\Classes\StratusFile\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""

; App settings registry entries
Root: HKCU; Subkey: "Software\Stratus"; ValueType: string; ValueName: "InstallPath"; ValueData: "{app}"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Stratus"; ValueType: string; ValueName: "Version"; ValueData: "{#MyAppVersion}"

[Code]
// Custom code for detecting .NET 8 runtime (not needed for self-contained builds)
function InitializeSetup(): Boolean;
begin
  Result := True;
  // Self-contained builds include .NET runtime — no external dependency check needed
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    // Post-install actions (logging, etc.)
    Log('Stratus installation completed successfully.');
  end;
end;
