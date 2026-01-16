# Stratus Weather Station

**Version 1.0.0**  
**Developer:** Lukas Esterhuizen  
**Contact:** esterhuizen2k@proton.me

A professional desktop application for Campbell Scientific weather station management, data collection, and monitoring using the PakBus protocol.

![Stratus Weather Server](assets/screenshot.png)

---

## 🚀 Features

### Campbell Scientific Integration
- **PakBus Protocol Support** - Native implementation of Campbell Scientific's PakBus protocol
- **Multi-Connection Types** - TCP/IP, Cellular (4G/LTE), LoRaWAN, HTTP
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

### Wind Analysis (WMO/Beaufort Scale)
- **Wind Rose Charts** - Traditional wind direction frequency distribution (Today, Yesterday, 60 min)
- **Wind Speed Scatter Plots** - Individual wind observations plotted on polar chart with color-coded speed (Today, Yesterday, 30 min)
- **Wind Compass** - Real-time wind direction and speed display
- **Wind Power Analysis** - Wind energy potential calculations

### Data Management
- **Local SQLite Database** - All data stored locally for offline access
- **Historical Charts** - View and analyze historical weather data
- **Backup & Restore** - Backup station configurations and data

### Cloud Deployment (Railway)
- **24/7 Cloud Access** - Deploy to Railway for always-on operation
- **PostgreSQL Database** - Cloud database for data persistence
- **Auto-Restart** - Automatic restart on failure

## 📦 Installation

### Windows (Recommended)

**Download the professional installer:**

1. **Download** the latest release: `Stratus-Weather-Station-Setup-1.0.0.exe`
2. **Run the installer** (Windows 10/11, 64-bit)
3. **Accept the EULA** (End User License Agreement)
4. **Choose installation directory** (default: `C:\Users\[YourName]\AppData\Local\Stratus Weather Station`)
5. **Select shortcuts:**
   - ✅ Desktop shortcut
   - ✅ Start Menu shortcut
6. **Complete installation**
7. **First Launch:**
   - Welcome screen appears
   - **Login** with existing credentials OR
   - **Register** a new account OR
   - **Skip** and configure later

**System Requirements:**
- Windows 10 (64-bit) or later
- 4GB RAM (8GB recommended)
- 500MB disk space (+ data storage)
- Internet connection (for cloud features)

**Uninstall:**
- Go to **Settings → Apps → Apps & Features**
- Find "Stratus Weather Station"
- Click **Uninstall**
- Choose to **preserve** or **delete** user data

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

### Build for Production

```bash
# Clean build
npm run clean

# Build for current platform
npm run dist

# Build for Windows (NSIS Installer)
npm run dist:win
# Output: output/Stratus-Weather-Station-Setup-1.0.0.exe

# Build for macOS
npm run dist:mac

# Build for Linux
npm run dist:linux
```

Built files will be in the `output/` directory.

**Build System:**
- **Packager:** electron-builder v24.9.1
- **Installer:** NSIS (Nullsoft Scriptable Install System)
- **Icon:** `build/icon.ico` (Windows), `assets/icon.icns` (macOS)
- **EULA:** Comprehensive End User License Agreement included
- **Developer Attribution:** Lukas Esterhuizen (esterhuizen2k@proton.me)

## Project Structure

```
stratus/
├── client/              # React frontend application
│   └── src/
│       ├── components/  # UI components
│       │   ├── charts/  # Wind rose, scatter plots, weather charts
│       │   └── dashboard/  # Dashboard cards and panels
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
- **TCP/IP** - Ethernet, WiFi via NL121 or similar
- **Cellular** - 4G/LTE modems (CELL200 series)
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

### Data Sources

Stratus supports multiple data sources for weather data:

#### Direct Connection (PakBus)
- Real-time connection to Campbell Scientific dataloggers
- Automatic data collection at configured intervals
- Two-way communication for clock sync and program management

#### HTTP Post (Datalogger → Stratus)
- Datalogger pushes data to Stratus server
- Ideal for cellular or internet-connected loggers
- See [examples/crbasic/](examples/crbasic/) for sample programs

#### Dropbox Integration
- Import data files from Dropbox folders
- Ideal when dataloggers upload to Dropbox via cellular modems
- Automatic OAuth refresh token management
- See [DROPBOX_SETUP.md](DROPBOX_SETUP.md) for setup instructions

#### Manual File Import
- Upload TOA5 CSV files directly
- Bulk import historical data

## 24/7 Production Deployment

### Railway Cloud Deployment (Recommended)

Deploy Stratus Weather Station to Railway for 24/7 cloud operation:

#### Quick Setup
1. Push your code to GitHub
2. Connect Railway to your GitHub repository
3. Set environment variables in Railway dashboard:
   ```env
   DATABASE_URL=<your-postgresql-url>
   PORT=5000
   NODE_ENV=production
   CLIENT_JWT_SECRET=<generate-secure-secret>
   ```
4. Deploy - Railway auto-deploys on git push

#### Endpoints
- **Dashboard**: `https://your-app.railway.app`
- **API**: `https://your-app.railway.app/api`
- **Data Ingestion**: `https://your-app.railway.app/api/weather-data`

### Windows Desktop (Local)

For local 24/7 operation on Windows:

```powershell
# Run as Administrator
cd scripts
.\install-services.ps1
```

This creates a Windows scheduled task to start Stratus automatically on login.

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

## 🔒 Security

Stratus Weather Station implements industry-standard security practices:

- ✅ **Password Hashing:** bcrypt with 10 rounds
- ✅ **Rate Limiting:** 5 login attempts per 15 minutes
- ✅ **SQL Injection Protection:** Parameterized queries
- ✅ **XSS Prevention:** Input sanitization
- ✅ **Session Management:** Secure tokens with 24-hour expiration
- ✅ **HTTPS:** Enforced for external connections
- ✅ **Data Encryption:** Local data protection

**Security Documentation:** See [SECURITY.md](SECURITY.md) for details.

**Report Security Issues:** esterhuizen2k@proton.me (Do not open public issues)

---

## 📋 Compliance

### Campbell Scientific Integration
- ✅ **PakBus Protocol:** Full CRC-16 CCITT validation
- ✅ **Frame Structure:** Proper link state, hop count, addressing
- ✅ **Security Codes:** Levels 0-3 supported
- ✅ **Transaction Management:** Correct ID sequencing
- ✅ **Timeout Handling:** 
  - Cellular: 30-60s
  - LoRa: 60-120s
  - TCP/IP: 10-30s

### WMO Standards (Station Setup)
- ✅ **Metadata Validation:** Lat/Lon/Elevation/Timezone required
- ✅ **Sensor Configuration:** Height, calibration, maintenance tracking
- ✅ **Data Quality:** Out-of-range flagging, QC checks
- ✅ **Standard Heights:**
  - Temperature: 1.25-2m
  - Anemometer: 10m (standard)
  - Rain Gauge: 0.5-1.5m

---

## 🧪 Testing

Comprehensive testing checklist available in [TESTING_CHECKLIST.md](TESTING_CHECKLIST.md)

**Test Coverage:**
- ✅ Installer testing (clean system, upgrade, edge cases)
- ✅ First-run experience
- ✅ Authentication security
- ✅ Station setup (4G, LoRa, TCP/IP)
- ✅ Data collection (all modes)
- ✅ PakBus protocol compliance
- ✅ WMO standards compliance
- ✅ User interface
- ✅ Performance (24-hour stability)
- ✅ Security (SQL injection, XSS, brute force)

---

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [README.md](README.md) | This file - overview and installation |
| [LICENSE.txt](LICENSE.txt) | End User License Agreement (EULA) |
| [SECURITY.md](SECURITY.md) | Security implementation details |
| [STATION_SETUP.md](STATION_SETUP.md) | Station configuration guide |
| [TESTING_CHECKLIST.md](TESTING_CHECKLIST.md) | Comprehensive testing protocol |
| [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) | Cloud deployment instructions |

---

## 🐛 Troubleshooting

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
