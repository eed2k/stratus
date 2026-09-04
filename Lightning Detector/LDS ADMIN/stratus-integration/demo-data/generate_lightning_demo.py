#!/usr/bin/env python3
"""
AS3935 Lightning Detector Demo Data Generator for Stratus Weather Dashboard

Generates realistic lightning strike data for import into the weather_data table.
Outputs a Campbell Scientific TOA5 CSV format that can be imported via the 
Stratus dashboard Data Import feature.

AS3935 detector specifications (AMS part AS3935):
- Detection range: 1-40 km
- Distance estimation: 14 discrete levels (1, 5, 6, 8, 10, 12, 14, 17, 20, 24, 27, 31, 34, 37, 40 km)
- Distance accuracy: ±4 km (manufacturer rated)
- Lightning energy: 21-bit relative measurement (0 to 2,097,151)
- Detection types: Cloud-to-ground, intra-cloud
- Event latency: <2 seconds (detection to log)
- Strike threshold: 1, 5, 9, or 16 events (programmable)
- Noise floor: 0-7 levels (programmable)
"""

import csv
import random
from datetime import datetime, timedelta
from typing import List, Tuple

# AS3935 Hardware Specifications
AS3935_DISTANCES = [1, 5, 6, 8, 10, 12, 14, 17, 20, 24, 27, 31, 34, 37, 40]  # 14 discrete levels
AS3935_ENERGY_MAX = 2097151  # 21-bit: 0 to 2^21 - 1
AS3935_DISTANCE_ERROR = 4  # ±4 km accuracy per spec

def nearest_distance(target_km: float) -> int:
    """Snap target distance to nearest AS3935 discrete level"""
    return min(AS3935_DISTANCES, key=lambda x: abs(x - target_km))

def generate_storm_event(base_time: datetime, duration_hours: int) -> List[Tuple[datetime, int, int, int]]:
    """
    Generate a realistic storm event with varying strike intensity.
    Returns list of (timestamp, strike_count, distance_km, energy).
    
    Distance: One of AS3935's 14 discrete levels
    Energy: 21-bit relative measurement (0-2,097,151)
    """
    records = []
    current_time = base_time
    cumulative_strikes = 0
    
    # Storm phases: approach (30%), peak (40%), dissipation (30%)
    total_minutes = duration_hours * 60
    approach_end = int(total_minutes * 0.3)
    peak_end = int(total_minutes * 0.7)
    
    for minute in range(0, total_minutes, 5):  # 5-minute intervals (typical logger rate)
        current_time = base_time + timedelta(minutes=minute)
        
        # Determine storm phase intensity
        if minute < approach_end:
            # Approaching: distance decreasing, strikes increasing
            phase_progress = minute / approach_end
            target_distance = 40 - (phase_progress * 26)  # 40km → 14km
            distance = nearest_distance(target_distance)
            strike_rate = 1 + int(phase_progress * 8)  # 1-8 strikes per interval
            # Energy: low to medium (10%-40% of 21-bit range)
            energy_scale = 0.1 + (phase_progress * 0.3)
        elif minute < peak_end:
            # Peak: close distance, high strike rate, high energy
            phase_progress = (minute - approach_end) / (peak_end - approach_end)
            target_distance = 14 - (phase_progress * 9)  # 14km → 5km with variation
            target_distance = max(1, target_distance + random.uniform(-3, 3))
            distance = nearest_distance(target_distance)
            strike_rate = 8 + int(random.uniform(0, 12))  # 8-20 strikes per interval
            # Energy: high (50%-95% of 21-bit range)
            energy_scale = 0.5 + random.uniform(0, 0.45)
        else:
            # Dissipating: distance increasing, strikes decreasing
            phase_progress = (minute - peak_end) / (total_minutes - peak_end)
            target_distance = 5 + (phase_progress * 35)  # 5km → 40km
            distance = nearest_distance(target_distance)
            strike_rate = max(1, int(8 - (phase_progress * 7)))  # 8 → 1 strikes
            # Energy: high to low (60%-15% of 21-bit range)
            energy_scale = 0.6 - (phase_progress * 0.45)
        
        # Add randomness to strikes (min threshold is 1 per AS3935 config option)
        strikes_this_interval = max(0, strike_rate + random.randint(-2, 2))
        cumulative_strikes += strikes_this_interval
        
        if strikes_this_interval > 0:
            # Energy: 21-bit value with some randomness within phase scale
            energy = int(energy_scale * AS3935_ENERGY_MAX + random.uniform(0, AS3935_ENERGY_MAX * 0.1))
            energy = max(0, min(AS3935_ENERGY_MAX, energy))
            
            records.append((
                current_time,
                cumulative_strikes,
                distance,
                energy
            ))
        else:
            # No strikes this interval - still record with previous distance if any strikes occurred
            if records:
                prev_distance = records[-1][2]
                records.append((current_time, cumulative_strikes, prev_distance, 0))
    
    return records


def generate_quiet_periods(base_time: datetime, days: int) -> List[Tuple[datetime, int, int, int]]:
    """Generate quiet weather with occasional isolated strikes."""
    records = []
    current_time = base_time
    cumulative_strikes = 0
    
    for hour in range(days * 24):
        current_time = base_time + timedelta(hours=hour)
        
        # 5% chance of isolated strike per hour
        if random.random() < 0.05:
            cumulative_strikes += 1
            # Distant isolated strikes (out toward AS3935 max range)
            distance = random.choice([27, 31, 34, 37, 40])
            # Low energy for distant strikes (5%-25% of 21-bit range)
            energy = random.randint(int(0.05 * AS3935_ENERGY_MAX), int(0.25 * AS3935_ENERGY_MAX))
            records.append((current_time, cumulative_strikes, distance, energy))
    
    return records


def write_toa5_csv(filename: str, station_name: str, records: List[Tuple[datetime, int, int, int]]):
    """
    Write data in Campbell Scientific TOA5 format.
    Stratus can import this via Data Import feature.
    """
    with open(filename, 'w', newline='') as f:
        # TOA5 header lines
        f.write(f'"TOA5","{station_name}","CR1000X","12345","CR1000X.Std.03.02","CPU:AS3935_v1.CR1X","60000","WeatherData"\n')
        f.write('"TIMESTAMP","RECORD","Lightning_Tot","LightningDist","LightningEnergy"\n')
        f.write('"TS","RN","","km",""\n')
        f.write('"","","Tot","Smp","Smp"\n')
        
        # Data rows
        writer = csv.writer(f, quoting=csv.QUOTE_ALL)
        for idx, (ts, strikes, distance, energy) in enumerate(records, start=1):
            writer.writerow([
                ts.strftime('%Y-%m-%d %H:%M:%S'),
                idx,
                strikes,
                distance,  # Integer, one of 14 discrete AS3935 levels
                energy     # Integer, 21-bit value
            ])


def write_sql_insert(filename: str, station_id: int, records: List[Tuple[datetime, int, int, int]]):
    """
    Write SQL INSERT statements for direct database import.
    """
    with open(filename, 'w') as f:
        f.write("-- AS3935 Lightning Detector Demo Data for Stratus Weather Dashboard\n")
        f.write(f"-- Station ID: {station_id}\n")
        f.write(f"-- Total records: {len(records)}\n")
        f.write("-- AS3935 Specs: 14 discrete distances (1-40 km), 21-bit energy (0-2,097,151)\n\n")
        
        for ts, strikes, distance, energy in records:
            # Store cumulative strike count per record
            f.write(
                f"INSERT INTO weather_data (station_id, timestamp, lightning, lightning_distance, lightning_energy) "
                f"VALUES ({station_id}, '{ts.strftime('%Y-%m-%d %H:%M:%S')}', {strikes}, {distance}, {energy});\n"
            )


def main():
    print("=" * 70)
    print("AS3935 Lightning Detector - Stratus Weather Dashboard Demo Data")
    print("=" * 70)
    print("\nAS3935 Specifications:")
    print("  • Distance: 14 discrete levels (1, 5, 6, 8, 10, 12, 14, 17, 20,")
    print("              24, 27, 31, 34, 37, 40 km) ±4 km accuracy")
    print(f"  • Energy: 21-bit relative (0 to {AS3935_ENERGY_MAX:,})")
    print("  • Detection: Cloud-to-ground, intra-cloud (<2s latency)")
    
    # Configuration
    station_id = int(input("\nEnter station ID (default 8): ") or "8")
    station_name = input("Enter station name (default 'Demo Station'): ") or "Demo Station"
    
    print("\nDemo scenario options:")
    print("1. Single severe thunderstorm (3 hours, 200+ strikes)")
    print("2. Multiple storm cells (24 hours, 4 storms)")
    print("3. Active week (7 days, storms + quiet periods)")
    print("4. Full month (30 days, realistic pattern)")
    
    scenario = input("\nSelect scenario (1-4, default 1): ") or "1"
    
    # Generate timestamps in the past so data shows in 7-day dashboard view
    end_time = datetime.now() - timedelta(days=2)  # Storm ended 2 days ago
    
    records = []
    
    if scenario == "1":
        # Single severe storm (3 hours, shows in last 7 days)
        start_time = end_time - timedelta(hours=3)
        records = generate_storm_event(start_time, 3)
        
    elif scenario == "2":
        # Multiple storms over 24h (ended 2 days ago)
        start_time = end_time - timedelta(hours=24)
        records = generate_quiet_periods(start_time, 0)  # No quiet period
        
        # Storm 1: Early morning (2h)
        records.extend(generate_storm_event(start_time + timedelta(hours=2), 2))
        
        # Storm 2: Late morning (1.5h)
        records.extend(generate_storm_event(start_time + timedelta(hours=10), 1.5))
        
        # Storm 3: Afternoon (3h, most severe)
        records.extend(generate_storm_event(start_time + timedelta(hours=14), 3))
        
        # Storm 4: Evening (1h)
        records.extend(generate_storm_event(start_time + timedelta(hours=20), 1))
        
    elif scenario == "3":
        # Active week (last 7 days)
        start_time = end_time - timedelta(days=5)  # Start 5 days before end (7 days total from now)
        records = generate_quiet_periods(start_time, 5)
        
        # Add 3 storms throughout the week
        records.extend(generate_storm_event(start_time + timedelta(days=1, hours=14), 2))
        records.extend(generate_storm_event(start_time + timedelta(days=4, hours=16), 3))
        records.extend(generate_storm_event(start_time + timedelta(days=6, hours=11), 2))
        
    elif scenario == "4":
        # Full month (last 30 days)
        start_time = end_time - timedelta(days=28)  # Start 28 days before end (30 days total from now)
        records = generate_quiet_periods(start_time, 28)
        
        # Add 8 storms throughout the month
        for day in [2, 5, 9, 12, 17, 21, 25, 28]:
            storm_time = start_time + timedelta(days=day, hours=random.randint(10, 18))
            duration = random.uniform(1.5, 3.5)
            records.extend(generate_storm_event(storm_time, duration))
    
    # Sort by timestamp and recalculate cumulative strikes
    records.sort(key=lambda x: x[0])
    cumulative = 0
    corrected_records = []
    for ts, _, dist, energy in records:
        if energy > 0:  # Only count actual strikes
            cumulative += 1
        corrected_records.append((ts, cumulative, dist, energy))
    
    records = corrected_records
    
    print(f"\nGenerated {len(records)} records")
    print(f"Total strikes: {records[-1][1] if records else 0}")
    if records:
        print(f"Time range: {records[0][0]} to {records[-1][0]}")
    
    # Output format selection
    print("\nOutput format:")
    print("1. Campbell TOA5 CSV (for Data Import in dashboard)")
    print("2. SQL INSERT statements (for direct database import)")
    print("3. Both")
    
    output_format = input("\nSelect format (1-3, default 1): ") or "1"
    
    if output_format in ["1", "3"]:
        csv_filename = f"lightning_demo_station{station_id}.dat"
        write_toa5_csv(csv_filename, station_name, records)
        print(f"\n✓ Created TOA5 CSV: {csv_filename}")
        print(f"  Import via: Dashboard → Data Import → Select file → Upload")
    
    if output_format in ["2", "3"]:
        sql_filename = f"lightning_demo_station{station_id}.sql"
        write_sql_insert(sql_filename, station_id, records)
        print(f"\n✓ Created SQL file: {sql_filename}")
        print(f"  Import via: psql -U stratus -d stratus -f {sql_filename}")
    
    print("\n" + "=" * 70)
    print("Demo data generation complete!")
    print("=" * 70)
    
    # Show sample data
    print("\nSample records (first 5):")
    print(f"{'Timestamp':<20} {'Strikes':>8} {'Distance':>10} {'Energy':>12}")
    print("-" * 55)
    for ts, strikes, dist, energy in records[:5]:
        print(f"{ts.strftime('%Y-%m-%d %H:%M:%S'):<20} {strikes:>8} {dist:>8} km {energy:>12,}")
    
    if len(records) > 5:
        print("...")
        print(f"\nLast record: {records[-1][0].strftime('%Y-%m-%d %H:%M:%S')} - "
              f"{records[-1][1]} total strikes, distance {records[-1][2]} km, "
              f"energy {records[-1][3]:,}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nCancelled by user.")
    except Exception as e:
        print(f"\n\nError: {e}")
        import traceback
        traceback.print_exc()
