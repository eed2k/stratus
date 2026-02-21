; Stratus Weather Station Manager — Inno Setup Installer Script
; Produces a professional Windows installer with EULA, license key,
; installation directory selection, and desktop/start menu shortcuts.

#define AppName "Stratus Weather Station Manager"
#define AppVersion "1.2.0"
#define AppPublisher "Itronics"
#define AppURL "https://github.com/reuxnergy-admin1/stratus"
#define AppExeName "Stratus.exe"
#define BuildOutput "..\Stratus.Desktop\bin\Publish"

[Setup]
AppId={{B8F4A2E1-7C3D-4E5A-9B1F-D6E8C2A4F3B7}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}
AppUpdatesURL={#AppURL}
DefaultDirName={autopf}\Stratus
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
LicenseFile=EULA.rtf
OutputDir=..\..\release
OutputBaseFilename=Stratus-Setup-{#AppVersion}
SetupIconFile=..\Stratus.Desktop\Assets\stratus.ico
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
WizardSizePercent=110
PrivilegesRequired=admin
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
UninstallDisplayIcon={app}\{#AppExeName}
UninstallDisplayName={#AppName}
VersionInfoVersion={#AppVersion}.0
VersionInfoCompany={#AppPublisher}
VersionInfoCopyright=Copyright (C) 2026 Itronics
VersionInfoProductName={#AppName}
VersionInfoProductVersion={#AppVersion}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
english.LicenseKeyPageCaption=License Key
english.LicenseKeyPageDescription=Enter your Stratus license key to activate the software.

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: checked
Name: "quicklaunchicon"; Description: "Create a &Quick Launch icon"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#BuildOutput}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "EULA.rtf"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Comment: "Launch Stratus Weather Station Manager"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon; Comment: "Launch Stratus"

[Run]
Filename: "{app}\{#AppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(AppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[Registry]
Root: HKCU; Subkey: "Software\Itronics\Stratus"; ValueType: string; ValueName: "InstallPath"; ValueData: "{app}"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Itronics\Stratus"; ValueType: string; ValueName: "Version"; ValueData: "{#AppVersion}"

[Code]
var
  LicenseKeyPage: TInputQueryWizardPage;

procedure InitializeWizard;
begin
  // Create the license key input page (shown after EULA acceptance)
  LicenseKeyPage := CreateInputQueryPage(wpLicense,
    ExpandConstant('{cm:LicenseKeyPageCaption}'),
    ExpandConstant('{cm:LicenseKeyPageDescription}'),
    'Enter your license key below. You can also activate later from the application.' + #13#10 +
    'Leave blank to start with a 30-day trial.');
  LicenseKeyPage.Add('License Key (XXXX-XXXX-XXXX-XXXX-XXXX):', False);
  LicenseKeyPage.Add('License Holder Name:', False);
  LicenseKeyPage.Add('Organization:', False);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  
  if CurPageID = LicenseKeyPage.ID then
  begin
    // License key is optional — allow blank for trial
    if LicenseKeyPage.Values[0] <> '' then
    begin
      // Basic format validation
      if Length(LicenseKeyPage.Values[0]) < 20 then
      begin
        MsgBox('License key format appears invalid. Expected format: XXXX-XXXX-XXXX-XXXX-XXXX.' + #13#10 +
               'Leave blank to start with a trial license.', mbError, MB_OK);
        Result := False;
      end;
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  LicenseKey, Holder, Org: String;
  ConfigPath, ConfigContent: String;
begin
  if CurStep = ssPostInstall then
  begin
    LicenseKey := LicenseKeyPage.Values[0];
    Holder := LicenseKeyPage.Values[1];
    Org := LicenseKeyPage.Values[2];
    
    // Save license info to config if provided
    if LicenseKey <> '' then
    begin
      ConfigPath := ExpandConstant('{userappdata}\Stratus');
      ForceDirectories(ConfigPath);
      
      ConfigContent := '{' + #13#10 +
        '  "License": {' + #13#10 +
        '    "Key": "' + LicenseKey + '",' + #13#10 +
        '    "Holder": "' + Holder + '",' + #13#10 +
        '    "Organization": "' + Org + '"' + #13#10 +
        '  }' + #13#10 +
        '}';
      
      SaveStringToFile(ConfigPath + '\license-pending.json', ConfigContent, False);
    end;
  end;
end;
