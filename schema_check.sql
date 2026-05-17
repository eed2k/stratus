SELECT station_id, COUNT(*) AS n, MIN(timestamp) AS oldest, MAX(timestamp) AS newest FROM weather_data GROUP BY station_id ORDER BY station_id;
SELECT station_id, table_name, data FROM weather_data ORDER BY timestamp DESC LIMIT 3;
SELECT station_id, table_name, jsonb_object_keys(data) AS key, COUNT(*) AS n
FROM weather_data
GROUP BY station_id, table_name, key
ORDER BY station_id, n DESC
LIMIT 100;
