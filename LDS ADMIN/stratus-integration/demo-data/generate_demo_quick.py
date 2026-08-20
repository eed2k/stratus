#!/usr/bin/env python3
"""Quick AS3935 lightning demo data generator"""
import csv
import random
from datetime import datetime, timedelta

# AS3935 specifications
AS3935_DISTANCES = [1, 5, 6, 8, 10, 12, 14, 17, 20, 24, 27, 31, 34, 37, 40]  # 14 discrete levels + "out of range"
AS3935_ENERGY_MAX = 2097151  # 21-bit (0 to 2^21 - 1)

def nearest_distance(target_km):
    """Snap to nearest AS3935 discrete distance level"""
    return min(AS3935_DISTANCES, key=lambda x: abs(x - target_km))

# Generate 3-hour storm from 3 days ago (shows in 7-day dashboard view)
end_time = datetime.now() - timedelta(days=3)
start_time = end_time - timedelta(hours=3)

records = []
cumulative = 0
current = start_time

# Storm progression: approach, peak, dissipate
for minute in range(0, 180, 5):  # 5-min intervals
    current = start_time + timedelta(minutes=minute)
    
    if minute < 54:  # Approach: 30%
        progress = minute / 54
        target_dist = 40 - (progress * 26)  # 40km -> 14km
        distance = nearest_distance(target_dist)
        strikes = max(0, int(progress * 8) + random.randint(-1, 2))
        # Energy: low to medium (10% to 40% of 21-bit range)
        energy = int((0.1 + progress * 0.3) * AS3935_ENERGY_MAX + random.uniform(0, AS3935_ENERGY_MAX * 0.1))
    elif minute < 126:  # Peak: 40%
        target_dist = 14 - random.uniform(0, 9)  # 14km -> 5km range
        distance = nearest_distance(max(1, target_dist))
        strikes = random.randint(8, 20)
        # Energy: high (50% to 95% of 21-bit range)
        energy = int(random.uniform(0.5 * AS3935_ENERGY_MAX, 0.95 * AS3935_ENERGY_MAX))
    else:  # Dissipate: 30%
        progress = (minute - 126) / 54
        target_dist = 5 + (progress * 35)  # 5km -> 40km
        distance = nearest_distance(target_dist)
        strikes = max(0, int(8 - progress * 7) + random.randint(-2, 1))
        # Energy: high to low (60% to 15% of 21-bit range)
        energy = int((0.6 - progress * 0.45) * AS3935_ENERGY_MAX + random.uniform(0, AS3935_ENERGY_MAX * 0.1))
    
    if strikes > 0:
        cumulative += strikes
        energy = max(0, min(AS3935_ENERGY_MAX, energy))
        records.append((current, cumulative, distance, energy))

# Write Campbell TOA5 CSV
with open('lightning_demo_station8.dat', 'w', newline='', encoding='utf-8') as f:
    f.write('"TOA5","SAWS Testbed","CR1000X","12345","CR1000X.Std.03.02","CPU:AS3935_Demo","60000","WeatherData"\n')
    f.write('"TIMESTAMP","RECORD","Lightning_Tot","LightningDist","LightningEnergy"\n')
    f.write('"TS","RN","","km",""\n')
    f.write('"","","Tot","Smp","Smp"\n')
    writer = csv.writer(f, quoting=csv.QUOTE_ALL)
    for idx, (ts, strikes, dist, energy) in enumerate(records, start=1):
        writer.writerow([ts.strftime('%Y-%m-%d %H:%M:%S'), idx, strikes, dist, energy])

print(f'Generated: lightning_demo_station8.dat')
print(f'Records: {len(records)}, Total strikes: {records[-1][1] if records else 0}')
if records:
    print(f'Range: {records[0][0].strftime("%Y-%m-%d %H:%M")} to {records[-1][0].strftime("%Y-%m-%d %H:%M")}')
    print(f'\nAS3935 Specs: 14 discrete distances (1-40 km), 21-bit energy (0-{AS3935_ENERGY_MAX:,})')
    print(f'\nSample (first 3):')
    for ts, strikes, dist, energy in records[:3]:
        print(f'  {ts.strftime("%H:%M")} - {strikes:3d} strikes, {dist:2d} km, energy {energy:,}')
