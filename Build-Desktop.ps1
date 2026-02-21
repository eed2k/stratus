# Build Stratus Desktop (WPF .NET 8)
# Run from the workspace root

param(
    [switch]$Release,
    [switch]$Installer
)

$ErrorActionPreference = "Stop"
$desktopDir = Join-Path $PSScriptRoot "desktop\Stratus.Desktop"
$projectFile = Join-Path $desktopDir "Stratus.Desktop.csproj"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Stratus Desktop Build" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check .NET SDK (need 8.0+)
$dotnetVersion = dotnet --version 2>$null
if (-not $dotnetVersion) {
    Write-Host "ERROR: .NET SDK required. Download from https://dotnet.microsoft.com/download/dotnet/8.0" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] .NET SDK: $dotnetVersion" -ForegroundColor Green

# Restore packages
Write-Host ""
Write-Host "Restoring NuGet packages..." -ForegroundColor Yellow
dotnet restore $projectFile
if ($LASTEXITCODE -ne 0) { Write-Host "Restore failed!" -ForegroundColor Red; exit 1 }
Write-Host "[OK] Packages restored" -ForegroundColor Green

# Build
$config = if ($Release) { "Release" } else { "Debug" }
Write-Host ""
Write-Host "Building ($config)..." -ForegroundColor Yellow
dotnet build $projectFile -c $config --no-restore
if ($LASTEXITCODE -ne 0) { Write-Host "Build failed!" -ForegroundColor Red; exit 1 }
Write-Host "[OK] Build complete" -ForegroundColor Green

# Publish (self-contained single-file) for Release
if ($Release) {
    Write-Host ""
    Write-Host "Publishing self-contained single-file EXE..." -ForegroundColor Yellow
    dotnet publish $projectFile -c Release -r win-x64 --self-contained `
        -p:PublishSingleFile=true `
        -p:IncludeNativeLibrariesForSelfExtract=true `
        -p:EnableCompressionInSingleFile=true `
        -o "$desktopDir\bin\Publish"
    if ($LASTEXITCODE -ne 0) { Write-Host "Publish failed!" -ForegroundColor Red; exit 1 }
    Write-Host "[OK] Published to desktop\Stratus.Desktop\bin\Publish" -ForegroundColor Green
}

# Build installer if requested
if ($Installer) {
    $issFile = Join-Path $PSScriptRoot "desktop\Installer\StratusSetup.iss"
    $isccPath = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
    
    if (-not (Test-Path $isccPath)) {
        Write-Host "WARNING: Inno Setup 6 not found at $isccPath" -ForegroundColor Yellow
        Write-Host "Download from https://jrsoftware.org/isinfo.php" -ForegroundColor Yellow
    } else {
        Write-Host ""
        Write-Host "Building installer..." -ForegroundColor Yellow
        & $isccPath $issFile
        if ($LASTEXITCODE -ne 0) { Write-Host "Installer build failed!" -ForegroundColor Red; exit 1 }
        Write-Host "[OK] Installer created in release/" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Build Complete!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
