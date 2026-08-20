#!/usr/bin/env python3
"""Preview what the demo data will look like in the dashboard"""
import csv
from datetime import datetime

# Parse the generated demo file
with open('lightning_demo_station8.dat', 'r') as f:
    lines = f.readlines()[4:]  # Skip 4 header lines
    reader = csv.reader(lines)
    records = list(reader)

# Calculate dashboard metrics
strikes = [int(r[2]) for r in records if len(r) > 2]
distances = [int(r[3]) for r in records if len(r) > 3]  # AS3935 discrete levels
energies = [int(r[4]) for r in records if len(r) > 4]  # 21-bit values

total_strikes = strikes[-1] if strikes else 0
closest_dist = min(distances) if distances else 0
avg_dist = sum(distances) / len(distances) if distances else 0
peak_energy = max(energies) if energies else 0
avg_energy = sum(energies) / len(energies) if energies else 0

print('=' * 70)
print('DASHBOARD PREVIEW: What You Will See After Import')
print('=' * 70)
print()
print('AS3935 Detector (AMS chip):')
print('  14 discrete distance levels: 1, 5, 6, 8, 10, 12, 14, 17, 20,')
print('                                24, 27, 31, 34, 37, 40 km (±4 km)')
print('  21-bit energy scale: 0 to 2,097,151 (relative measurement)')
print()
print('Lightning Card Metrics:')
print(f'  Total Strikes:       {total_strikes}')
print(f'  Closest Distance:    {closest_dist} km')
print(f'  Average Distance:    {avg_dist:.1f} km')
print(f'  Peak Intensity:      {peak_energy:,}')
print(f'  Average Intensity:   {avg_energy:,.0f}')
print()
print(f'Storm Timeline ({len(records)} data points):')
for i in [0, len(records)//3, 2*len(records)//3, -1]:
    if i >= 0:
        r = records[i]
        ts = datetime.strptime(r[0], '%Y-%m-%d %H:%M:%S')
        phase = ['Approach', 'Peak', 'Dissipate', 'End'][min(3, i // max(1, len(records)//3))]
        print(f'  {ts.strftime("%H:%M")} ({phase:>9s}) - {r[2]:>3s} strikes, {int(r[3]):>2d} km, energy {int(r[4]):>9,}')

print()
print('Unique AS3935 distance levels detected in this storm:')
unique_dists = sorted(set(distances))
print(f'  {", ".join(map(str, unique_dists))} km')
print()
print('=' * 70)
print('Ready to import: lightning_demo_station8.dat')
print('=' * 70)
