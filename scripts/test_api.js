// Test API data range - run inside Docker container
const http = require("http");

// First, get a share token from the database directly
const { Client } = require("pg");

async function test() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  
  // Find tables
  const tables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
  console.log("Tables:", tables.rows.map(r => r.table_name).join(", "));
  
  // Get stations
  const stations = await client.query("SELECT id, name FROM stations LIMIT 5");
  console.log("Stations:", JSON.stringify(stations.rows));
  
  if (stations.rows.length > 0) {
    const stationId = stations.rows[0].id;
    // Count records in last 31 days
    const count = await client.query(
      "SELECT COUNT(*) as cnt, MIN(timestamp) as min_ts, MAX(timestamp) as max_ts FROM weather_data WHERE station_id = $1 AND timestamp >= NOW() - INTERVAL '31 days'",
      [stationId]
    );
    console.log("Station " + stationId + " last 31d:", JSON.stringify(count.rows[0]));
    
    // Count by day
    const byDay = await client.query(
      "SELECT DATE(timestamp) as day, COUNT(*) as cnt FROM weather_data WHERE station_id = $1 AND timestamp >= NOW() - INTERVAL '31 days' GROUP BY DATE(timestamp) ORDER BY day",
      [stationId]
    );
    console.log("Records per day across " + byDay.rows.length + " days:");
    byDay.rows.forEach(r => console.log("  " + r.day.toISOString().slice(0,10) + ": " + r.cnt + " records"));
  }
  
  await client.end();
}

test().catch(e => console.error(e));
