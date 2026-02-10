// Database audit script - checks table row counts and indexes
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function audit() {
  console.log('=== STRATUS DATABASE AUDIT ===\n');

  // 1. Row counts for all core tables
  console.log('--- Table Row Counts ---');
  const tables = [
    'stations', 'weather_data', 'users', 'alarms', 'alarm_events',
    'shares', 'dropbox_configs', 'organizations', 'organization_members',
    'settings', 'table_definitions', 'collection_schedules',
    'password_reset_tokens', 'user_invitation_tokens', 'user_preferences',
    'organization_invitations'
  ];
  for (const t of tables) {
    try {
      const r = await pool.query('SELECT COUNT(*) as count FROM ' + t);
      console.log('  ' + t + ': ' + r.rows[0].count + ' rows');
    } catch (e) {
      console.log('  ' + t + ': TABLE NOT FOUND');
    }
  }

  // 2. Check for duplicate weather data
  console.log('\n--- Duplicate Weather Data Check ---');
  try {
    const dupes = await pool.query(`
      SELECT station_id, table_name, timestamp, COUNT(*) as cnt
      FROM weather_data
      GROUP BY station_id, table_name, timestamp
      HAVING COUNT(*) > 1
      LIMIT 5
    `);
    if (dupes.rows.length === 0) {
      console.log('  No duplicate weather data found. GOOD.');
    } else {
      console.log('  WARNING: Found ' + dupes.rows.length + ' duplicate groups:');
      dupes.rows.forEach(r => console.log('    station=' + r.station_id + ' table=' + r.table_name + ' ts=' + r.timestamp + ' count=' + r.cnt));
    }
  } catch (e) {
    console.log('  Error checking duplicates: ' + e.message);
  }

  // 3. List all existing indexes
  console.log('\n--- Existing Indexes ---');
  try {
    const idx = await pool.query("SELECT indexname, tablename FROM pg_indexes WHERE schemaname='public' ORDER BY tablename, indexname");
    let lastTable = '';
    idx.rows.forEach(r => {
      if (r.tablename !== lastTable) {
        console.log('  [' + r.tablename + ']');
        lastTable = r.tablename;
      }
      console.log('    ' + r.indexname);
    });
  } catch (e) {
    console.log('  Error: ' + e.message);
  }

  // 4. Check users
  console.log('\n--- Users ---');
  try {
    const users = await pool.query('SELECT id, email, role, is_active, last_login_at, created_at FROM users ORDER BY id');
    users.rows.forEach(u => {
      console.log('  ID=' + u.id + ' email=' + u.email + ' role=' + u.role + ' active=' + u.is_active + ' last_login=' + (u.last_login_at || 'never') + ' created=' + u.created_at);
    });
  } catch (e) {
    console.log('  Error: ' + e.message);
  }

  // 5. Check stations
  console.log('\n--- Stations ---');
  try {
    const stations = await pool.query('SELECT id, name, connection_type, is_active, last_connected, created_at FROM stations ORDER BY id');
    stations.rows.forEach(s => {
      console.log('  ID=' + s.id + ' name=' + s.name + ' type=' + s.connection_type + ' active=' + s.is_active + ' last_connected=' + (s.last_connected || 'never'));
    });
  } catch (e) {
    console.log('  Error: ' + e.message);
  }

  // 6. Weather data per station
  console.log('\n--- Weather Data Per Station ---');
  try {
    const wd = await pool.query(`
      SELECT station_id, table_name, COUNT(*) as records, 
             MIN(timestamp) as earliest, MAX(timestamp) as latest
      FROM weather_data
      GROUP BY station_id, table_name
      ORDER BY station_id, table_name
    `);
    wd.rows.forEach(r => {
      console.log('  station=' + r.station_id + ' table=' + r.table_name + ' records=' + r.records + ' range=' + r.earliest + ' to ' + r.latest);
    });
  } catch (e) {
    console.log('  Error: ' + e.message);
  }

  // 7. Dropbox configs
  console.log('\n--- Dropbox Configs ---');
  try {
    const dc = await pool.query('SELECT id, name, station_id, enabled, last_sync_at, last_sync_status, last_sync_records FROM dropbox_configs ORDER BY id');
    dc.rows.forEach(d => {
      console.log('  ID=' + d.id + ' name=' + d.name + ' station=' + d.station_id + ' enabled=' + d.enabled + ' last_sync=' + (d.last_sync_at || 'never') + ' status=' + d.last_sync_status + ' records=' + d.last_sync_records);
    });
  } catch (e) {
    console.log('  Error: ' + e.message);
  }

  await pool.end();
  console.log('\n=== AUDIT COMPLETE ===');
}

audit().catch(e => { console.error('Audit failed:', e); process.exit(1); });
