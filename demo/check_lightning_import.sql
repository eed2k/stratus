-- Check if lightning demo data was imported successfully

-- 1. Check if we have ANY lightning data for station 8
SELECT 
  'Total lightning records' as check_type,
  COUNT(*) as count,
  MIN(timestamp) as earliest,
  MAX(timestamp) as latest
FROM weather_data 
WHERE station_id = 8 
  AND (
    lightning IS NOT NULL 
    OR lightning_distance IS NOT NULL 
    OR lightning_energy IS NOT NULL
  );

-- 2. Check latest 10 lightning records with all fields
SELECT 
  timestamp,
  lightning,
  lightning_distance,
  lightning_energy
FROM weather_data
WHERE station_id = 8
  AND lightning IS NOT NULL
ORDER BY timestamp DESC
LIMIT 10;

-- 3. Check date range of demo data (should be around August 9, 2026)
SELECT 
  DATE(timestamp) as date,
  COUNT(*) as records,
  MAX(lightning) as max_strikes,
  MIN(lightning_distance) as closest_km,
  MAX(lightning_energy) as peak_energy
FROM weather_data
WHERE station_id = 8
  AND lightning IS NOT NULL
GROUP BY DATE(timestamp)
ORDER BY date DESC
LIMIT 7;

-- 4. Check if station 8 exists and has coordinates
SELECT 
  id,
  name,
  latitude,
  longitude
FROM stations
WHERE id = 8;
