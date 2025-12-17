import { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

interface CampbellScientificResponse {
  head: {
    environment: {
      station_name: string;
      table_name: string;
    };
    fields: Array<{
      name: string;
      type: string;
      units: string;
    }>;
  };
  data: Array<Array<string | number>>;
  more: boolean;
}

interface WeatherDataPoint {
  timestamp: string;
  temperature?: number;
  humidity?: number;
  pressure?: number;
  windSpeed?: number;
  windDirection?: number;
  windGust?: number;
  rainfall?: number;
  solarRadiation?: number;
  uvIndex?: number;
  dewPoint?: number;
}

async function fetchCampbellScientificData(
  ipAddress: string,
  port: number,
  username: string | null,
  password: string | null,
  dataTable: string
): Promise<WeatherDataPoint[]> {
  const baseUrl = `http://${ipAddress}:${port}`;
  const url = `${baseUrl}/?command=dataquery&uri=dl:${dataTable}&format=json&mode=most-recent&p1=1`;

  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };

  if (username && password) {
    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    headers['Authorization'] = `Basic ${auth}`;
  }

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data: CampbellScientificResponse = await response.json();
    
    const fieldNames = data.head.fields.map(f => f.name.toLowerCase());
    const records: WeatherDataPoint[] = [];

    for (const row of data.data) {
      const record: WeatherDataPoint = {
        timestamp: new Date().toISOString(),
      };

      fieldNames.forEach((name, index) => {
        const value = row[index];
        if (typeof value === 'number') {
          if (name.includes('temp') || name === 'airtemp') record.temperature = value;
          else if (name.includes('humid') || name === 'rh') record.humidity = value;
          else if (name.includes('press') || name === 'baro') record.pressure = value;
          else if (name.includes('windspd') || name.includes('ws_')) record.windSpeed = value;
          else if (name.includes('winddir') || name.includes('wd_')) record.windDirection = value;
          else if (name.includes('gust')) record.windGust = value;
          else if (name.includes('rain') || name.includes('precip')) record.rainfall = value;
          else if (name.includes('solar') || name.includes('slrkw')) record.solarRadiation = value;
          else if (name.includes('uv')) record.uvIndex = value;
          else if (name.includes('dew')) record.dewPoint = value;
        } else if (name === 'timestamp' && typeof value === 'string') {
          record.timestamp = value;
        }
      });

      records.push(record);
    }

    return records;
  } catch (error) {
    console.error('Campbell Scientific fetch error:', error);
    throw error;
  }
}

async function fetchRikaData(
  ipAddress: string,
  port: number,
  apiKey: string | null,
  apiEndpoint: string | null
): Promise<WeatherDataPoint[]> {
  const baseUrl = apiEndpoint || `http://${ipAddress}:${port}/api/v1/data`;
  
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };

  if (apiKey) {
    headers['X-API-Key'] = apiKey;
  }

  try {
    const response = await fetch(baseUrl, { headers });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    const record: WeatherDataPoint = {
      timestamp: data.timestamp || new Date().toISOString(),
      temperature: data.temperature?.value ?? data.air_temperature,
      humidity: data.humidity?.value ?? data.relative_humidity,
      pressure: data.pressure?.value ?? data.barometric_pressure,
      windSpeed: data.wind_speed?.value ?? data.wind_speed,
      windDirection: data.wind_direction?.value ?? data.wind_direction,
      windGust: data.wind_gust?.value ?? data.gust_speed,
      rainfall: data.rainfall?.value ?? data.precipitation,
      solarRadiation: data.solar_radiation?.value ?? data.solar_radiation,
      uvIndex: data.uv_index?.value ?? data.uv_index,
    };

    return [record];
  } catch (error) {
    console.error('Rika fetch error:', error);
    throw error;
  }
}

export const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  const clientContext = context.clientContext as any;
  
  if (!clientContext?.user) {
    return { 
      statusCode: 401, 
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Unauthorized" }) 
    };
  }

  const stationId = event.queryStringParameters?.stationId;
  
  if (!stationId) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "stationId parameter required" })
    };
  }

  try {
    const client = await pool.connect();
    
    const stationResult = await client.query(
      `SELECT * FROM weather_stations WHERE id = $1`,
      [stationId]
    );

    if (stationResult.rows.length === 0) {
      client.release();
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Station not found" })
      };
    }

    const station = stationResult.rows[0];
    let weatherData: WeatherDataPoint[] = [];

    if (station.station_type === 'campbell_scientific') {
      weatherData = await fetchCampbellScientificData(
        station.ip_address,
        station.port || 80,
        station.username,
        station.password,
        station.data_table || 'OneMin'
      );
    } else if (station.station_type === 'rika') {
      weatherData = await fetchRikaData(
        station.ip_address,
        station.port || 80,
        station.api_key,
        station.api_endpoint
      );
    } else {
      client.release();
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: `Unsupported station type: ${station.station_type}` })
      };
    }

    for (const data of weatherData) {
      await client.query(
        `INSERT INTO weather_data (station_id, timestamp, temperature, humidity, pressure, wind_speed, wind_direction, wind_gust, rainfall, solar_radiation, uv_index, dew_point)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT DO NOTHING`,
        [
          stationId,
          data.timestamp,
          data.temperature,
          data.humidity,
          data.pressure,
          data.windSpeed,
          data.windDirection,
          data.windGust,
          data.rainfall,
          data.solarRadiation,
          data.uvIndex,
          data.dewPoint
        ]
      );
    }

    client.release();

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        success: true, 
        data: weatherData,
        station: {
          id: station.id,
          name: station.name,
          type: station.station_type
        }
      })
    };
  } catch (error) {
    console.error('Weather data fetch error:', error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        error: "Failed to fetch weather data",
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};
