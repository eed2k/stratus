-- Migration: Add weather station configuration and measurements tables
-- Supports both Campbell Scientific and Rika weather stations

-- Weather Stations Configuration Table
CREATE TABLE IF NOT EXISTS weather_stations (
    id TEXT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('campbell', 'rika')),
    location_latitude DECIMAL(10, 8),
    location_longitude DECIMAL(11, 8),
    location_altitude DECIMAL(8, 2),
    location_description TEXT,
    
    -- Rika-specific config
    rika_ip_address VARCHAR(255),
    rika_port INTEGER DEFAULT 8080,
    rika_api_key VARCHAR(255),
    rika_poll_interval INTEGER DEFAULT 60,
    
    -- Campbell-specific config
    campbell_connection_type VARCHAR(50) CHECK (campbell_connection_type IN ('serial', 'lora', 'gsm', null)),
    campbell_port_name VARCHAR(255),
    campbell_baud_rate INTEGER,
    campbell_address VARCHAR(255),
    
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    
    UNIQUE(name)
);

-- Weather Measurements Table
CREATE TABLE IF NOT EXISTS measurements (
    id SERIAL PRIMARY KEY,
    station_id TEXT NOT NULL REFERENCES weather_stations(id) ON DELETE CASCADE,
    
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    temperature DECIMAL(6, 2),
    humidity DECIMAL(5, 2),
    pressure DECIMAL(7, 2),
    wind_speed DECIMAL(6, 2),
    wind_direction DECIMAL(6, 2),
    wind_gust DECIMAL(6, 2),
    rainfall DECIMAL(8, 2),
    solar_radiation DECIMAL(8, 2),
    uv_index DECIMAL(4, 2),
    dew_point DECIMAL(6, 2),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_measurements_station_id ON measurements(station_id);
CREATE INDEX IF NOT EXISTS idx_measurements_timestamp ON measurements(timestamp);
CREATE INDEX IF NOT EXISTS idx_measurements_station_timestamp ON measurements(station_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_weather_stations_type ON weather_stations(type);

-- Wind Rose Data (aggregated for visualization)
CREATE TABLE IF NOT EXISTS wind_rose_data (
    id SERIAL PRIMARY KEY,
    station_id TEXT NOT NULL REFERENCES weather_stations(id) ON DELETE CASCADE,
    
    wind_direction_bin INTEGER,
    wind_speed_bin INTEGER,
    frequency INTEGER DEFAULT 1,
    
    time_period VARCHAR(50),
    calculated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    
    UNIQUE(station_id, wind_direction_bin, wind_speed_bin, time_period)
);

CREATE INDEX IF NOT EXISTS idx_wind_rose_station ON wind_rose_data(station_id);

-- Station Status/Health Table
CREATE TABLE IF NOT EXISTS station_status (
    station_id TEXT PRIMARY KEY REFERENCES weather_stations(id) ON DELETE CASCADE,
    
    is_connected BOOLEAN DEFAULT false,
    last_data_received TIMESTAMP WITH TIME ZONE,
    last_error TEXT,
    last_error_at TIMESTAMP WITH TIME ZONE,
    error_count INTEGER DEFAULT 0,
    
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Data Aggregation Table (for performance)
CREATE TABLE IF NOT EXISTS measurement_aggregates (
    id SERIAL PRIMARY KEY,
    station_id TEXT NOT NULL REFERENCES weather_stations(id) ON DELETE CASCADE,
    
    aggregate_type VARCHAR(50) NOT NULL CHECK (aggregate_type IN ('hourly', 'daily', 'weekly')),
    period_start TIMESTAMP WITH TIME ZONE NOT NULL,
    period_end TIMESTAMP WITH TIME ZONE NOT NULL,
    
    -- Temperature
    temp_min DECIMAL(6, 2),
    temp_max DECIMAL(6, 2),
    temp_avg DECIMAL(6, 2),
    
    -- Humidity
    humidity_min DECIMAL(5, 2),
    humidity_max DECIMAL(5, 2),
    humidity_avg DECIMAL(5, 2),
    
    -- Wind
    wind_speed_avg DECIMAL(6, 2),
    wind_gust_max DECIMAL(6, 2),
    
    -- Rainfall
    rainfall_total DECIMAL(8, 2),
    
    measurement_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    
    UNIQUE(station_id, aggregate_type, period_start)
);

CREATE INDEX IF NOT EXISTS idx_aggregates_station ON measurement_aggregates(station_id);
CREATE INDEX IF NOT EXISTS idx_aggregates_period ON measurement_aggregates(period_start, period_end);
