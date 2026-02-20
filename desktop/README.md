# Stratus Desktop — WPF (.NET 8)

Research-grade weather station data acquisition and monitoring software for Windows.

## Overview

Stratus Desktop is a native Windows application built with WPF and .NET 8, designed for
professional weather station data collection, monitoring, and export. It connects to the
Stratus VPS web server API or directly to PostgreSQL (Neon) databases.

Inspired by Campbell Scientific's LoggerNet and PC400 — built for reliability, not aesthetics.

## Features

- **Station Monitoring** — Real-time display of all weather metrics (temperature, humidity,
  pressure, wind, solar, soil, air quality, MPPT)
- **Data Acquisition** — Automatic polling with configurable intervals
- **Direct DB Access** — Connect directly to PostgreSQL/Neon for high-performance queries
- **TOA5 Export** — Campbell Scientific compatible CSV export format
- **Data Grid** — Sortable, filterable tabular data view with professional column headers
- **License Management** — HMAC-SHA256 key validation with trial/standard/pro/enterprise tiers
- **Activity Log** — Full audit trail of all data collection and system events

## Requirements

- Windows 10/11 (64-bit)
- .NET 8 Runtime (included in self-contained builds)
- Network access to Stratus VPS or PostgreSQL database

## Building

### Prerequisites
- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
- [Inno Setup 6](https://jrsoftware.org/isinfo.php) (for installer)

### Build Commands

```powershell
# Debug build
.\Build-Desktop.ps1

# Release build
.\Build-Desktop.ps1 -Release

# Release build + installer
.\Build-Desktop.ps1 -Release -Installer

# Manual build
dotnet build desktop/Stratus.Desktop/Stratus.Desktop.csproj -c Release
```

### Installer

The Inno Setup installer (`desktop/Installer/StratusSetup.iss`) produces a professional
Windows installer with:

- **EULA acceptance** dialog
- **License key** entry (optional, can activate later)
- **Installation directory** selection
- **Desktop & Start Menu shortcuts**
- **Registry entries** for uninstall
- **Post-install** launch option

## Project Structure

```
desktop/
├── Stratus.Desktop/
│   ├── Stratus.Desktop.csproj    # .NET 8 WPF project
│   ├── App.xaml / App.xaml.cs     # Application entry point
│   ├── appsettings.json           # Default configuration
│   ├── Models/                    # Data models
│   │   ├── WeatherStation.cs
│   │   ├── WeatherRecord.cs
│   │   └── AppConfig.cs
│   ├── ViewModels/                # MVVM view models
│   │   └── MainViewModel.cs
│   ├── Views/                     # WPF windows and dialogs
│   │   ├── MainWindow.xaml/.cs
│   │   ├── DatabaseConnectionDialog.xaml/.cs
│   │   └── LicenseDialog.xaml/.cs
│   ├── Services/                  # Business logic
│   │   ├── ApiService.cs          # HTTP client for VPS API
│   │   ├── DatabaseService.cs     # Direct PostgreSQL access
│   │   ├── DataAcquisitionService.cs  # Data collection engine
│   │   └── LicenseService.cs      # License validation
│   ├── Themes/                    # WPF resource dictionaries
│   │   └── StratusTheme.xaml
│   └── Assets/                    # Icons, images
└── Installer/
    ├── StratusSetup.iss           # Inno Setup script
    └── EULA.rtf                   # End User License Agreement
```

## Configuration

The app stores settings in `%APPDATA%\Stratus\`:

| File | Purpose |
|------|---------|
| `appsettings.json` | Server URL, polling settings, export defaults |
| `license.dat` | Encrypted license data (DPAPI) |
| `Logs/` | Rolling log files (30-day retention) |

## Connecting to Stratus

### Via API (recommended)
1. Enter the server URL (e.g., `https://stratus.itronics.co.za`)
2. Enter username and password
3. Click Connect

### Direct Database
1. Menu → Database → Connect to PostgreSQL
2. Enter connection string (e.g., `postgresql://user:pass@host:5432/db?sslmode=require`)
3. Test connection, then connect

## License Types

| Type | Stations | Term |
|------|----------|------|
| Trial | 2 | 30 days |
| Standard | 5 | 1 year |
| Professional | 25 | 1 year |
| Enterprise | Unlimited | 1 year |
