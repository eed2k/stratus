const pg = require("pg");
const c = new pg.Client(process.env.DATABASE_URL);
c.connect().then(async () => {
  // Station 15 - check a rain event to determine cumulative vs incremental
  const s15rain = await c.query(
    "SELECT timestamp, (data->>'Rain_Tot')::numeric as rain FROM weather_data" +
    " WHERE station_id = 15 AND (data->>'Rain_Tot')::numeric > 0 AND EXTRACT(YEAR FROM timestamp) = 2023" +
    " ORDER BY timestamp LIMIT 30"
  );
  console.log("Station 15 non-zero rain readings 2023:", JSON.stringify(s15rain.rows.slice(0, 15)));

  // Run the actual rainfall-yearly query for station 15
  const fields = [
    "data->>'Rain_mm_Tot'", "data->>'Rain_Tot'", "data->>'Precip'",
    "data->>'Rain_mm'", "data->>'Precip_Tot'", "data->>'Rain_1_Tot'",
    "data->>'Rain_Tot_1'", "data->>'rainfall'", "data->>'Rain'", "data->>'Rainfall'"
  ];
  const coalesce = fields.join(', ');
  
  for (const sid of [1, 2, 4, 15]) {
    const result = await c.query(
      "WITH rainfall_readings AS (" +
      "  SELECT EXTRACT(YEAR FROM timestamp) AS year, timestamp," +
      "    COALESCE(" + coalesce + ")::numeric AS rainfall_val" +
      "  FROM weather_data WHERE station_id = $1" +
      "    AND COALESCE(" + coalesce + ") IS NOT NULL" +
      "), yearly_bounds AS (" +
      "  SELECT year, MIN(timestamp) AS first_ts, MAX(timestamp) AS last_ts, COUNT(*) AS readings" +
      "  FROM rainfall_readings GROUP BY year HAVING COUNT(*) >= 2" +
      ") SELECT yb.year, yb.readings," +
      "  (SELECT rainfall_val FROM rainfall_readings r WHERE r.year = yb.year ORDER BY r.timestamp ASC LIMIT 1) AS first_val," +
      "  (SELECT rainfall_val FROM rainfall_readings r WHERE r.year = yb.year ORDER BY r.timestamp DESC LIMIT 1) AS last_val" +
      " FROM yearly_bounds yb ORDER BY yb.year DESC LIMIT 6",
      [sid]
    );
    console.log("Station " + sid + " yearly query result:", JSON.stringify(result.rows));
  }

  // Check shares for stations
  const shares = await c.query("SELECT id, station_id, share_token, is_active FROM shared_dashboards WHERE is_active = true");
  console.log("Active shares:", JSON.stringify(shares.rows));

  c.end();
}).catch(e => { console.error(e); process.exit(1); });
