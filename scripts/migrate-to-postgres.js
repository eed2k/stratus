#!/usr/bin/env node
/**
 * SQLite to PostgreSQL Migration Script
 * 
 * Migrates data from the SQLite database to a PostgreSQL database.
 * 
 * Usage:
 *   node scripts/migrate-to-postgres.js [sqlite-path]
 * 
 * Environment Variables:
 *   DATABASE_URL - PostgreSQL connection string (required)
 *   STRATUS_DATA_DIR - SQLite database directory (optional)
 */

const { Pool } = require('pg');
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

// Configuration
const BATCH_SIZE = 1000;

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}[Migration] ${message}${colors.reset}`);
}

// Helper to convert sql.js result to array of objects
function resultToObjects(result) {
  if (!result || !result.columns || !result.values) return [];
  return result.values.map(row => {
    const obj = {};
    result.columns.forEach((col, i) => {
      obj[col] = row[i];
    });
    return obj;
  });
}

// Helper to run a query and get single value
function getScalarValue(sqlite, query) {
  const result = sqlite.exec(query);
  if (result.length === 0 || result[0].values.length === 0) return 0;
  return result[0].values[0][0];
}

// Helper to run a query with pagination
function getPaginatedResults(sqlite, table, limit, offset) {
  const result = sqlite.exec(`SELECT * FROM ${table} ORDER BY id LIMIT ${limit} OFFSET ${offset}`);
  return result.length > 0 ? resultToObjects(result[0]) : [];
}

function getLocalDbPath() {
  // Check command line argument first
  if (process.argv[2]) {
    return process.argv[2];
  }
  const dataDir = process.env.STRATUS_DATA_DIR || '/home/stratus/.local/share/Stratus Weather Server';
  return path.join(dataDir, 'stratus.db');
}

async function createTables(postgres) {
  log('Creating PostgreSQL tables...', 'cyan');
  
  await postgres.query(`
    CREATE TABLE IF NOT EXISTS stations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      pakbus_address INTEGER DEFAULT 1,
      connection_type VARCHAR(50) DEFAULT 'http',
      connection_config JSONB DEFAULT '{}',
      security_code INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_connected TIMESTAMP,
      is_active BOOLEAN DEFAULT true,
      latitude DECIMAL(10, 8),
      longitude DECIMAL(11, 8),
      altitude DECIMAL(10, 2),
      location VARCHAR(255),
      datalogger_model VARCHAR(100),
      datalogger_serial_number VARCHAR(100),
      program_name VARCHAR(255),
      modem_model VARCHAR(100),
      modem_serial_number VARCHAR(100),
      site_description TEXT,
      notes TEXT,
      station_image TEXT,
      protocol VARCHAR(50) DEFAULT 'pakbus',
      station_type VARCHAR(50) DEFAULT 'http'
    )
  `);
  
  await postgres.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      first_name VARCHAR(100),
      last_name VARCHAR(100),
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(50) DEFAULT 'user',
      assigned_stations TEXT,
      is_active BOOLEAN DEFAULT true,
      last_login_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  await postgres.query(`
    CREATE TABLE IF NOT EXISTS dropbox_configs (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255),
      folder_path VARCHAR(500),
      file_pattern VARCHAR(255),
      station_id INTEGER REFERENCES stations(id),
      sync_interval INTEGER DEFAULT 3600000,
      enabled BOOLEAN DEFAULT true,
      last_sync_at TIMESTAMP,
      last_sync_status VARCHAR(100),
      last_sync_records INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  await postgres.query(`
    CREATE TABLE IF NOT EXISTS weather_data (
      id SERIAL PRIMARY KEY,
      station_id INTEGER NOT NULL REFERENCES stations(id),
      table_name VARCHAR(100),
      record_number INTEGER,
      timestamp TIMESTAMP NOT NULL,
      data JSONB,
      collected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  await postgres.query(`
    CREATE INDEX IF NOT EXISTS idx_weather_data_station_timestamp 
    ON weather_data(station_id, timestamp)
  `);
  
  await postgres.query(`
    CREATE TABLE IF NOT EXISTS shares (
      id SERIAL PRIMARY KEY,
      station_id INTEGER REFERENCES stations(id),
      share_token VARCHAR(100) UNIQUE,
      name VARCHAR(255),
      email VARCHAR(255),
      access_level VARCHAR(50),
      password VARCHAR(255),
      expires_at TIMESTAMP,
      is_active BOOLEAN DEFAULT true,
      last_accessed_at TIMESTAMP,
      access_count INTEGER DEFAULT 0,
      created_by INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  await postgres.query(`
    CREATE TABLE IF NOT EXISTS alarms (
      id SERIAL PRIMARY KEY,
      station_id INTEGER REFERENCES stations(id),
      parameter VARCHAR(100),
      condition VARCHAR(50),
      threshold DECIMAL(15, 5),
      severity VARCHAR(50),
      enabled BOOLEAN DEFAULT true,
      email_notifications BOOLEAN DEFAULT false,
      email_recipients TEXT,
      last_triggered_at TIMESTAMP,
      trigger_count INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  await postgres.query(`
    CREATE TABLE IF NOT EXISTS alarm_events (
      id SERIAL PRIMARY KEY,
      alarm_id INTEGER REFERENCES alarms(id),
      station_id INTEGER REFERENCES stations(id),
      triggered_value DECIMAL(15, 5),
      message TEXT,
      acknowledged BOOLEAN DEFAULT false,
      acknowledged_by INTEGER,
      acknowledged_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  log('Tables created successfully', 'green');
}

async function main() {
  const postgresUrl = process.env.DATABASE_URL;
  if (!postgresUrl) {
    log('DATABASE_URL environment variable is required', 'red');
    process.exit(1);
  }

  const sqlitePath = getLocalDbPath();
  if (!fs.existsSync(sqlitePath)) {
    log(`SQLite database not found at: ${sqlitePath}`, 'red');
    process.exit(1);
  }

  log(`SQLite database: ${sqlitePath}`, 'cyan');
  log(`PostgreSQL: ${postgresUrl.replace(/:[^:@]+@/, ':****@')}`, 'cyan');

  // Initialize sql.js and load SQLite database
  const SQL = await initSqlJs();
  const fileBuffer = fs.readFileSync(sqlitePath);
  const sqlite = new SQL.Database(fileBuffer);
  
  const postgres = new Pool({
    connectionString: postgresUrl,
    ssl: postgresUrl.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
  });

  try {
    // Test PostgreSQL connection
    const pgClient = await postgres.connect();
    log('Connected to PostgreSQL', 'green');
    pgClient.release();

    // Create tables first
    await createTables(postgres);

    // Migrate stations
    await migrateStations(sqlite, postgres);

    // Migrate users
    await migrateUsers(sqlite, postgres);

    // Migrate dropbox configs
    await migrateDropboxConfigs(sqlite, postgres);

    // Migrate weather data (this is the big one)
    await migrateWeatherData(sqlite, postgres);

    // Migrate shares
    await migrateShares(sqlite, postgres);

    // Migrate alarms
    await migrateAlarms(sqlite, postgres);

    // Migrate alarm events
    await migrateAlarmEvents(sqlite, postgres);

    log('Migration completed successfully!', 'green');
  } catch (error) {
    log(`Migration failed: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  } finally {
    sqlite.close();
    await postgres.end();
  }
}

async function migrateStations(sqlite, postgres) {
  log('Migrating stations...', 'cyan');
  
  const result = sqlite.exec('SELECT * FROM stations');
  const stations = result.length > 0 ? resultToObjects(result[0]) : [];
  log(`Found ${stations.length} stations`, 'yellow');

  for (const station of stations) {
    try {
      // Check if station already exists
      const existing = await postgres.query('SELECT id FROM stations WHERE id = $1', [station.id]);
      if (existing.rows.length > 0) {
        log(`Station ${station.id} already exists, skipping`, 'yellow');
        continue;
      }

      // Parse connection_config if it's a string
      let connectionConfig = station.connection_config;
      if (typeof connectionConfig === 'string') {
        try {
          connectionConfig = JSON.parse(connectionConfig);
        } catch {
          connectionConfig = {};
        }
      }

      await postgres.query(`
        INSERT INTO stations (id, name, pakbus_address, connection_type, connection_config,
          security_code, created_at, updated_at, last_connected, is_active,
          latitude, longitude, altitude, location, datalogger_model,
          datalogger_serial_number, program_name, modem_model, modem_serial_number,
          site_description, notes, station_image, protocol, station_type)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
        ON CONFLICT (id) DO NOTHING
      `, [
        station.id,
        station.name,
        station.pakbus_address || 1,
        station.connection_type || 'http',
        JSON.stringify(connectionConfig),
        station.security_code,
        station.created_at,
        station.updated_at,
        station.last_connected,
        station.is_active === 1 || station.is_active === true,
        station.latitude,
        station.longitude,
        station.altitude,
        station.location,
        station.datalogger_model,
        station.datalogger_serial_number,
        station.program_name,
        station.modem_model,
        station.modem_serial_number,
        station.site_description,
        station.notes,
        station.station_image,
        station.protocol || 'pakbus',
        station.station_type || 'http',
      ]);
      log(`Migrated station: ${station.name}`, 'green');
    } catch (error) {
      log(`Failed to migrate station ${station.id}: ${error.message}`, 'red');
    }
  }

  // Update sequence
  await postgres.query(`SELECT setval('stations_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM stations), false)`);
}

async function migrateUsers(sqlite, postgres) {
  log('Migrating users...', 'cyan');
  
  const result = sqlite.exec('SELECT * FROM users');
  const users = result.length > 0 ? resultToObjects(result[0]) : [];
  log(`Found ${users.length} users`, 'yellow');

  for (const user of users) {
    try {
      const existing = await postgres.query('SELECT id FROM users WHERE email = $1', [user.email]);
      if (existing.rows.length > 0) {
        log(`User ${user.email} already exists, skipping`, 'yellow');
        continue;
      }

      await postgres.query(`
        INSERT INTO users (id, email, first_name, last_name, password_hash, role,
          assigned_stations, is_active, last_login_at, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (email) DO NOTHING
      `, [
        user.id,
        user.email,
        user.first_name,
        user.last_name,
        user.password_hash,
        user.role || 'user',
        user.assigned_stations,
        user.is_active === 1 || user.is_active === true,
        user.last_login_at,
        user.created_at,
        user.updated_at,
      ]);
      log(`Migrated user: ${user.email}`, 'green');
    } catch (error) {
      log(`Failed to migrate user ${user.email}: ${error.message}`, 'red');
    }
  }

  await postgres.query(`SELECT setval('users_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM users), false)`);
}

async function migrateDropboxConfigs(sqlite, postgres) {
  log('Migrating Dropbox configs...', 'cyan');
  
  const result = sqlite.exec('SELECT * FROM dropbox_configs');
  const configs = result.length > 0 ? resultToObjects(result[0]) : [];
  log(`Found ${configs.length} Dropbox configs`, 'yellow');

  for (const config of configs) {
    try {
      const existing = await postgres.query('SELECT id FROM dropbox_configs WHERE id = $1', [config.id]);
      if (existing.rows.length > 0) {
        log(`Dropbox config ${config.id} already exists, skipping`, 'yellow');
        continue;
      }

      await postgres.query(`
        INSERT INTO dropbox_configs (id, name, folder_path, file_pattern, station_id,
          sync_interval, enabled, last_sync_at, last_sync_status, last_sync_records,
          created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (id) DO NOTHING
      `, [
        config.id,
        config.name,
        config.folder_path,
        config.file_pattern,
        config.station_id,
        config.sync_interval || 3600000,
        config.enabled === 1 || config.enabled === true,
        config.last_sync_at,
        config.last_sync_status,
        config.last_sync_records || 0,
        config.created_at,
        config.updated_at,
      ]);
      log(`Migrated Dropbox config: ${config.name}`, 'green');
    } catch (error) {
      log(`Failed to migrate Dropbox config ${config.id}: ${error.message}`, 'red');
    }
  }

  await postgres.query(`SELECT setval('dropbox_configs_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM dropbox_configs), false)`);
}

async function migrateWeatherData(sqlite, postgres) {
  log('Migrating weather data...', 'cyan');
  
  // Get total count
  const totalRecords = getScalarValue(sqlite, 'SELECT COUNT(*) FROM weather_data');
  log(`Found ${totalRecords} weather data records`, 'yellow');

  if (totalRecords === 0) {
    log('No weather data to migrate', 'yellow');
    return;
  }

  // Check existing records in PostgreSQL
  const pgCount = await postgres.query('SELECT COUNT(*) as count FROM weather_data');
  const existingRecords = parseInt(pgCount.rows[0].count);
  log(`PostgreSQL already has ${existingRecords} records`, 'yellow');

  let offset = 0;
  let migrated = 0;
  let skipped = 0;

  while (offset < totalRecords) {
    const records = getPaginatedResults(sqlite, 'weather_data', BATCH_SIZE, offset);

    if (records.length === 0) break;

    const client = await postgres.connect();
    try {
      await client.query('BEGIN');

      for (const record of records) {
        try {
          // Parse data if it's a string
          let data = record.data;
          if (typeof data === 'string') {
            try {
              data = JSON.parse(data);
            } catch {
              data = { raw: data };
            }
          }

          // Check for duplicate by timestamp and station
          const existing = await client.query(
            'SELECT id FROM weather_data WHERE station_id = $1 AND timestamp = $2 LIMIT 1',
            [record.station_id, record.timestamp]
          );

          if (existing.rows.length > 0) {
            skipped++;
            continue;
          }

          await client.query(`
            INSERT INTO weather_data (station_id, table_name, record_number, timestamp, data, collected_at)
            VALUES ($1, $2, $3, $4, $5, $6)
          `, [
            record.station_id,
            record.table_name,
            record.record_number,
            record.timestamp,
            JSON.stringify(data),
            record.collected_at,
          ]);
          migrated++;
        } catch (error) {
          // Log but continue with other records
          if (!error.message.includes('duplicate')) {
            log(`Record error: ${error.message}`, 'yellow');
          }
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    offset += BATCH_SIZE;
    const progress = Math.round((offset / totalRecords) * 100);
    log(`Progress: ${progress}% (${migrated} migrated, ${skipped} skipped)`, 'cyan');
  }

  log(`Weather data migration complete: ${migrated} records migrated, ${skipped} skipped`, 'green');
  
  // Update sequence
  await postgres.query(`SELECT setval('weather_data_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM weather_data), false)`);
}

async function migrateShares(sqlite, postgres) {
  log('Migrating shares...', 'cyan');
  
  try {
    const result = sqlite.exec('SELECT * FROM shares');
    const shares = result.length > 0 ? resultToObjects(result[0]) : [];
    log(`Found ${shares.length} shares`, 'yellow');

    for (const share of shares) {
      try {
        const existing = await postgres.query('SELECT id FROM shares WHERE share_token = $1', [share.share_token]);
        if (existing.rows.length > 0) continue;

        await postgres.query(`
          INSERT INTO shares (id, station_id, share_token, name, email, access_level, password,
            expires_at, is_active, last_accessed_at, access_count, created_by, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        `, [
          share.id,
          share.station_id,
          share.share_token,
          share.name,
          share.email,
          share.access_level,
          share.password,
          share.expires_at,
          share.is_active === 1,
          share.last_accessed_at,
          share.access_count || 0,
          share.created_by,
          share.created_at,
          share.updated_at,
        ]);
      } catch (error) {
        log(`Failed to migrate share: ${error.message}`, 'yellow');
      }
    }
    await postgres.query(`SELECT setval('shares_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM shares), false)`);
  } catch (error) {
    log(`Shares table might not exist: ${error.message}`, 'yellow');
  }
}

async function migrateAlarms(sqlite, postgres) {
  log('Migrating alarms...', 'cyan');
  
  try {
    const result = sqlite.exec('SELECT * FROM alarms');
    const alarms = result.length > 0 ? resultToObjects(result[0]) : [];
    log(`Found ${alarms.length} alarms`, 'yellow');

    for (const alarm of alarms) {
      try {
        const existing = await postgres.query('SELECT id FROM alarms WHERE id = $1', [alarm.id]);
        if (existing.rows.length > 0) continue;

        await postgres.query(`
          INSERT INTO alarms (id, station_id, parameter, condition, threshold, severity,
            enabled, email_notifications, email_recipients, last_triggered_at, trigger_count,
            created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        `, [
          alarm.id,
          alarm.station_id,
          alarm.parameter,
          alarm.condition,
          alarm.threshold,
          alarm.severity,
          alarm.enabled === 1,
          alarm.email_notifications === 1,
          alarm.email_recipients,
          alarm.last_triggered_at,
          alarm.trigger_count || 0,
          alarm.created_at,
          alarm.updated_at,
        ]);
      } catch (error) {
        log(`Failed to migrate alarm: ${error.message}`, 'yellow');
      }
    }
    await postgres.query(`SELECT setval('alarms_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM alarms), false)`);
  } catch (error) {
    log(`Alarms table might not exist: ${error.message}`, 'yellow');
  }
}

async function migrateAlarmEvents(sqlite, postgres) {
  log('Migrating alarm events...', 'cyan');
  
  try {
    const result = sqlite.exec('SELECT * FROM alarm_events');
    const events = result.length > 0 ? resultToObjects(result[0]) : [];
    log(`Found ${events.length} alarm events`, 'yellow');

    for (const event of events) {
      try {
        const existing = await postgres.query('SELECT id FROM alarm_events WHERE id = $1', [event.id]);
        if (existing.rows.length > 0) continue;

        await postgres.query(`
          INSERT INTO alarm_events (id, alarm_id, station_id, triggered_value, message,
            acknowledged, acknowledged_by, acknowledged_at, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
          event.id,
          event.alarm_id,
          event.station_id,
          event.triggered_value,
          event.message,
          event.acknowledged === 1,
          event.acknowledged_by,
          event.acknowledged_at,
          event.created_at,
        ]);
      } catch (error) {
        log(`Failed to migrate alarm event: ${error.message}`, 'yellow');
      }
    }
    await postgres.query(`SELECT setval('alarm_events_id_seq', (SELECT COALESCE(MAX(id), 0) + 1 FROM alarm_events), false)`);
  } catch (error) {
    log(`Alarm events table might not exist: ${error.message}`, 'yellow');
  }
}

main().catch(console.error);
