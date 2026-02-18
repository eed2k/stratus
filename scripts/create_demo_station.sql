-- Create Demo Station with MPPT Solar Charger test data
-- This station demonstrates the MPPT dashboard with simulated data

-- 1. Delete any existing demo station data first
DELETE FROM weather_data WHERE station_id IN (SELECT id FROM stations WHERE name = 'DEMO STATION');
DELETE FROM stations WHERE name = 'DEMO STATION';

-- 2. Insert the demo station
INSERT INTO stations (name, location, latitude, longitude, station_type, datalogger_model, is_active, created_at)
VALUES (
  'DEMO STATION',
  'Demo - Simulated MPPT Data',
  -33.0,
  18.5,
  'campbell_scientific',
  'CR300 Demo',
  true,
  NOW()
);

-- 3. Get the demo station ID
DO $$
DECLARE
  demo_id INTEGER;
  ts TIMESTAMP;
BEGIN
  SELECT id INTO demo_id FROM stations WHERE name = 'DEMO STATION';
  
  IF demo_id IS NULL THEN
    RAISE EXCEPTION 'Demo station not found';
  END IF;

  -- 3. Generate 48 hours of 5-minute interval data with realistic MPPT patterns
  FOR ts IN SELECT generate_series(
    NOW() - INTERVAL '48 hours',
    NOW(),
    INTERVAL '5 minutes'
  ) LOOP
    INSERT INTO weather_data (
      station_id, timestamp, collected_at, table_name, record_number,
      data,
      mppt_solar_voltage, mppt_solar_current, mppt_solar_power,
      mppt_load_voltage, mppt_load_current,
      mppt_battery_voltage, mppt_charger_state, mppt_absi_avg
    ) VALUES (
      demo_id,
      ts,
      ts + INTERVAL '10 seconds',
      'Demo_MPPT',
      EXTRACT(EPOCH FROM ts)::INTEGER,
      -- Store weather data in JSONB data column
      jsonb_build_object(
        'temperature', ROUND((22.0 + 8.0 * SIN(PI() * (EXTRACT(hour FROM ts) - 6) / 12.0) + (random() - 0.5) * 2)::numeric, 1),
        'humidity', ROUND((55.0 - 15.0 * SIN(PI() * (EXTRACT(hour FROM ts) - 6) / 12.0) + (random() - 0.5) * 5)::numeric, 1),
        'pressure', ROUND((1013.0 + (random() - 0.5) * 4)::numeric, 1),
        'windSpeed', ROUND((2.0 + random() * 3)::numeric, 1),
        'windDirection', ROUND((random() * 360)::numeric, 0),
        'batteryVoltage', CASE
          WHEN EXTRACT(hour FROM ts) BETWEEN 8 AND 16 THEN ROUND((13.4 + random() * 0.8)::numeric, 2)
          WHEN EXTRACT(hour FROM ts) BETWEEN 6 AND 18 THEN ROUND((12.9 + random() * 0.5)::numeric, 2)
          ELSE ROUND((12.3 + random() * 0.3)::numeric, 2)
        END,
        'solarRadiation', CASE
          WHEN EXTRACT(hour FROM ts) BETWEEN 6 AND 18 THEN ROUND((800.0 * SIN(PI() * (EXTRACT(hour FROM ts) - 6) / 12.0) + (random() - 0.5) * 100)::numeric, 1)
          ELSE 0
        END
      ),
      -- MPPT Solar Voltage (panels ~18-26V during day, near 0 at night)
      CASE
        WHEN EXTRACT(hour FROM ts) BETWEEN 6 AND 18 THEN
          ROUND((18.0 + 8.0 * SIN(PI() * (EXTRACT(hour FROM ts) - 6) / 12.0) + (random() - 0.5) * 2)::numeric, 2)
        ELSE ROUND((0.05 + random() * 0.2)::numeric, 2)
      END,
      -- MPPT Solar Current (0-2A during day)
      CASE
        WHEN EXTRACT(hour FROM ts) BETWEEN 6 AND 18 THEN
          ROUND((1.8 * SIN(PI() * (EXTRACT(hour FROM ts) - 6) / 12.0) + (random() - 0.5) * 0.3)::numeric, 3)
        ELSE 0
      END,
      -- MPPT Solar Power (0-35W during day)
      CASE
        WHEN EXTRACT(hour FROM ts) BETWEEN 6 AND 18 THEN
          ROUND((35.0 * SIN(PI() * (EXTRACT(hour FROM ts) - 6) / 12.0) + (random() - 0.5) * 4)::numeric, 2)
        ELSE 0
      END,
      -- MPPT Load Voltage (~12V constant)
      ROUND((12.0 + random() * 0.5)::numeric, 2),
      -- MPPT Load Current (0.2-0.7A)
      ROUND((0.2 + random() * 0.5)::numeric, 3),
      -- MPPT Battery Voltage (follows charge cycle)
      CASE
        WHEN EXTRACT(hour FROM ts) BETWEEN 9 AND 15 THEN
          ROUND((13.6 + random() * 0.8)::numeric, 2)
        WHEN EXTRACT(hour FROM ts) BETWEEN 7 AND 17 THEN
          ROUND((13.0 + random() * 0.6)::numeric, 2)
        ELSE ROUND((12.2 + random() * 0.4)::numeric, 2)
      END,
      -- MPPT Charger State (0=Off, 1=Bulk, 2=Absorption, 3=Float)
      CASE
        WHEN EXTRACT(hour FROM ts) BETWEEN 10 AND 14 THEN 3  -- Float (fully charged midday)
        WHEN EXTRACT(hour FROM ts) BETWEEN 8 AND 16 THEN 2   -- Absorption
        WHEN EXTRACT(hour FROM ts) IN (6, 7, 17, 18) THEN 1  -- Bulk (sunrise/sunset)
        ELSE 0                                                  -- Off (night)
      END,
      -- MPPT Average Current
      CASE
        WHEN EXTRACT(hour FROM ts) BETWEEN 6 AND 18 THEN
          ROUND((1.0 * SIN(PI() * (EXTRACT(hour FROM ts) - 6) / 12.0) + (random() - 0.5) * 0.2)::numeric, 3)
        ELSE ROUND((-0.12 + random() * 0.08)::numeric, 3)
      END
    );
  END LOOP;

  -- 4. Update station last_connected
  UPDATE stations SET last_connected = NOW(), is_active = true WHERE id = demo_id;

  RAISE NOTICE 'Demo station created with ID % and MPPT data populated', demo_id;
END $$;

-- 5. MPPT data already cleaned from station 1
