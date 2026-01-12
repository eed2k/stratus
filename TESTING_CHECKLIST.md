# Phase 7: Comprehensive Testing Checklist

**Developer:** Lukas Esterhuizen (esterhuizen2k@proton.me)  
**Date:** January 12, 2026  
**Application:** Stratus Weather Station v1.0.0

---

## 7.1 Installer Testing

### Clean System Test
- [ ] **Setup Test VM/Clean Machine** (Windows 10/11)
- [ ] **Run Installer:** `Stratus Weather Station-1.0.0-Setup.exe`
- [ ] **Welcome Screen Displays** with developer info
- [ ] **EULA Displays** with scroll functionality
- [ ] **"I Accept" checkbox** must be checked to proceed
- [ ] **Installation Directory Selection** appears (default: `C:\Users\[User]\AppData\Local\Stratus Weather Station`)
- [ ] **User can browse and change directory** successfully
- [ ] **Desktop shortcut checkbox** appears (checked by default)
- [ ] **Start menu shortcut checkbox** appears (checked by default)
- [ ] **Installation progress bar** shows and completes
- [ ] **Installation completes successfully** without errors
- [ ] **Option to launch application** appears
- [ ] **Developer info visible:** "Lukas Esterhuizen (esterhuizen2k@proton.me)"

### Installation Verification
- [ ] **Desktop shortcut created** (if selected)
- [ ] **Start menu shortcut created** in "Stratus Weather Station" folder
- [ ] **Application icon displays** correctly in shortcuts
- [ ] **Install directory contains all files:**
  - `Stratus Weather Station.exe`
  - `resources/` folder
  - `locales/` folder
  - `node_modules/` folder
- [ ] **Uninstaller registered** in Windows "Apps & Features"

### Upgrade Test (if previous version exists)
- [ ] **Install previous version** first
- [ ] **Create test station data**
- [ ] **Run new installer**
- [ ] **Upgrade process completes** without data loss
- [ ] **Settings retained** after upgrade
- [ ] **Stations preserved** after upgrade

### Edge Cases
- [ ] **Install to custom directory** with special characters (e.g., `C:\Test Folder\Weather`)
- [ ] **Install with minimal permissions** (non-admin user)
- [ ] **Install on drive with low disk space** (handles error gracefully)
- [ ] **Install while antivirus active** (no false positives)

### Uninstaller Testing
- [ ] **Run uninstaller** from "Apps & Features"
- [ ] **Confirmation dialog appears**
- [ ] **Option to preserve user data** works correctly
- [ ] **Application files removed** from install directory
- [ ] **User data preserved** in AppData (if selected)
- [ ] **Desktop shortcut removed**
- [ ] **Start menu folder removed**
- [ ] **Registry entries cleaned up**

**Test Result:** ⬜ Pass / ⬜ Fail  
**Notes:**

---

## 7.2 First-Run Experience Testing

### Welcome Screen (First Launch)
- [ ] **Application launches** successfully after installation
- [ ] **Welcome screen appears** on first run
- [ ] **Developer information displayed:** "Developed by: Lukas Esterhuizen" with email
- [ ] **Login tab active by default**
- [ ] **Register tab accessible**
- [ ] **"Skip for now" link visible** at bottom

### Login Tab Testing
- [ ] **Username field** accepts input
- [ ] **Password field** masks characters
- [ ] **Form validation** prevents empty submission
- [ ] **Login with invalid credentials** shows error message
- [ ] **Login with valid credentials** proceeds to main app
- [ ] **Error messages clear** when switching tabs

### Register Tab Testing
- [ ] **All fields required:** username, email, password, confirm password
- [ ] **Email validation** rejects invalid formats
- [ ] **Password mismatch** shows error message
- [ ] **Successful registration** shows success message
- [ ] **Auto-redirect to login tab** after 2 seconds
- [ ] **Newly registered account** can log in successfully

### Skip Option
- [ ] **"Skip for now" link works**
- [ ] **Confirmation dialog appears** before skipping
- [ ] **Application proceeds** to main interface if confirmed
- [ ] **First-run flag set** (welcome screen doesn't show again)

### Subsequent Launches
- [ ] **Second launch** goes directly to main app (no welcome screen)
- [ ] **Config file created** in userData directory
- [ ] **Session persists** across restarts

**Test Result:** ⬜ Pass / ⬜ Fail  
**Notes:**

---

## 7.3 Authentication Testing

### Login Security
- [ ] **Passwords hashed** with bcrypt (10 rounds)
- [ ] **Passwords not visible** in database
- [ ] **Passwords not visible** in logs
- [ ] **Passwords not visible** in error messages
- [ ] **Session tokens generated** on successful login
- [ ] **Session tokens expire** after 24 hours
- [ ] **Rate limiting active** (5 attempts per 15 minutes)
- [ ] **Brute force protection** blocks excessive attempts

### Session Management
- [ ] **User session persists** across page navigation
- [ ] **Session valid** after application restart
- [ ] **Logout clears session** completely
- [ ] **Expired session** redirects to login
- [ ] **Concurrent sessions** handled properly

### SQL Injection Protection
- [ ] **Login form** resistant to SQL injection attempts
  - Test: `admin' OR '1'='1`
  - Test: `admin'; DROP TABLE users;--`
- [ ] **All input fields** use parameterized queries

### XSS Protection
- [ ] **Username input** sanitized (test: `<script>alert('XSS')</script>`)
- [ ] **Station name input** sanitized
- [ ] **All text outputs** properly escaped

**Test Result:** ⬜ Pass / ⬜ Fail  
**Notes:**

---

## 7.4 Station Setup Testing

### 4G/Cellular Connection
- [ ] **Form displays all required fields:**
  - Station Name
  - APN
  - PIN (optional)
  - IP Address
  - Port (default: 6785)
  - PakBus Address
- [ ] **IP address validation** (format: xxx.xxx.xxx.xxx)
- [ ] **Port validation** (1-65535)
- [ ] **PakBus address validation** (1-4094)
- [ ] **Test connection** with valid credentials succeeds
- [ ] **Test connection** with invalid IP shows clear error
- [ ] **Network timeout** handled gracefully (30-60s)
- [ ] **Error messages descriptive** (not generic)

### LoRa Connection
- [ ] **Form displays LoRa-specific fields:**
  - Frequency (MHz)
  - Spreading Factor (7-12)
  - Bandwidth (kHz)
  - Coding Rate
- [ ] **Frequency validation** (within LoRa band)
- [ ] **SF validation** (7-12 range)
- [ ] **Bandwidth validation** (125/250/500 kHz)
- [ ] **Test connection** works with valid config
- [ ] **Out-of-range values** rejected with clear error
- [ ] **Connection timeout** appropriate (60-120s for LoRa)

### TCP/IP Connection
- [ ] **Form displays TCP/IP fields:**
  - Host/IP Address
  - Port
  - PakBus Address
- [ ] **IP format validated**
- [ ] **DNS names supported** (e.g., logger.example.com)
- [ ] **Invalid IP format rejected**
- [ ] **Connection refused** handled gracefully
- [ ] **Firewall blocking** shows helpful error

### Station Management
- [ ] **Add new station** saves successfully
- [ ] **Edit existing station** preserves unchanged fields
- [ ] **Delete station** shows confirmation dialog
- [ ] **Station list** displays all stations
- [ ] **Import station config** from JSON/XML works
- [ ] **Export station config** creates valid file

**Test Result:** ⬜ Pass / ⬜ Fail  
**Notes:**

---

## 7.5 Data Collection Testing

### Collection Modes
- [ ] **Most Recent Records** collects latest data
- [ ] **Since Last Collection** gets new records only
- [ ] **Specific Date Range** collects correct timeframe
- [ ] **Manual collection** works on-demand
- [ ] **Scheduled collection** runs at configured interval

### Error Handling
- [ ] **Connection lost during collection** retries appropriately
- [ ] **Logger program change** detected and handled
- [ ] **Table definition mismatch** shows clear error
- [ ] **Invalid data records** skipped with warning
- [ ] **Timeout during collection** doesn't hang app

### Data Integrity
- [ ] **No data loss** on connection interruption
- [ ] **Duplicate records** prevented
- [ ] **Data timestamps** correct for timezone
- [ ] **Data types** match logger table definition
- [ ] **NULL values** handled properly

### Performance
- [ ] **Collection of 1000 records** completes in < 30s
- [ ] **Collection of 10000 records** completes without crash
- [ ] **Memory usage** remains stable during collection
- [ ] **CPU usage** reasonable (< 50% during collection)

**Test Result:** ⬜ Pass / ⬜ Fail  
**Notes:**

---

## 7.6 Campbell Scientific PakBus Compliance

### Protocol Verification
- [ ] **CRC-16 CCITT calculation** matches Campbell specification
- [ ] **Frame structure** follows PakBus standard
  - Link state byte
  - Hop count
  - Source/Destination addresses
  - Priority
  - Security code
- [ ] **Security codes** properly implemented (levels 0-3)
- [ ] **Transaction IDs** managed correctly
- [ ] **Please Wait messages** handled during long operations

### Communication Testing
- [ ] **Hello message** establishes connection
- [ ] **Get Settings** retrieves logger configuration
- [ ] **Get Table Definition** gets table structure
- [ ] **Collect Data** retrieves records
- [ ] **Clock Set** synchronizes logger time
- [ ] **File operations** (send/receive) work

### Timeout Values
- [ ] **Cellular connections:** 30-60s timeout
- [ ] **LoRa connections:** 60-120s timeout
- [ ] **TCP/IP connections:** 10-30s timeout
- [ ] **Retry logic** attempts 3 times before failing

**Test Result:** ⬜ Pass / ⬜ Fail  
**Notes:**

---

## 7.7 WMO Standards Compliance

### Station Metadata Validation
- [ ] **Station Name** required and validated
- [ ] **Latitude** range: -90 to +90 degrees
- [ ] **Longitude** range: -180 to +180 degrees
- [ ] **Elevation** range: -500 to +9000 meters
- [ ] **Timezone** properly set with UTC offset
- [ ] **Station Type** classification required
- [ ] **Installation Date** recorded

### Sensor Configuration
- [ ] **Sensor type** validated against WMO standards
- [ ] **Sensor height** recorded (meters above ground)
- [ ] **Temperature sensor:** 1.25-2m height (standard)
- [ ] **Anemometer:** 10m height (standard) or documented
- [ ] **Rain gauge:** 0.5-1.5m height
- [ ] **Calibration date** recorded
- [ ] **Calibration coefficients** stored

### Data Quality
- [ ] **Out-of-range values** flagged
- [ ] **Suspicious data** flagged for review
- [ ] **Sensor maintenance** history tracked
- [ ] **Quality control flags** applied per WMO guidelines

**Test Result:** ⬜ Pass / ⬜ Fail  
**Notes:**

---

## 7.8 User Interface Testing

### Navigation
- [ ] **All menu items accessible** and functional
- [ ] **Dashboard loads** without errors
- [ ] **Stations page** displays station list
- [ ] **Data Collection page** shows collection controls
- [ ] **Settings page** accessible
- [ ] **Keyboard shortcuts** work (Ctrl+1, Ctrl+2, etc.)

### Forms & Validation
- [ ] **All form fields** validate on submit
- [ ] **Required fields** marked clearly
- [ ] **Error messages** appear near relevant fields
- [ ] **Success messages** appear after save
- [ ] **Unsaved changes warning** when navigating away

### Dashboard Display
- [ ] **Real-time data** updates correctly
- [ ] **Charts render** properly
- [ ] **Wind rose diagram** displays accurately
- [ ] **Station status indicators** show correct state
- [ ] **Last update timestamp** accurate

### Export Functions
- [ ] **Export as CSV** creates valid file
- [ ] **Export as TOA5** matches Campbell format
- [ ] **Export as JSON** valid JSON structure
- [ ] **PDF export** generates readable report
- [ ] **Exported data** matches displayed data

### Responsive Design
- [ ] **1920x1080 resolution** displays correctly
- [ ] **1366x768 resolution** readable and functional
- [ ] **Minimum 1024x768** works acceptably
- [ ] **Window resize** doesn't break layout

**Test Result:** ⬜ Pass / ⬜ Fail  
**Notes:**

---

## 7.9 Performance Testing

### Startup Performance
- [ ] **Application starts** in < 5 seconds
- [ ] **Dashboard loads** in < 3 seconds
- [ ] **No lag** on first interaction

### Runtime Performance
- [ ] **24-hour continuous run** without memory leaks
- [ ] **Memory usage** stable (< 500MB typical)
- [ ] **CPU usage idle** < 5%
- [ ] **CPU usage active** < 25% (during data collection)

### Database Performance
- [ ] **Query response** < 100ms for typical queries
- [ ] **Large dataset queries** (10,000+ records) < 2s
- [ ] **Database file size** grows predictably
- [ ] **No database locking** issues

### Network Performance
- [ ] **Simultaneous collections** from 5 stations works
- [ ] **Network interruption** recovers gracefully
- [ ] **Bandwidth usage** reasonable for cellular

**Test Result:** ⬜ Pass / ⬜ Fail  
**Notes:**

---

## 7.10 Security Testing

### Authentication Security
- [ ] **SQL injection blocked** (tested with common payloads)
- [ ] **XSS attempts sanitized** (tested with script tags)
- [ ] **Brute force protection** active (rate limiting)
- [ ] **Session hijacking** prevented (secure tokens)
- [ ] **Password requirements** enforced (length, complexity)

### Data Security
- [ ] **Passwords not in logs** (checked log files)
- [ ] **API keys not exposed** (checked source, network)
- [ ] **Database file permissions** appropriate
- [ ] **Backup files secured** (if backup feature used)

### Network Security
- [ ] **HTTPS enforced** for external connections
- [ ] **Certificate validation** working
- [ ] **No plaintext passwords** over network
- [ ] **CORS properly configured**

**Test Result:** ⬜ Pass / ⬜ Fail  
**Notes:**

---

## Test Summary

| Phase | Status | Pass/Fail | Notes |
|-------|--------|-----------|-------|
| 7.1 Installer Testing | ⬜ | ⬜ Pass / ⬜ Fail | |
| 7.2 First-Run Experience | ⬜ | ⬜ Pass / ⬜ Fail | |
| 7.3 Authentication | ⬜ | ⬜ Pass / ⬜ Fail | |
| 7.4 Station Setup | ⬜ | ⬜ Pass / ⬜ Fail | |
| 7.5 Data Collection | ⬜ | ⬜ Pass / ⬜ Fail | |
| 7.6 PakBus Compliance | ⬜ | ⬜ Pass / ⬜ Fail | |
| 7.7 WMO Compliance | ⬜ | ⬜ Pass / ⬜ Fail | |
| 7.8 User Interface | ⬜ | ⬜ Pass / ⬜ Fail | |
| 7.9 Performance | ⬜ | ⬜ Pass / ⬜ Fail | |
| 7.10 Security | ⬜ | ⬜ Pass / ⬜ Fail | |

**Overall Test Result:** ⬜ Pass / ⬜ Fail

**Issues Found:**

**Tester:** _________________  
**Date Completed:** _________________  
**Signature:** _________________

---

**Contact for Issues:**  
Lukas Esterhuizen  
esterhuizen2k@proton.me
