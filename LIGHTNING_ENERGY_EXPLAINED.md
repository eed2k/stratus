# AS3935 Lightning Detector - Energy Values Explained

## What is Lightning Energy?

The **energy** (also called **intensity**) value from the AS3935 lightning detector is **NOT** a physical measurement in Joules or Watts. It's a **relative dimensionless scale** that represents the **strength of the electromagnetic signal** received by the detector's antenna.

## How It Works

### 1. **Detection Mechanism**

The AS3935 chip detects lightning by sensing electromagnetic waves (radio frequency noise) produced by lightning discharges:

```
Lightning Strike
    ↓
Electromagnetic Wave (RF energy)
    ↓
AS3935 Antenna receives signal
    ↓
Internal algorithm processes signal pattern
    ↓
Outputs: Distance estimate + Energy value
```

### 2. **Energy Scale - 21-bit Resolution**

The AS3935 outputs a **21-bit energy value** ranging from **0 to 2,097,151**:

```
21 bits = 2^21 = 2,097,152 possible values (0 to 2,097,151)
```

Typical ranges for interpretation:

| Energy Range | Percentage | Strike Interpretation |
|--------------|------------|----------------------|
| **0 - 200,000** | 0-10% | Very weak/distant strikes, noise floor |
| **200,000 - 600,000** | 10-30% | Weak strikes, distant storm edges |
| **600,000 - 1,000,000** | 30-50% | Moderate strikes, approaching storm |
| **1,000,000 - 1,500,000** | 50-75% | Strong strikes, active storm nearby |
| **1,500,000 - 2,097,151** | 75-100% | Very powerful strikes, severe storm overhead |

**Example real values:**
- `235,272` = Weak distant strike (~11% of max)
- `681,106` = Moderate strike (~32% of max)
- `1,488,670` = Strong strike (~71% of max)
- `1,936,657` = Very powerful strike (~92% of max)

### 3. **What Influences Energy Values**

The energy reading is affected by:

| Factor | Effect on Energy Value |
|--------|----------------------|
| **Strike distance** | Closer = Higher energy (inverse square law) |
| **Strike power** | More powerful discharge = Higher energy |
| **Strike type** | Cloud-to-ground > cloud-to-cloud (typically) |
| **Antenna sensitivity** | Higher gain settings = Higher readings |
| **Environmental noise** | Can inflate or deflate readings |
| **Antenna tuning** | Proper tuning = More accurate relative values |

### 4. **Important Limitations**

⚠️ **The energy value is NOT calibrated to absolute units**

- You **cannot** convert it to Joules, Watts, or Amperes
- You **cannot** compare values between different AS3935 installations (antenna variations affect readings)
- It's only useful for **relative comparisons within the same installation**
- The manufacturer (AMS/ScioSense) does not publish the conversion formula to absolute energy

## How Stratus Uses Energy Values

### Dashboard Display

In the Stratus weather dashboard, lightning energy appears as:

```
Lightning Card:
├── Peak Intensity: 996        ← Maximum energy value in period
└── Average Intensity: 656     ← Mean energy value in period
```

### Interpretation Guide

Use these relative thresholds to interpret storm intensity:

| Energy Range | % of Max | Storm Interpretation |
|--------------|----------|---------------------|
| 0 - 200,000 | 0-10% | Very weak activity, distant storm edges, or noise |
| 200,000 - 600,000 | 10-30% | Weak storm activity, distant strikes |
| 600,000 - 1,000,000 | 30-50% | Moderate storm, approaching or receding |
| 1,000,000 - 1,500,000 | 50-75% | Strong storm, close proximity |
| 1,500,000 - 2,097,151 | 75-100% | Severe storm, very powerful strikes nearby |

### Example Storm Timeline

Here's what a typical storm looks like in the Stratus dashboard:

```
Time    Distance    Energy        % of Max    Interpretation
23:30   40 km       235,272       11%         ← Storm approaching, weak distant strikes
23:45   31 km       510,262       24%         ← Getting closer, moderate activity
00:15   12 km       1,150,000     55%         ← Peak activity, strong strikes
00:30   6 km        1,936,657     92%         ← Very intense, storm overhead
00:45   8 km        1,488,670     71%         ← Still strong, starting to move away
01:15   20 km       881,450       42%         ← Receding, moderate activity
01:45   34 km       354,564       17%         ← Weak, storm moving away
```

## Technical Details

### AS3935 Internal Processing

The chip performs sophisticated signal analysis:

1. **Pattern Recognition**: Distinguishes lightning from noise (motors, appliances, RF interference)
2. **Energy Calculation**: Measures peak amplitude of the received RF waveform
3. **False Positive Rejection**: Filters out man-made disturbances
4. **Statistical Averaging**: Uses recent strikes (last 15 seconds) to improve distance estimates

### Register Output

The AS3935 stores the energy value in register `0x04` as a **21-bit value** (technically spread across multiple registers). The raw value ranges from 0 to 2,097,151 (2^21 - 1). Campbell Scientific dataloggers and the Stratus system store this as an integer in the `lightning_energy` column.

### Comparison to Other Lightning Detection

| System | Energy Measurement |
|--------|-------------------|
| **AS3935 (local sensor)** | Relative electromagnetic signal strength (0-1000 scale) |
| **Professional networks** | Absolute peak current in kA (e.g., "45 kA negative ground flash") |
| **Optical sensors** | Photometric intensity or total radiant energy in Joules |
| **VLF/LF networks** | Signal-to-noise ratio (dB) or power flux density |

## Demo Data Generator Logic

The `generate_lightning_demo.py` script creates realistic 21-bit energy values:

```python
AS3935_ENERGY_MAX = 2097151  # 21-bit maximum

# Storm phase determines energy scale
if minute < approach_phase_end:
    # Approaching: low to medium energy (10%-40% of 21-bit max)
    energy_scale = 0.1 + (progress * 0.3)
    
elif minute < peak_phase_end:
    # Peak: high energy (50%-95% of 21-bit max)
    energy_scale = 0.5 + random.uniform(0, 0.45)
    
else:
    # Dissipating: high to low energy (60%-15% of 21-bit max)
    energy_scale = 0.6 - (progress * 0.45)

# Final energy value (21-bit scale: 0 to 2,097,151)
energy = int(energy_scale * AS3935_ENERGY_MAX + random.uniform(0, AS3935_ENERGY_MAX * 0.1))
energy = max(0, min(AS3935_ENERGY_MAX, energy))
```

This simulates:
- **Approach**: Weak distant strikes (200,000-600,000 range = 10-30%)
- **Peak**: Strong nearby strikes (1,000,000-2,000,000 range = 50-95%)
- **Dissipation**: Weakening as storm moves away (300,000-1,000,000 range = 15-50%)

## Practical Use Cases

### 1. **Storm Tracking**

Watch energy values increase then decrease to track storm movement:
- Rising energy + decreasing distance = Storm approaching
- High energy + stable short distance = Storm overhead
- Falling energy + increasing distance = Storm receding

### 2. **Alert Thresholds**

Set warnings based on 21-bit energy values:
```javascript
const ENERGY_MAX = 2097151; // 21-bit max

if (energy > 0.7 * ENERGY_MAX && distance < 10) {
  // Energy > 1,468,006 and close
  alert("SEVERE STORM OVERHEAD - Seek shelter immediately!");
}
else if (energy > 0.5 * ENERGY_MAX && distance < 20) {
  // Energy > 1,048,576 and nearby
  alert("Strong storm nearby - Lightning within 20km");
}
else if (energy > 0.2 * ENERGY_MAX && distance < 40) {
  // Energy > 419,430 and within range
  alert("Moderate storm activity detected");
}
```

### 3. **Historical Analysis**

Compare storm intensity across days/weeks:
```sql
-- Find most intense storms in last 30 days
SELECT 
  DATE(timestamp) as storm_date,
  MAX(lightning_energy) as peak_intensity,
  ROUND(MAX(lightning_energy) / 2097151.0 * 100, 1) as peak_percentage,
  COUNT(*) as total_strikes
FROM weather_data
WHERE lightning IS NOT NULL
  AND lightning_energy > 1000000  -- Only significant strikes (>48% of max)
GROUP BY DATE(timestamp)
ORDER BY peak_intensity DESC;
```

### 4. **Fire Danger Modeling**

Higher energy strikes are more likely to start fires:
- **Dry fuel + high energy strikes (>1,000,000 or >50% max) = Elevated fire risk**
- Used in Stratus Fire Danger Index calculation

## Summary

| Aspect | Key Point |
|--------|-----------|
| **Units** | Dimensionless (not Joules, not Watts, not Amperes) |
| **Range** | 0 to 2,097,151 (21-bit), with 200K-600K weak, 1M-1.5M strong |
| **Resolution** | 21 bits = 2,097,152 discrete levels |
| **Purpose** | Relative strike intensity comparison within same sensor |
| **NOT for** | Absolute energy measurement, cross-sensor comparison |
| **Useful for** | Storm tracking, alert thresholds, historical intensity analysis |

## References

Content rephrased for compliance with licensing restrictions. Information derived from:
- [SparkFun AS3935 Lightning Detector Hookup Guide](https://learn.sparkfun.com/tutorials/sparkfun-qwiic-as3935-lightning-detector-hookup-guide)
- AS3935 manufacturer specifications (AMS/ScioSense)
- Campbell Scientific weather station integration documentation

The AS3935 detects electromagnetic signals and provides a relative intensity scale. For absolute lightning energy measurements, professional lightning location networks use different technologies (VLF/LF time-of-arrival systems with calibrated sensors).
