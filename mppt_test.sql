UPDATE weather_data SET
  mppt_solar_voltage = CASE
    WHEN EXTRACT(hour FROM timestamp) BETWEEN 6 AND 18 THEN
      ROUND((18.0 + 8.0 * SIN(PI() * (EXTRACT(hour FROM timestamp) - 6) / 12.0) + (random() - 0.5) * 2)::numeric, 2)
    ELSE ROUND((0.1 + random() * 0.3)::numeric, 2)
  END,
  mppt_solar_current = CASE
    WHEN EXTRACT(hour FROM timestamp) BETWEEN 6 AND 18 THEN
      ROUND((1.5 * SIN(PI() * (EXTRACT(hour FROM timestamp) - 6) / 12.0) + (random() - 0.5) * 0.3)::numeric, 3)
    ELSE 0
  END,
  mppt_solar_power = CASE
    WHEN EXTRACT(hour FROM timestamp) BETWEEN 6 AND 18 THEN
      ROUND((25.0 * SIN(PI() * (EXTRACT(hour FROM timestamp) - 6) / 12.0) + (random() - 0.5) * 3)::numeric, 2)
    ELSE 0
  END,
  mppt_load_voltage = ROUND((12.0 + random() * 0.5)::numeric, 2),
  mppt_load_current = ROUND((0.3 + random() * 0.4)::numeric, 3),
  mppt_battery_voltage = CASE
    WHEN EXTRACT(hour FROM timestamp) BETWEEN 8 AND 16 THEN
      ROUND((13.2 + random() * 1.0)::numeric, 2)
    WHEN EXTRACT(hour FROM timestamp) BETWEEN 6 AND 18 THEN
      ROUND((12.8 + random() * 0.6)::numeric, 2)
    ELSE ROUND((12.2 + random() * 0.4)::numeric, 2)
  END,
  mppt_charger_state = CASE
    WHEN EXTRACT(hour FROM timestamp) BETWEEN 9 AND 14 THEN 3
    WHEN EXTRACT(hour FROM timestamp) BETWEEN 7 AND 16 THEN 2
    WHEN EXTRACT(hour FROM timestamp) IN (6, 17, 18) THEN 1
    ELSE 0
  END,
  mppt_absi_avg = CASE
    WHEN EXTRACT(hour FROM timestamp) BETWEEN 6 AND 18 THEN
      ROUND((0.8 * SIN(PI() * (EXTRACT(hour FROM timestamp) - 6) / 12.0) + (random() - 0.5) * 0.2)::numeric, 3)
    ELSE ROUND((-0.15 + random() * 0.1)::numeric, 3)
  END
WHERE station_id = 1 AND timestamp >= '2026-02-17 00:00:00' AND timestamp <= '2026-02-18 09:41:00';
