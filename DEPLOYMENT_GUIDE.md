# Stratus Weather Station - Deployment & Setup Guide

**Version:** 1.0.0  
**Date:** January 12, 2026  
**Developer:** Lukas Esterhuizen (esterhuizen2k@proton.me)

---

## 📦 Deployment Options

### 1. Windows Desktop Application (Recommended)

The primary deployment method is the professional Windows installer.

#### Build the Installer:
```powershell
cd "c:\Users\eed2k\Downloads\Itronics Projects\stratus"
npm run dist:win
```

#### Output Files:
- `output/Stratus Weather Station-1.0.0-Setup.exe` - Full NSIS installer with GUI
- `output/win-unpacked/` - Unpacked application files (for testing)

#### Installer Features:
- ✅ Welcome screen with developer information
- ✅ Comprehensive EULA/License agreement (must accept to proceed)
- ✅ Custom installation directory selection
- ✅ Desktop shortcut option
- ✅ Start menu shortcut option
- ✅ Professional NSIS installer interface
- ✅ Clean uninstaller (available in Control Panel)
- ✅ First-run welcome/login screen

#### Testing the Installer:
1. Run `Stratus Weather Station-1.0.0-Setup.exe`
2. Read and accept the Terms & Conditions (EULA)
3. Choose installation directory (or keep default)
4. Select Desktop/Start Menu shortcut options
5. Complete installation
6. First-run welcome screen appears on launch
7. Login or create account, or skip to continue
8. Test uninstallation from Control Panel → Programs

---

### 2. Railway Backend Deployment (Cloud)

For cloud deployment, Railway is the recommended platform.

#### Environment Variables (Railway):
```env
DATABASE_URL=<your-postgresql-url>
PORT=5000
NODE_ENV=production
CLIENT_JWT_SECRET=<generate-secure-secret>
VITE_DEMO_MODE=false
```

#### Deployment:
```bash
# Railway auto-deploys from Git push
git push origin main
```

#### Included Features:
- PostgreSQL database integration
- Campbell Scientific PakBus data collection
- REST API endpoints
- WebSocket real-time updates
- JWT authentication
- Rate limiting

---

### 3. Docker Deployment

A Dockerfile is included for containerized deployment.

```bash
# Build the Docker image
docker build -t stratus-weather .

# Run the container
docker run -p 5000:5000 -e DATABASE_URL="your-db-url" stratus-weather
```

---

## 🔒 Security & Compliance

### Authentication:
- ✅ JWT token-based authentication
- ✅ bcrypt password hashing (10 rounds)
- ✅ Session management with expiration
- ✅ Rate limiting on login endpoints (5 attempts/15 min)
- ✅ CORS properly configured

### Campbell Scientific Compliance:
- ✅ Full PakBus protocol implementation
- ✅ CRC-16 CCITT validation
- ✅ Security code handling (levels 0-3)
- ✅ PakBus address validation (1-4094)
- ✅ Configurable timeout and retry logic
- ✅ Connection health monitoring
- ✅ Support for 4G/Cellular, LoRa, TCP/IP connections

### WMO Standards Compliance:
- ✅ Station metadata validation (lat, lon, elevation, timezone)
- ✅ Sensor configuration tracking
- ✅ Calibration date management
- ✅ Data quality indicators

### Data Protection:
- ✅ Comprehensive EULA in installer
- ✅ User data preserved on uninstall (configurable)
- ✅ No sensitive data in logs
- ✅ Input validation and sanitization

---

## 🧪 Testing Checklist

### Windows Installer Testing:
- [ ] Run installer on clean Windows 10/11 machine
- [ ] Verify EULA is displayed and must be accepted
- [ ] Test custom installation directory selection
- [ ] Confirm Desktop shortcut is created
- [ ] Confirm Start Menu shortcut is created
- [ ] Verify first-run welcome screen appears
- [ ] Test application launches correctly
- [ ] Test uninstaller from Control Panel
- [ ] Verify clean uninstallation

### Application Testing:
- [ ] Test login with valid credentials
- [ ] Test login with invalid credentials (rate limiting)
- [ ] Test station setup (4G, LoRa, TCP/IP)
- [ ] Test data collection
- [ ] Test dashboard display
- [ ] Test real-time WebSocket updates

### Backend Testing:
- [ ] Verify API endpoints respond correctly
- [ ] Test Campbell Scientific PakBus communication
- [ ] Test WebSocket connections
- [ ] Test authentication endpoints
- [ ] Verify rate limiting is active

---

## 📝 Project Structure

```
stratus/
├── assets/                 # Application icons and images
├── build/                  # Build resources (icon.ico, installer.nsh)
├── client/                 # React frontend (Vite)
├── demo_data/              # Sample weather station data
├── docs/                   # User documentation
├── electron/               # Electron main process files
│   ├── main.js            # Main Electron entry point
│   ├── preload.js         # Context bridge for IPC
│   └── welcome.html       # First-run welcome screen
├── examples/               # CRBasic program examples
├── output/                 # Build output (installers)
├── scripts/                # Build and utility scripts
├── server/                 # Express.js backend
│   ├── campbell/          # Campbell Scientific integration
│   ├── compliance/        # Compliance checking routes
│   ├── parsers/           # Data file parsers
│   ├── protocols/         # Communication protocols
│   └── services/          # Background services
├── shared/                 # Shared types and schemas
├── LICENSE.txt            # Comprehensive EULA
├── SECURITY.md            # Security documentation
├── package.json           # Project configuration
└── README.md              # Project overview
```

---

## 🚀 Quick Start

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Development Mode:**
   ```bash
   npm run dev
   ```

3. **Build Windows Installer:**
   ```bash
   npm run dist:win
   ```

4. **Run Production Build:**
   ```bash
   npm run build
   npm start
   ```

---

## 📞 Support

**Developer:** Lukas Esterhuizen  
**Email:** esterhuizen2k@proton.me

For issues or questions, contact the developer directly or open an issue on GitHub.

---

## 📜 License

See `LICENSE.txt` for the full End User License Agreement (EULA).

By installing or using this software, you agree to the Terms & Conditions outlined in the LICENSE.txt file.

**Copyright © 2024-2026 Lukas Esterhuizen. All rights reserved.**
