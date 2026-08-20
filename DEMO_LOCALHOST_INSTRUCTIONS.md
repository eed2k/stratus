# Lightning Demo Dashboard - Localhost Setup

## Quick Start (Automated)

Double-click: **`START_DEMO.bat`**

This will:
1. Generate fresh lightning demo data
2. Start the server (port 5000)
3. Start the client (port 5173)
4. Import demo data to database
5. Open dashboard in browser

---

## Manual Setup (Step-by-Step)

### 1. Generate Demo Data

```bash
python generate_demo_quick.py
```

Creates: `lightning_demo_station8.dat` (318 strikes, 3 hours, from 3 days ago)

### 2. Start Server

**Terminal 1:**
```bash
cd c:\Users\eed2k\Downloads\stratus
npm run dev
```

Wait for: `Server running on http://localhost:5000`

### 3. Start Client

**Terminal 2:**
```bash
cd c:\Users\eed2k\Downloads\stratus\client
npm run dev
```

Wait for: `Local: http://localhost:5173`

### 4. Import Demo Data

**Option A: Via Script (Automated)**

**Terminal 3:**
```bash
cd c:\Users\eed2k\Downloads\stratus
node import-lightning-demo.js
```

**Option B: Via Dashboard (Manual)**

1. Open http://localhost:5173
2. Login
3. Go to SAWS Testbed station
4. Click **Data Import**
5. Upload `lightning_demo_station8.dat`
6. Wait for success message

### 5. View Lightning Data

1. Navigate to **SAWS Testbed** (Station ID 8)
2. Click **Configure** (gear icon)
3. Enable **"Lightning Proximity"** section
4. Set date range to **"Last 7 Days"**
5. Refresh page
6. Lightning card should appear with:
   - Distance: 5-6 km (closest strike)
   - Strike count: 318
   - Peak intensity: ~1.9M
   - Map with 40km detection rings

---

## Troubleshooting

### Server won't start

**Error**: `Port 5000 already in use`

**Fix**:
```bash
# Find and kill process
netstat -ano | findstr :5000
taskkill /PID <PID> /F
```

### Client won't start

**Error**: `Port 5173 already in use`

**Fix**:
```bash
# Find and kill process
netstat -ano | findstr :5173
taskkill /PID <PID> /F
```

### Import fails: "Module not found"

**Fix**: Install dependencies
```bash
npm install
cd client
npm install
```

### Lightning card not showing

**Checklist**:
- [ ] Date range set to "Last 7 Days" or longer
- [ ] Lightning Proximity enabled in dashboard config
- [ ] Station 8 (SAWS Testbed) has coordinates set
- [ ] Demo data actually imported (check Terminal 3 output)

**Verify import worked**:
```bash
# Check database (if you have psql access)
psql -U stratus -d stratus -c "SELECT COUNT(*) FROM weather_data WHERE station_id = 8 AND lightning IS NOT NULL;"
```

Should return: ~34 records

### Energy values look wrong

**Correct range**: 0 to 2,097,151 (21-bit AS3935 scale)

Example values from demo:
- 396,408 (19% - weak distant)
- 1,163,904 (55% - moderate)
- 1,936,657 (92% - very powerful)

If you see values like "302" or "996", regenerate:
```bash
python generate_demo_quick.py
```

---

## What You Get

### Demo Storm Profile

```
Time Range: August 9, 2026, 01:43 - 04:33 (3 hours)
Total Strikes: 318
Date Offset: 3 days ago (shows in 7-day dashboard view)

Storm Pattern:
├─ Approach (40km → 14km): Weak strikes, building
├─ Peak (14km → 5km): Strong strikes, 318 total
└─ Dissipation (5km → 37km): Weakening, moving away

AS3935 Specs:
├─ Distances: 14 discrete levels (1,5,6,8,10,12,14,17,20,24,27,31,34,37,40 km)
├─ Energy: 21-bit (0 to 2,097,151)
└─ Accuracy: ±4 km
```

### Dashboard Features

**Lightning Proximity Card:**
- Distance to last strike (km)
- Interactive map with 40km detection rings
- Strike count
- Intensity classification (Weak/Moderate/Strong/Severe)
- Relative energy percentage
- Storm proximity status (Clear/Distant/Moderate/Close/Severe)

**Lightning Chart:**
- Time-series distance plot
- Shows storm approach/dissipation pattern

**Fire Danger Index:**
- Uses lightning data in risk calculation

**PDF Reports:**
- Lightning section with all metrics

---

## Files

| File | Purpose |
|------|---------|
| `START_DEMO.bat` | One-click startup (Windows) |
| `generate_demo_quick.py` | Generate demo data file |
| `lightning_demo_station8.dat` | Generated CSV (import this) |
| `import-lightning-demo.js` | Auto-created import script |
| `DEMO_LOCALHOST_INSTRUCTIONS.md` | This file |

---

## Quick Commands

```bash
# Full reset (clean slate)
python generate_demo_quick.py
npm run dev # Terminal 1
cd client && npm run dev # Terminal 2
node import-lightning-demo.js # Terminal 3

# Just regenerate data
python generate_demo_quick.py
node import-lightning-demo.js

# Check if services running
netstat -ano | findstr :5000 # Server
netstat -ano | findstr :5173 # Client

# Stop all node processes (nuclear option)
taskkill /F /IM node.exe
```

---

## Support

If issues persist:
1. Check browser console (F12) for errors
2. Check server terminal output
3. Verify database connection in `.env` file
4. Try manual import via dashboard Data Import UI

Demo data is from **August 9, 2026** - make sure your dashboard date range includes this date!
