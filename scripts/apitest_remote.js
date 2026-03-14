const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    // Simulate what the route does: fetch all records for station 1, 31 days
    const stationId = 1;
    const endTime = new Date();
    const startTime = new Date(endTime.getTime() - 31 * 24 * 60 * 60 * 1000);
    
    console.log('Querying station', stationId, 'from', startTime.toISOString(), 'to', endTime.toISOString());
    
    // This is what db-postgres.ts getWeatherData does (without LIMIT)
    const result = await pool.query(
      "SELECT id, station_id, timestamp, data FROM weather_data WHERE station_id = $1 AND timestamp >= $2 AND timestamp <= $3 ORDER BY timestamp DESC",
      [stationId, startTime.toISOString(), endTime.toISOString()]
    );
    
    console.log('DB returned:', result.rows.length, 'records');
    
    if (result.rows.length > 0) {
      console.log('First record timestamp:', result.rows[result.rows.length - 1].timestamp);
      console.log('Last record timestamp:', result.rows[0].timestamp);
      
      // Compute time span
      const first = new Date(result.rows[result.rows.length - 1].timestamp);
      const last = new Date(result.rows[0].timestamp);
      const spanDays = (last - first) / (24 * 60 * 60 * 1000);
      console.log('Time span:', spanDays.toFixed(1), 'days');
      
      // Simulate route-level downsampling to 2000 points
      const maxPoints = 2000;
      if (result.rows.length > maxPoints) {
        const step = result.rows.length / maxPoints;
        let sampledCount = 0;
        for (let i = 0; i < result.rows.length; i += step) {
          sampledCount++;
        }
        console.log('After downsampling to', maxPoints, ': would get', sampledCount, 'points');
        
        // Check time span of sampled points
        const firstSampled = new Date(result.rows[Math.floor((sampledCount - 1) * step)].timestamp);
        const lastSampled = new Date(result.rows[0].timestamp);
        const sampledSpan = (lastSampled - firstSampled) / (24 * 60 * 60 * 1000);
        console.log('Sampled time span:', sampledSpan.toFixed(1), 'days');
      }
    }
    
    await pool.end();
  } catch(e) { 
    console.error('Error:', e.message); 
    process.exit(1); 
  }
})();
