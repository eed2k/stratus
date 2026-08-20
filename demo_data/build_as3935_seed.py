#!/usr/bin/env python3
"""Build the SQL that creates the AS3935 demo station and seeds its readings.

Why SQL rather than the dashboard's own import endpoint:
POST /api/stations/:id/import whitelists only 13 fields when it writes the
weather_data JSONB (server/routes.ts, the `data:` object). lightning,
lightningDistance and lightningEnergy are not in that list, so importing this
file through the UI would silently drop exactly the AS3935 channels this demo
exists to show. It also drops solar energy, UV, visibility, PM and the MPPT
channels. This writes the full record instead.

Each row carries BOTH the canonical camelCase field names and the original
Campbell column names, which is what the Dropbox sync path does
(`{ ...record.data, ...mappedData }`). Readers in the codebase resolve either
form, so storing both means no reader can miss a value.

Station identity is fixed deliberately:
  name              AS3935          (must NOT contain "demo": the
                                     POST /api/stations/cleanup endpoint deletes
                                     any station whose name contains it)
  connection_type   demo            (the only type every live-data path skips:
                                     protocolManager, stalenessMonitorService,
                                     integrationService and the Dropbox/protocol
                                     registration block in POST /api/stations)
  connection_config {}              (no host, port, apiKey or device id, so the
                                     uplink resolver has nothing to match)
  ingest_id         NULL            (only generated for connection_type
                                     'http_post', so /api/ingest/<id> cannot
                                     address it by ingest id)

Usage:
    python build_as3935_seed.py [--file potchefstroom_full_demo.dat]
Writes as3935_seed.sql.
"""
from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime, timedelta
from pathlib import Path

# Timestamps in a Campbell TOA5 file are station local time with no zone marker.
# The Stratus parser treats them as SAST (it appends +02:00), and the production
# database stores UTC: `SHOW TimeZone` is GMT, and a live station's newest row
# sits a few minutes behind `now()`, not two hours ahead of it. Writing the file
# timestamps verbatim would therefore place every reading two hours in the
# future, which breaks the "last update" display and the 1 hour window. Shift
# SAST to UTC so the seeded rows follow the same convention as every other
# station.
SAST_TO_UTC_HOURS = -2

SITE_NAME = "AS3935"
LATITUDE = -26.7145
LONGITUDE = 27.0977
ALTITUDE_M = 1350.0
LOCATION = "Potchefstroom, North West, South Africa"
TABLE_NAME = "WeatherData"

# Campbell column -> canonical Stratus field. Mirrors the fieldMappings table in
# server/parsers/campbellScientific.ts::mapToWeatherData.
FIELD_MAP = {
    "AirTC_Avg": "temperature",
    "RH": "humidity",
    "DewPt_Avg": "dewPoint",
    "BP_mbar_Avg": "pressure",
    "WS_ms_Avg": "windSpeed",
    "WS_Max": "windGust",
    "WSpd_Min": "windSpeedMin",
    "WindDir": "windDirection",
    "Wind_Dir_SD1_WVT": "windDirStdDev",
    "SlrW_Avg": "solarRadiation",
    "SlrMJ_Tot": "solarMJTotal",
    "UV_Index_Avg": "uvIndex",
    "Rain_mm_Tot": "rainfall",
    "SoilTC_Avg": "soilTemperature",
    "VWC_Avg": "soilMoisture",
    "Visibility_km": "visibility",
    "PM2_5_Avg": "pm25",
    "PM10_Avg": "pm10",
    "Lightning_Tot": "lightning",
    "LightningDist": "lightningDistance",
    "LightningEnergy": "lightningEnergy",
    "BattV_Avg": "batteryVoltage",
    "PTemp_C_Avg": "panelTemperature",
    "MPPT_SolV_Avg": "mpptSolarVoltage",
    "MPPT_SolI_Avg": "mpptSolarCurrent",
    "MPPT_SolP_Avg": "mpptSolarPower",
    "MPPT_BatV_Avg": "mpptBatteryVoltage",
    "MPPT_LdV_Avg": "mpptLoadVoltage",
    "MPPT_LdI_Avg": "mpptLoadCurrent",
    "SolarCharger_BoardTemp_1_Avg": "mpptBoardTemp",
}


def sql_str(value: str) -> str:
    """Single-quoted SQL literal with quotes doubled."""
    return "'" + str(value).replace("'", "''") + "'"


def parse_toa5(path: Path):
    lines = path.read_text(encoding="utf-8").splitlines()
    if len(lines) < 5:
        raise SystemExit(f"{path} has too few lines to be TOA5")
    headers = next(csv.reader([lines[1]]))
    rows = []
    for raw in lines[4:]:
        if not raw.strip():
            continue
        values = next(csv.reader([raw]))
        if len(values) < 3:
            continue
        rows.append((values[0], values[1], values[2:]))
    return headers, rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", default="potchefstroom_full_demo.dat")
    ap.add_argument("--out", default="as3935_seed.sql")
    ap.add_argument("--shift-hours", type=float, default=SAST_TO_UTC_HOURS,
                    help="hours to add to every file timestamp (default -2, "
                         "converting SAST to the UTC the database stores)")
    args = ap.parse_args()
    shift = timedelta(hours=args.shift_hours)

    src = Path(args.file)
    headers, rows = parse_toa5(src)
    data_cols = headers[2:]

    unmapped = [c for c in data_cols if c not in FIELD_MAP]
    if unmapped:
        print(f"note: columns kept only under their Campbell name: {unmapped}")

    # Build the row payloads first so the SQL can be emitted in batches.
    prepared: list[tuple[str, int, str]] = []
    first_ts_out = last_ts_out = None
    for ts_raw, recnum, values in rows:
        ts = (datetime.strptime(ts_raw, "%Y-%m-%d %H:%M:%S") + shift
              ).strftime("%Y-%m-%d %H:%M:%S")
        payload: dict[str, float] = {}
        for col, raw in zip(data_cols, values):
            raw = raw.strip()
            if raw in ("", "NAN", "NaN", "-INF", "INF"):
                continue
            try:
                num = float(raw)
            except ValueError:
                continue
            # Original Campbell name, then the canonical field name. Readers in
            # the codebase accept either.
            payload[col] = num
            canonical = FIELD_MAP.get(col)
            if canonical:
                payload[canonical] = num
        if not payload:
            continue
        if first_ts_out is None:
            first_ts_out = ts
        last_ts_out = ts
        try:
            rn = int(recnum)
        except ValueError:
            rn = len(prepared) + 1
        prepared.append((ts, rn, json.dumps(payload, separators=(",", ":"))))

    kept = len(prepared)
    out = []
    a = out.append
    a("-- AS3935 demo station for stratusweather.co.za")
    a(f"-- Generated from {src.name}: {kept} readings, {len(data_cols)} channels")
    a(f"-- Stored window {first_ts_out} .. {last_ts_out} UTC "
      f"(file times shifted {args.shift_hours:+g} h from SAST)")
    a("--")
    a("-- Demo only. connection_type='demo' keeps every live-data path away from")
    a("-- it, and connection_config is empty so no uplink identifier can resolve")
    a("-- to it. Do NOT call POST /api/stations/cleanup: that endpoint deletes")
    a("-- any station whose connection_type is 'demo'.")
    a("")
    a("BEGIN;")
    a("")
    a("-- The station id is held in a temp table rather than a plpgsql variable so")
    a("-- the readings below can be plain batched INSERTs instead of one enormous")
    a("-- procedure body.")
    a("CREATE TEMP TABLE _as3935_sid (id integer) ON COMMIT DROP;")
    a("")
    a("-- Create the station only if it is not already there.")
    a("INSERT INTO stations (name, pakbus_address, connection_type,")
    a("    connection_config, is_active, latitude, longitude, altitude,")
    a("    location, site_description, notes, protocol, station_type)")
    a(f"SELECT {sql_str(SITE_NAME)}, 1, 'demo', '{{}}'::jsonb, true,")
    a(f"       {LATITUDE}, {LONGITUDE}, {ALTITUDE_M},")
    a(f"       {sql_str(LOCATION)},")
    a("       'Demonstration station. AS3935 lightning detector plus a full "
      "weather sensor suite. Synthetic data, no live feed.',")
    a("       'DEMO ONLY - the readings are generated, not measured. Site "
      "geometry is the Potchefstroom standard: -26.7145, 27.0977, 1350 m AMSL.',")
    a("       'pakbus', 'http'")
    a(f" WHERE NOT EXISTS (SELECT 1 FROM stations WHERE name = {sql_str(SITE_NAME)});")
    a("")
    a(f"INSERT INTO _as3935_sid (id) SELECT id FROM stations WHERE name = {sql_str(SITE_NAME)};")
    a("")
    a("-- Keep the site geometry authoritative even on a re-run, and make sure the")
    a("-- station stays inert.")
    a("UPDATE stations SET")
    a(f"    latitude = {LATITUDE}, longitude = {LONGITUDE}, altitude = {ALTITUDE_M},")
    a(f"    location = {sql_str(LOCATION)},")
    a("    connection_type = 'demo', connection_config = '{}'::jsonb,")
    a("    is_active = true, updated_at = CURRENT_TIMESTAMP")
    a("  WHERE id = (SELECT id FROM _as3935_sid);")
    a("")
    a("-- Replace any previous seed so re-running cannot leave stale readings.")
    a("DELETE FROM weather_data")
    a(" WHERE station_id = (SELECT id FROM _as3935_sid)")
    a(f"   AND table_name = {sql_str(TABLE_NAME)};")
    a("")

    CHUNK = 200
    for start in range(0, kept, CHUNK):
        batch = prepared[start:start + CHUNK]
        a("INSERT INTO weather_data (station_id, table_name, record_number, timestamp, data) VALUES")
        rows_sql = [
            f"  ((SELECT id FROM _as3935_sid), {sql_str(TABLE_NAME)}, {rn}, "
            f"{sql_str(ts)}, {sql_str(js)}::jsonb)"
            for ts, rn, js in batch
        ]
        a(",\n".join(rows_sql))
        a("ON CONFLICT (station_id, table_name, timestamp) DO UPDATE")
        a("  SET data = EXCLUDED.data, collected_at = CURRENT_TIMESTAMP;")
        a("")

    a("-- Reflect the newest reading on the station row.")
    a("UPDATE stations SET last_connected = (")
    a("    SELECT MAX(timestamp) FROM weather_data")
    a("     WHERE station_id = (SELECT id FROM _as3935_sid))")
    a("  WHERE id = (SELECT id FROM _as3935_sid);")
    a("")
    a("COMMIT;")
    a("")
    a("-- Verification")
    a("SELECT s.id, s.name, s.connection_type, s.latitude, s.longitude, s.altitude,")
    a("       count(w.id) AS readings,")
    a("       min(w.timestamp) AS earliest, max(w.timestamp) AS latest")
    a("  FROM stations s LEFT JOIN weather_data w ON w.station_id = s.id")
    a(f" WHERE s.name = {sql_str(SITE_NAME)}")
    a(" GROUP BY s.id, s.name, s.connection_type, s.latitude, s.longitude, s.altitude;")
    a("")
    a("-- Lightning must be present: this is what the whitelist in the import")
    a("-- endpoint would have discarded.")
    a("SELECT count(*) FILTER (WHERE data ? 'lightning')          AS has_lightning,")
    a("       count(*) FILTER (WHERE data ? 'lightningDistance')  AS has_distance,")
    a("       count(*) FILTER (WHERE data ? 'lightningEnergy')    AS has_energy,")
    a("       max((data->>'lightning')::numeric)                  AS strike_counter,")
    a("       min((data->>'lightningDistance')::numeric)          AS closest_km,")
    a("       max((data->>'lightningEnergy')::numeric)            AS peak_energy")
    a("  FROM weather_data")
    a(f" WHERE station_id = (SELECT id FROM stations WHERE name = {sql_str(SITE_NAME)});")

    dest = Path(args.out)
    dest.write_text("\n".join(out) + "\n", encoding="utf-8")

    print(f"wrote {dest}  ({dest.stat().st_size:,} bytes)")
    print(f"  readings      {kept}")
    print(f"  channels      {len(data_cols)}")
    print(f"  file window   {rows[0][0]} .. {rows[-1][0]}  (SAST, as written)")
    print(f"  shift applied {args.shift_hours:+g} h")
    print(f"  stored window {first_ts_out} .. {last_ts_out}  (UTC, as the DB stores)")
    print(f"  site          {LATITUDE}, {LONGITUDE}, {ALTITUDE_M:.0f} m")


if __name__ == "__main__":
    main()
