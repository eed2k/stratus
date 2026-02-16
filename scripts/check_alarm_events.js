// Quick script to check alarm events in DB
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    const count = await p.query('SELECT COUNT(1) as cnt FROM alarm_events');
    console.log('Total alarm events:', count.rows[0].cnt);
    
    const all = await p.query('SELECT id, alarm_id, station_id, message, created_at FROM alarm_events ORDER BY created_at DESC LIMIT 20');
    console.log('\nRecent events:');
    all.rows.forEach(row => {
      console.log(`  ID=${row.id} alarm=${row.alarm_id} station=${row.station_id} msg="${(row.message || '').substring(0, 80)}" at=${row.created_at}`);
    });
    
    // Show duplicates (same alarm_id within 5 minutes)
    const dupes = await p.query(`
      SELECT a1.id, a1.alarm_id, a1.created_at, a1.message
      FROM alarm_events a1
      INNER JOIN alarm_events a2 ON a1.alarm_id = a2.alarm_id 
        AND a1.id != a2.id 
        AND ABS(EXTRACT(EPOCH FROM (a1.created_at - a2.created_at))) < 300
      ORDER BY a1.alarm_id, a1.created_at
    `);
    if (dupes.rows.length > 0) {
      console.log('\nDuplicate events (same alarm within 5 min):');
      dupes.rows.forEach(row => {
        console.log(`  ID=${row.id} alarm=${row.alarm_id} at=${row.created_at}`);
      });
    } else {
      console.log('\nNo duplicate events found.');
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await p.end();
  }
})();
