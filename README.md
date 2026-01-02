# Stratus Weather Server

A professional desktop application for Campbell Scientific weather station management, data collection, and monitoring using the PakBus protocol.

![Stratus Weather Server](assets/screenshot.png)

## Features

### Campbell Scientific Integration
- **PakBus Protocol Support** - Native implementation of Campbell Scientific's PakBus protocol
- **Multi-Connection Types** - Serial (RS232/RS485), TCP/IP, GSM modems, LoRa, RF407
- **Data Collection** - Scheduled and on-demand data collection from datalogger tables
- **Program Management** - Upload, download, and manage CRBasic programs
- **File Operations** - Browse, transfer, and manage datalogger files
- **Clock Synchronization** - Automatic and manual clock sync with stations

### Real-Time Monitoring Dashboard
- **Live Dashboard** - Real-time weather data visualization
- **Solar Position Tracking** - Sun elevation, azimuth, nautical dawn/dusk
- **Air Density Calculations** - Real-time air density from temperature, pressure, humidity
- **Reference Evapotranspiration** - FAO Penman-Monteith ETo calculations
- **Barometric Pressure** - Dual display (station level + sea level QNH)
- **Battery Monitoring** - Logger battery voltage with status indicators
- **Connection Health** - Monitor connection status and quality
- **Alerts & Alarms** - Configurable alerts for data thresholds and connection issues
- **Data Validation** - Automatic QC checks on incoming data

### Data Management
- **Local SQLite Database** - All data stored locally for offline access
- **Data Export** - Export to CSV, JSON, or connect to external databases
- **Historical Charts** - View and analyze historical weather data
- **Backup & Restore** - Backup station configurations and data

### Remote Access (Cloudflare Tunnel)
- **24/7 Public Access** - Secure HTTPS access via Cloudflare Tunnel
- **Custom Domain** - Configure with your own domain (e.g., api.meteotronics.com)
- **Auto-Restart** - Windows services for automatic restart on failure

## Installation

### Windows
1. Download the latest release from [GitHub Releases](https://github.com/yourusername/stratus/releases)
2. Run `Stratus-Weather-Server-Setup.exe`
3. Follow the installation wizard
4. Launch from Start Menu or Desktop shortcut

### macOS
1. Download `Stratus-Weather-Server.dmg`
2. Open the DMG file
3. Drag Stratus to Applications folder
4. Launch from Applications

### Linux
1. Download `Stratus-Weather-Server.AppImage`
2. Make it executable: `chmod +x Stratus-Weather-Server.AppImage`
3. Run: `./Stratus-Weather-Server.AppImage`

## Development Setup

### Prerequisites
- Node.js 18+ 
- npm 9+
- Git

### Install Dependencies
```bash
git clone https://github.com/yourusername/stratus.git
cd stratus
npm install
```

### Run in Development Mode
```bash
npm run dev
```
This starts both the backend server and frontend with hot reload.

### Run Electron in Development
```bash
npm run electron:dev
```
This starts the full Electron application with development tools.

### Build for Production
```bash
# Build for current platform
npm run dist

# Build for Windows
npm run dist:win

# Build for macOS
npm run dist:mac

# Build for Linux
npm run dist:linux
```

Built files will be in the `release/` directory.

## Project Structure

```
stratus/
├── client/              # React frontend application
│   └── src/
│       ├── components/  # UI components
│       ├── pages/       # Application pages
│       ├── hooks/       # Custom React hooks
│       └── lib/         # Utility libraries
├── server/              # Express backend server
│   ├── campbell/        # Campbell Scientific integration
│   │   ├── connectionManager.ts   # Multi-transport connections
│   │   ├── pakbusProtocol.ts      # PakBus protocol implementation
│   │   ├── dataCollectionEngine.ts # Scheduled data collection
│   │   ├── stationManager.ts      # Station configuration
│   │   └── fileManager.ts         # Datalogger file operations
│   ├── protocols/       # Communication protocol adapters
│   └── station-setup/   # Station configuration wizard
├── electron/            # Electron main process
│   ├── main.js          # Main process entry
│   └── preload.js       # Preload script for security
├── shared/              # Shared types and utilities
└── assets/              # Application icons and assets
```

## Supported Hardware

### Campbell Scientific Dataloggers
- CR1000X, CR1000
- CR6
- CR3000
- CR800, CR850
- CR300
- CR200X

### Communication Options
- **Serial** - RS232, RS485 direct connection
- **TCP/IP** - Ethernet, WiFi via NL121 or similar
- **RF** - RF407/RF412 spread spectrum radios
- **Cellular** - CELL200 series modems
- **LoRa** - Long-range IoT connectivity

## Configuration

### Station Setup
1. Click **Station → Add Station** or use Ctrl+N
2. Enter station details:
   - Name and PakBus address
   - Connection type (Serial, TCP, etc.)
   - Connection parameters (COM port, IP address, etc.)
3. Test connection
4. Configure data collection schedules

### Data Collection
- Set collection intervals per table
- Configure gap-filling for missed data
- Set up data processing rules (scaling, calibration)

See [STATION_SETUP.md](STATION_SETUP.md) for detailed configuration instructions.

## 24/7 Production Deployment

### Setting Up Cloudflare Tunnel for Public Access

Stratus Weather Server can be accessed publicly via Cloudflare Tunnel, allowing weather stations to POST data to a public URL.

#### Prerequisites
1. Cloudflare account with a domain (e.g., meteotronics.com)
2. Domain DNS managed by Cloudflare
3. Windows Administrator access

#### Quick Setup
```powershell
# Run as Administrator
cd scripts

# 1. Initial tunnel setup (creates tunnel and DNS routes)
.\setup-cloudflare-tunnel.ps1 -Domain "meteotronics.com" -InstallService

# 2. Configure 24/7 production mode
.\setup-production-24-7.ps1

# 3. Check status
.\setup-production-24-7.ps1 -CheckStatus
```

#### Available Commands
```powershell
.\setup-production-24-7.ps1 -CheckStatus   # Check service status
.\setup-production-24-7.ps1 -RestartAll    # Restart all services
.\setup-production-24-7.ps1 -FixTunnelOnly # Fix tunnel configuration
.\setup-production-24-7.ps1 -Uninstall     # Remove all services
```

#### Endpoints
- **Dashboard**: `https://yourdomain.com`
- **API**: `https://api.yourdomain.com`
- **Data Ingestion**: `https://api.yourdomain.com/api/weather-data`

## API Reference

The server exposes a REST API on port 5000:

### Stations
- `GET /api/stations` - List all stations
- `POST /api/stations` - Add new station
- `GET /api/stations/:id` - Get station details
- `PUT /api/stations/:id` - Update station
- `DELETE /api/stations/:id` - Remove station

### Data Collection
- `GET /api/campbell/tables/:stationId` - Get table definitions
- `POST /api/campbell/collect/:stationId` - Collect data from table
- `GET /api/weather/:stationId` - Get weather data

### Station Control
- `POST /api/campbell/clock/:stationId` - Sync station clock
- `POST /api/campbell/program/:stationId` - Upload program
- `GET /api/campbell/files/:stationId` - List station files

## Troubleshooting

### Connection Issues
- Verify PakBus address matches datalogger settings
- Check COM port is not in use by another application
- Ensure firewall allows connections on TCP port 6785

### Data Collection Problems
- Verify table names match datalogger program
- Check security code if required
- Review station logs for error messages

## License

MIT License - see [LICENSE](LICENSE) for details.

## Support

- GitHub Issues: [Report a bug](https://github.com/yourusername/stratus/issues)
- Documentation: [Wiki](https://github.com/yourusername/stratus/wiki)

## Credits

Developed by Lukas Esterhuizen (esterhuizen2k@proton.me)

Campbell Scientific and PakBus are trademarks of Campbell Scientific, Inc.
