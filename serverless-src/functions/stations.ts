import { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  const clientContext = context.clientContext as any;
  
  if (!clientContext?.user) {
    return { 
      statusCode: 401, 
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Unauthorized" }) 
    };
  }

  const method = event.httpMethod;

  try {
    const client = await pool.connect();

    if (method === 'GET') {
      const stationId = event.queryStringParameters?.id;
      
      if (stationId) {
        const result = await client.query(
          `SELECT id, name, location, latitude, longitude, altitude, station_type, connection_type, 
                  ip_address, port, data_table, poll_interval, is_active, created_at
           FROM weather_stations WHERE id = $1`,
          [stationId]
        );
        client.release();
        
        if (result.rows.length === 0) {
          return {
            statusCode: 404,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: "Station not found" })
          };
        }
        
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ station: result.rows[0] })
        };
      }

      const result = await client.query(
        `SELECT id, name, location, latitude, longitude, altitude, station_type, connection_type, 
                ip_address, port, data_table, poll_interval, is_active, created_at
         FROM weather_stations
         ORDER BY name`
      );
      client.release();
      
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stations: result.rows })
      };
    }

    if (method === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { 
        name, location, latitude, longitude, altitude,
        stationType, connectionType, ipAddress, port,
        username, password, apiKey, apiEndpoint, dataTable, pollInterval
      } = body;

      if (!name) {
        client.release();
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Station name is required" })
        };
      }

      const result = await client.query(
        `INSERT INTO weather_stations 
         (name, location, latitude, longitude, altitude, station_type, connection_type, 
          ip_address, port, username, password, api_key, api_endpoint, data_table, poll_interval)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING id, name, location, latitude, longitude, altitude, station_type, connection_type, 
                   ip_address, port, data_table, poll_interval, is_active, created_at`,
        [
          name, location, latitude, longitude, altitude,
          stationType || 'campbell_scientific',
          connectionType || 'http',
          ipAddress, port || 80,
          username, password, apiKey, apiEndpoint,
          dataTable || 'OneMin',
          pollInterval || 60
        ]
      );
      client.release();

      return {
        statusCode: 201,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ station: result.rows[0] })
      };
    }

    if (method === 'PUT') {
      const stationId = event.queryStringParameters?.id;
      if (!stationId) {
        client.release();
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Station ID is required" })
        };
      }

      const body = JSON.parse(event.body || '{}');
      const { 
        name, location, latitude, longitude, altitude,
        stationType, connectionType, ipAddress, port,
        username, password, apiKey, apiEndpoint, dataTable, pollInterval, isActive
      } = body;

      const result = await client.query(
        `UPDATE weather_stations SET
           name = COALESCE($1, name),
           location = COALESCE($2, location),
           latitude = COALESCE($3, latitude),
           longitude = COALESCE($4, longitude),
           altitude = COALESCE($5, altitude),
           station_type = COALESCE($6, station_type),
           connection_type = COALESCE($7, connection_type),
           ip_address = COALESCE($8, ip_address),
           port = COALESCE($9, port),
           username = COALESCE($10, username),
           password = COALESCE($11, password),
           api_key = COALESCE($12, api_key),
           api_endpoint = COALESCE($13, api_endpoint),
           data_table = COALESCE($14, data_table),
           poll_interval = COALESCE($15, poll_interval),
           is_active = COALESCE($16, is_active),
           updated_at = NOW()
         WHERE id = $17
         RETURNING id, name, location, latitude, longitude, altitude, station_type, connection_type, 
                   ip_address, port, data_table, poll_interval, is_active, created_at`,
        [
          name, location, latitude, longitude, altitude,
          stationType, connectionType, ipAddress, port,
          username, password, apiKey, apiEndpoint, dataTable, pollInterval, isActive,
          stationId
        ]
      );
      client.release();

      if (result.rows.length === 0) {
        return {
          statusCode: 404,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Station not found" })
        };
      }

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ station: result.rows[0] })
      };
    }

    if (method === 'DELETE') {
      const stationId = event.queryStringParameters?.id;
      if (!stationId) {
        client.release();
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Station ID is required" })
        };
      }

      await client.query('DELETE FROM weather_stations WHERE id = $1', [stationId]);
      client.release();

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: true })
      };
    }

    client.release();
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Method not allowed" })
    };
  } catch (error) {
    console.error('Stations API error:', error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        error: "Internal server error",
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};
