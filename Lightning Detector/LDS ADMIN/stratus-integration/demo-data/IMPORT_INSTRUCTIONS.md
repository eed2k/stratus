# Lightning Demo Data - Import Instructions

## Quick Import for Demo Dashboard

The generated demo data is **perfectly timed** to show in your 7-day dashboard view:

- **Data range**: 3 days ago (storm on August 9, 2026)
- **Duration**: 3-hour thunderstorm
- **Strikes**: 280 total
- **Energy**: 21-bit AS3935 values (520,984 to 1,982,624)

---

## Step-by-Step Import

### 1. Generate Fresh Demo Data

```bash
cd c:\Users\eed2k\Downloads\stratus
python generate_demo_quick.py
```

**Output**: `lightning_demo_station8.dat` (ready to import)

### 2. Login to Stratus Dashboard

Open: https://stratusweather.co.za

### 3. Navigate to Station

Click on **SAWS Testbed** (Station ID: 8) in your station list

### 4. Open Data Import

In the sidebar, click **Data Import**

### 5. Upload File

- Click **"Select file"** or drag-and-drop
- Choose: `lightning_demo_station8.dat`
- Click **"Upload"** / **"Import"**

### 6. View Lightning Data

The dashboard will refresh and display:

**Lightning Card** (appears immediately):
```
Lightning ⚡
├─ Total Strikes: 280
├─ Closest Strike: 5 km
├─ Average Distance: 16.9 km
├─ Peak Intensity: 1,982,624
└─ Average Intensity: 1,163,904
```

**Lightning Chart** (time-series plot):
- Shows distance over time
- Storm approach: 40km → 5km
- Storm peak: 5-8km
- Storm dissipation: 8km → 37km

---

## Understanding Energy Values

### What is "1,982,624"?

This is the **AS3935's 21-bit energy scale**:

| Energy Value | % of Maximum | Meaning |
|--------------|--------------|---------|
| **520,984** | 25% | Weak distant strike |
| **1,163,904** | 55% | Moderate strike (average in your storm) |
| **1,982,624** | 95% | Very powerful strike (peak in your storm) |
| **2,097,151** | 100% | Maximum possible (21-bit limit) |

### How to Read Energy

```
Energy = Electromagnetic signal strength (not Joules or Watts!)
```

**Think of it as a "lightning loudness" scale:**
- **0 - 400,000** (0-20%): Whisper - very distant, weak
- **400,000 - 1,000,000** (20-50%): Speaking voice - moderate, approaching
- **1,000,000 - 1,600,000** (50-80%): Shouting - strong, nearby
- **1,600,000 - 2,097,151** (80-100%): Air horn - extremely powerful, overhead

### Why 21-bit?

The AS3935 chip uses a **21-bit analog-to-digital converter** for energy measurement:

```
21 bits = 2^21 = 2,097,152 possible values

This gives extremely fine resolution to distinguish between:
- Weak cloud-to-cloud flashes (200,000-600,000)
- Moderate cloud-to-ground strikes (600,000-1,200,000)
- Strong nearby strikes (1,200,000-1,800,000)
- Severe direct strikes (1,800,000-2,097,151)
```

### Real Example from Your Demo Data

```
Time     Distance    Energy        % Max    Interpretation
────────────────────────────────────────────────────────────
00:28    34 km       520,984       25%      ← Storm far away, weak signal
00:48    27 km       748,645       36%      ← Getting closer, moderate
01:13    12 km       1,460,580     70%      ← Strong strikes, storm nearby
01:23    8 km        1,972,016     94%      ← PEAK! Powerful strike, overhead
01:38    10 km       1,650,420     79%      ← Still very strong
02:03    20 km       1,089,245     52%      ← Weakening, moving away
02:43    34 km       643,890       31%      ← Distant now, weak
```

---

## Dashboard Date Range

### Default View: Last 7 Days

Your dashboard defaults to showing **the last 7 days of data**. The demo data is generated **3 days ago** so it appears immediately:

```
Timeline:
├─ Now: August 12, 2026
├─ Demo storm: August 9, 2026 (3 days ago) ✓ Shows
└─ 7-day range: August 5 - 12, 2026
```

### Changing Date Range

Use the date picker at the top of the dashboard:

- **24 hours**: Shows only recent data (demo won't appear)
- **7 days**: Default, shows demo data ✓
- **30 days**: Shows all data including demo ✓
- **Custom**: Pick any date range

---

## Troubleshooting

### "No lightning data" after import

**Check 1**: Date range selector
- Set dashboard to **"Last 7 Days"** or **"Last 30 Days"**
- Demo data is from 3 days ago

**Check 2**: Station ID mismatch
- Demo defaults to station ID 8 (SAWS Testbed)
- To change: Edit `generate_demo_quick.py`, change the station logic, or use `generate_lightning_demo.py` interactive mode

**Check 3**: Verify import success
```sql
-- Connect to database and check
SELECT COUNT(*), MIN(timestamp), MAX(timestamp), MAX(lightning_energy)
FROM weather_data 
WHERE station_id = 8 
  AND lightning IS NOT NULL;
```

### Lightning card shows "n/a"

This means no lightning data in the selected time range:
- Widen the date range to 7 or 30 days
- Regenerate demo data (may have wrong timestamps)

### Energy values look wrong

**Correct range**: 0 to 2,097,151 (21-bit)

If you see values like "302" or "996", the generator used the old scale. Regenerate:
```bash
python generate_demo_quick.py
```

---

## Advanced: Generate Different Scenarios

### Interactive Generator

```bash
python generate_lightning_demo.py
```

**Prompts**:
1. Station ID (default: 8)
2. Scenario:
   - **1**: Single severe storm (3 hours, 200+ strikes)
   - **2**: Multiple storms (24 hours, 4 separate cells)
   - **3**: Active week (5 days, 3 storms + quiet periods)
   - **4**: Full month (28 days, 8 storms + isolated strikes)
3. Output format:
   - **1**: Campbell TOA5 CSV (for dashboard import)
   - **2**: SQL INSERT statements (direct database)
   - **3**: Both

### Example: Month of Lightning Data

```bash
python generate_lightning_demo.py
Enter station ID: 8
Enter station name: SAWS Testbed
Select scenario: 4
Select format: 1
```

Creates `lightning_demo_station8.dat` with 28 days of realistic storm patterns.

---

## Preview Before Import

```bash
python preview_demo.py
```

Shows what metrics will appear in dashboard:

```
AS3935 Detector:
  14 discrete distance levels: 1, 5, 6, 8, 10, 12, 14, 17, 20,
                                24, 27, 31, 34, 37, 40 km (±4 km)
  21-bit energy scale: 0 to 2,097,151

Lightning Card Metrics:
  Total Strikes:       280
  Closest Distance:    5 km
  Average Distance:    16.9 km
  Peak Intensity:      1,982,624
  Average Intensity:   1,163,904
```

---

## Files Reference

| File | Purpose |
|------|---------|
| `generate_demo_quick.py` | One-command generator (3-hour storm) |
| `generate_lightning_demo.py` | Interactive with 4 scenarios |
| `preview_demo.py` | Show dashboard metrics before import |
| `lightning_demo_station8.dat` | Generated Campbell TOA5 CSV (import this) |
| `LIGHTNING_DEMO_README.md` | Complete technical documentation |
| `LIGHTNING_ENERGY_EXPLAINED.md` | Deep dive on energy values |
| `IMPORT_INSTRUCTIONS.md` | This file (import guide) |

---

## Summary

**Energy values like `1,982,624` are:**
- ✓ 21-bit electromagnetic signal strength (0 to 2,097,151)
- ✓ Relative "loudness" of the lightning strike
- ✓ Higher number = More powerful strike
- ✗ NOT Joules, NOT Watts, NOT Amperes
- ✗ Cannot compare between different AS3935 installations

**To see demo data in dashboard:**
1. Generate: `python generate_demo_quick.py`
2. Login: https://stratusweather.co.za
3. Go to: SAWS Testbed station
4. Import: Upload `lightning_demo_station8.dat`
5. View: Lightning card shows immediately (set date range to 7 days)

**Your demo storm** (generated 3 days ago):
- 280 strikes over 3 hours
- Peak intensity: 1,982,624 (94% of max)
- Closest strike: 5 km
- Storm pattern: 40km approach → 5km overhead → 37km dissipate
